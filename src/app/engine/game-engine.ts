import { Injectable, NgZone, ElementRef, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import Stats from 'stats.js';
import { Enemy, EnemyType, StatusEffectType } from './enemy';
import { Item, ItemSlot, WeaponType, Rarity, ItemStats, LootManager, CraftingMaterial } from './items';
import { SKILL_REGISTRY } from './skills';
import { AssetService } from './asset-service';
import { DungeonGenerator, TileType, Room } from './dungeon-generator';
import { Pathfinding } from './pathfinding';
import { Interactable, InteractableType, createFallbackTexture } from './interactable';

import { PASSIVE_TREE } from './passives';

export interface CharacterStats {
  level: number;
  exp: number;
  expToNext: number;
  skillPoints: number;
  strength: number;
  dexterity: number;
  intelligence: number;
  vitality: number;
  allocatedPassives: string[];
  // Derived
  attack: number;
  defense: number;
  speed: number;
  maxHealth: number;
  critChance: number;
  critDamage: number;
  attackSpeed: number;
  castSpeed: number;
  lifeRegeneration: number;
  lifeLeechAttack: number;
  lifeLeechSpell: number;
  fireResistance: number;
  lightningResistance: number;
  iceResistance: number;
  poisonResistance: number;
  maxLifeLeechRate: number;
}

@Injectable({
  providedIn: 'root'
})
export class GameEngine {
  private ngZone = inject(NgZone);
  private platformId = inject(PLATFORM_ID);
  private assetService = inject(AssetService);
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private stats!: Stats;
  private world!: RAPIER.World;
  
  private player!: THREE.Group;
  private playerBody!: RAPIER.RigidBody;
  private groundPlane!: THREE.Mesh;
  
  private enemies: Enemy[] = [];
  private interactables: Interactable[] = [];
  public interactablesSignal = signal<Interactable[]>([]);
  private targetPosition: THREE.Vector3 | null = null;
  private cursorPosition: THREE.Vector3 | null = null;
  private lastAttackTime = 0;
  private lastCastTime = 0;
  private envColliders: RAPIER.Collider[] = [];
  
  private playerMixer?: THREE.AnimationMixer;
  private playerActionIdle?: THREE.AnimationAction;
  private playerActionRun?: THREE.AnimationAction;
  private activeAction?: THREE.AnimationAction;
  
  // Instanced Particles
  private particleSystem!: THREE.InstancedMesh;
  private particleData: { velocity: THREE.Vector3, life: number, maxLife: number }[] = [];
  private maxParticles = 1000;
  private particleCount = 0;
  
  // Minimap Data
  public playerPos = signal<{ x: number, z: number }>({ x: 0, z: 0 });
  public enemyPositions = signal<{ x: number, z: number }[]>([]);
  public mapSize = signal<number>(100); // Total width/height of the map
  public tileSize = 4;
  public dungeonRooms = signal<Room[]>([]);
  public dungeonGrid = signal<number[][]>([]);
  public pathfinding: Pathfinding | null = null;
  
  // UI Data (Juice & Survival)
  public playerHealth = signal<number>(100);
  public damageNumbers = signal<{id: string, text: string, x: number, y: number, color: string, opacity: number}[]>([]);
  private activeDamageNumbers: {id: string, text: string, pos: THREE.Vector3, color: string, life: number, maxLife: number}[] = [];
  private activeLeeches: { amountPerSec: number, remainingTime: number }[] = [];
  public enemyUI = signal<{id: string, x: number, y: number, hpPercent: number, effects: {type: string, duration: number}[]}[]>([]);

  public activeAttack = signal<string>('strike');
  public activeSpell = signal<string>('fireball');
  public attackCooldownProgress = signal<number>(0);
  public spellCooldownProgress = signal<number>(0);
  public linkedSupports = signal<Record<string, string[]>>({
    'strike': [], 'cleave': [], 'leap': [], 'fireball': [], 'nova': [], 'arc': []
  });

  public getSkillStats(skillId: string) {
    const baseSkill = SKILL_REGISTRY[skillId];
    const playerStats = this.derivedStats();
    const links = this.linkedSupports()[skillId] || [];
    
    let damage = baseSkill.baseDamage;
    let cooldown = baseSkill.baseCooldown;
    let aoe = baseSkill.baseAoe || 1;
    let projectiles = baseSkill.baseProjectiles || 1;
    
    // Apply player stats scaling
    if (baseSkill.category === 'attack') {
      damage += playerStats.attack;
      cooldown /= playerStats.attackSpeed;
    } else if (baseSkill.category === 'spell') {
      damage += playerStats.intelligence * 2;
      cooldown /= playerStats.castSpeed;
    }
    
    // Apply support gems
    for (const supportId of links) {
      const support = SKILL_REGISTRY[supportId];
      if (support && support.supportEffects) {
        if (support.supportEffects.damageMultiplier) damage *= support.supportEffects.damageMultiplier;
        if (support.supportEffects.cooldownMultiplier) cooldown *= support.supportEffects.cooldownMultiplier;
        if (support.supportEffects.aoeMultiplier) aoe *= support.supportEffects.aoeMultiplier;
        if (support.supportEffects.projectiles) projectiles += support.supportEffects.projectiles;
      }
    }
    
    // Crit
    let isCrit = false;
    if (Math.random() * 100 < playerStats.critChance) {
      damage *= (1 + playerStats.critDamage / 100);
      isCrit = true;
    }

    return {
      damage,
      cooldown,
      aoe,
      projectiles,
      isCrit
    };
  }

  public currentRegion = signal<'town' | 'dungeon'>('town');
  public dungeonLevel = signal<number>(1);
  public gameState = signal<'menu' | 'playing' | 'settings' | 'dead'>('menu');
  public isNearVendor = signal<boolean>(false);
  public isNearGambler = signal<boolean>(false);
  public isNearChest = signal<boolean>(false);
  public isNearCraftingBench = signal<boolean>(false);
  
  public vendorLevel = signal<number>(1);
  
  // RPG Systems
  public inventory = signal<Item[]>([]);
  public chest = signal<Item[]>([]);
  public equipped = signal<Partial<Record<ItemSlot, Item>>>({});
  public gold = signal<number>(0);
  public materials = signal<Record<CraftingMaterial, number>>({
    [CraftingMaterial.DUST]: 0,
    [CraftingMaterial.SHARD]: 0,
    [CraftingMaterial.ESSENCE]: 0,
    [CraftingMaterial.RUNE]: 0
  });
  
  public baseStats = signal<CharacterStats>({
    level: 1,
    exp: 0,
    expToNext: 100,
    skillPoints: 0,
    strength: 10,
    dexterity: 10,
    intelligence: 10,
    vitality: 10,
    allocatedPassives: ['start'],
    attack: 0,
    defense: 0,
    speed: 8, // Increased base speed
    maxHealth: 100,
    critChance: 5, // 5% base crit
    critDamage: 100, // 100% extra damage
    attackSpeed: 1.0, // 1 attack per second base
    castSpeed: 1.0, // 1 cast per second base
    lifeRegeneration: 0,
    lifeLeechAttack: 0,
    lifeLeechSpell: 0,
    fireResistance: 0,
    lightningResistance: 0,
    iceResistance: 0,
    poisonResistance: 0,
    maxLifeLeechRate: 10
  });

  public derivedStats = computed(() => {
    const base = this.baseStats();
    const equip = this.equipped();
    
    let bonusAttack = 0;
    let bonusDefense = 0;
    let bonusSpeed = 0;
    let bonusInt = 0;
    let bonusStr = 0;
    let bonusDex = 0;
    let bonusVit = 0;
    let bonusCritChance = 0;
    let bonusCritDamage = 0;
    let bonusAttackSpeed = 0;
    let bonusCastSpeed = 0;
    let bonusLifeRegen = 0;
    let bonusLifeLeechAttack = 0;
    let bonusLifeLeechSpell = 0;
    let bonusFireRes = 0;
    let bonusLightningRes = 0;
    let bonusIceRes = 0;
    let bonusPoisonRes = 0;

    Object.values(equip).forEach(item => {
      if (item) {
        bonusAttack += item.stats.attack || 0;
        bonusDefense += item.stats.defense || 0;
        bonusSpeed += item.stats.speed || 0;
        bonusInt += item.stats.intelligence || 0;
        bonusStr += item.stats.strength || 0;
        bonusDex += item.stats.dexterity || 0;
        bonusVit += item.stats.vitality || 0;
        bonusCritChance += item.stats.critChance || 0;
        bonusCritDamage += item.stats.critDamage || 0;
        bonusAttackSpeed += item.stats.attackSpeed || 0;
        bonusCastSpeed += item.stats.castSpeed || 0;
        bonusLifeRegen += item.stats.lifeRegeneration || 0;
        bonusLifeLeechAttack += item.stats.lifeLeechAttack || 0;
        bonusLifeLeechSpell += item.stats.lifeLeechSpell || 0;
        bonusFireRes += item.stats.fireResistance || 0;
        bonusLightningRes += item.stats.lightningResistance || 0;
        bonusIceRes += item.stats.iceResistance || 0;
        bonusPoisonRes += item.stats.poisonResistance || 0;
      }
    });

    // Weapon specific base attack speed
    let baseWeaponAttackSpeed = base.attackSpeed;
    const mainHand = equip[ItemSlot.MAIN_HAND];
    if (mainHand && mainHand.weaponType) {
      switch (mainHand.weaponType) {
        case WeaponType.DAGGER: baseWeaponAttackSpeed = 1.5; break;
        case WeaponType.SWORD: baseWeaponAttackSpeed = 1.2; break;
        case WeaponType.WAND: baseWeaponAttackSpeed = 1.2; break;
        case WeaponType.BOW: baseWeaponAttackSpeed = 1.0; break;
        case WeaponType.AXE: baseWeaponAttackSpeed = 0.9; break;
        case WeaponType.MACE: baseWeaponAttackSpeed = 0.8; break;
        case WeaponType.STAFF: baseWeaponAttackSpeed = 0.8; break;
        case WeaponType.GREATSWORD: baseWeaponAttackSpeed = 0.7; break;
        case WeaponType.SPELLBLADE: baseWeaponAttackSpeed = 1.1; break;
      }
    }

    const totalStr = base.strength + bonusStr;
    const totalDex = base.dexterity + bonusDex;
    const totalInt = base.intelligence + bonusInt;
    const totalVit = base.vitality + bonusVit;

    // Apply Passive Tree Stats
    let passiveStr = 0;
    let passiveDex = 0;
    let passiveInt = 0;
    let passiveVit = 0;
    let passiveMaxHealthMult = 1;
    let passiveDamageMult = 1;
    let passiveAttackSpeedMult = 1;
    let passiveMovementSpeedMult = 1;
    let passiveCritChance = 0;
    let passiveCritDamage = 0;

    (base.allocatedPassives || []).forEach(nodeId => {
      const node = PASSIVE_TREE[nodeId];
      if (node && node.stats) {
        passiveStr += node.stats.strength || 0;
        passiveDex += node.stats.dexterity || 0;
        passiveInt += node.stats.intelligence || 0;
        passiveVit += node.stats.vitality || 0;
        if (node.stats.maxHealthMultiplier) passiveMaxHealthMult *= node.stats.maxHealthMultiplier;
        if (node.stats.damageMultiplier) passiveDamageMult *= node.stats.damageMultiplier;
        if (node.stats.attackSpeedMultiplier) passiveAttackSpeedMult *= node.stats.attackSpeedMultiplier;
        if (node.stats.movementSpeedMultiplier) passiveMovementSpeedMult *= node.stats.movementSpeedMultiplier;
        passiveCritChance += node.stats.critChance || 0;
        passiveCritDamage += node.stats.critDamage || 0;
      }
    });

    const finalStr = totalStr + passiveStr;
    const finalDex = totalDex + passiveDex;
    const finalInt = totalInt + passiveInt;
    const finalVit = totalVit + passiveVit;

    return {
      ...base,
      strength: finalStr,
      dexterity: finalDex,
      intelligence: finalInt,
      vitality: finalVit,
      attack: (finalStr * 2 + bonusAttack) * passiveDamageMult,
      defense: finalVit + bonusDefense,
      speed: (base.speed + (finalDex / 10) + bonusSpeed) * passiveMovementSpeedMult,
      maxHealth: (finalVit * 10) * passiveMaxHealthMult,
      critChance: base.critChance + bonusCritChance + (finalDex / 5) + passiveCritChance,
      critDamage: base.critDamage + bonusCritDamage + (finalStr / 2) + passiveCritDamage,
      attackSpeed: baseWeaponAttackSpeed * (1 + (bonusAttackSpeed / 100)) * passiveAttackSpeedMult,
      castSpeed: base.castSpeed * (1 + (bonusCastSpeed / 100)) * passiveAttackSpeedMult, // Assuming attack speed mult affects cast speed too for simplicity
      lifeRegeneration: bonusLifeRegen,
      lifeLeechAttack: bonusLifeLeechAttack,
      lifeLeechSpell: bonusLifeLeechSpell,
      fireResistance: bonusFireRes,
      lightningResistance: bonusLightningRes,
      iceResistance: bonusIceRes,
      poisonResistance: bonusPoisonRes,
      maxLifeLeechRate: base.maxLifeLeechRate
    };
  });

  private isInitialized = false;

  async init(container: ElementRef<HTMLDivElement>) {
    if (this.isInitialized || !isPlatformBrowser(this.platformId)) return;

    // Initialize Rapier
    await RAPIER.init();
    const gravity = { x: 0.0, y: -9.81, z: 0.0 };
    this.world = new RAPIER.World(gravity);

    // Three.js Setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a24);
    this.scene.fog = new THREE.FogExp2(0x1a1a24, 0.015);

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    
    // Isometric-like position
    this.camera.position.set(15, 15, 15);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2.0; // Increased for better contrast
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.nativeElement.appendChild(this.renderer.domElement);

    // Stats
    this.stats = new Stats();
    this.stats.showPanel(0);
    document.body.appendChild(this.stats.dom);

    // Lighting
    // Dark but high-contrast ambient
    const ambientLight = new THREE.AmbientLight(0x444455, 2.0);
    this.scene.add(ambientLight);

    // Strong directional light for sharp shadows and contrast
    const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
    sunLight.position.set(20, 30, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 30;
    sunLight.shadow.camera.bottom = -30;
    this.scene.add(sunLight);

    // Player
    this.createPlayer();

    // Player Light (Diablo style - High Intensity, Small Radius)
    const playerLight = new THREE.PointLight(0xffaa00, 15, 12);
    playerLight.position.set(0, 2, 0);
    playerLight.castShadow = true;
    playerLight.shadow.bias = -0.001;
    this.player.add(playerLight);

    // Environment
    this.createEnvironment();

    // Event Listeners
    window.addEventListener('resize', () => this.onWindowResize());
    window.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.isInitialized = true;
    this.animate();
  }

  private onKeyDown(event: KeyboardEvent) {
    if (this.gameState() !== 'playing') return;
    if (event.code === 'Space') {
      this.attack();
    }
    if (event.code === 'Digit1') {
      this.castSpell();
    }
  }

  public equipItem(item: Item) {
    this.equipped.update(current => {
      const newEquipped = { ...current };
      let targetSlot = item.slot;

      // Ring logic
      if (item.slot === ItemSlot.RING_1 || item.slot === ItemSlot.RING_2) {
        if (!newEquipped[ItemSlot.RING_1]) targetSlot = ItemSlot.RING_1;
        else if (!newEquipped[ItemSlot.RING_2]) targetSlot = ItemSlot.RING_2;
        else targetSlot = ItemSlot.RING_1; // Replace ring 1 by default
      }

      const itemToEquip = { ...item, slot: targetSlot };
      const oldItem = newEquipped[targetSlot];
      
      const itemsToInventory: Item[] = [];
      if (oldItem) itemsToInventory.push(oldItem);

      // Handle two-handed weapons
      if (targetSlot === ItemSlot.MAIN_HAND && itemToEquip.isTwoHanded) {
        const offHand = newEquipped[ItemSlot.OFF_HAND];
        if (offHand) {
          itemsToInventory.push(offHand);
          delete newEquipped[ItemSlot.OFF_HAND];
        }
      } else if (targetSlot === ItemSlot.OFF_HAND) {
        const mainHand = newEquipped[ItemSlot.MAIN_HAND];
        if (mainHand && mainHand.isTwoHanded) {
          itemsToInventory.push(mainHand);
          delete newEquipped[ItemSlot.MAIN_HAND];
        }
      }

      newEquipped[targetSlot] = itemToEquip;
      
      // Remove newly equipped item from inventory
      this.inventory.update(inv => {
        const newInv = inv.filter(i => i.id !== item.id);
        return [...newInv, ...itemsToInventory];
      });
      
      return newEquipped;
    });
  }

  public unequipItem(slot: ItemSlot) {
    this.equipped.update(current => {
      const item = current[slot];
      if (!item) return current;

      const newEquipped = { ...current };
      delete newEquipped[slot];

      this.inventory.update(inv => [...inv, item]);
      return newEquipped;
    });
  }

  public spawnParticles(pos: THREE.Vector3, colorHex: number, count: number = 10) {
    const color = new THREE.Color(colorHex);
    const dummy = new THREE.Object3D();
    
    for (let i = 0; i < count; i++) {
      if (this.particleCount >= this.maxParticles) break;
      
      const idx = this.particleCount;
      dummy.position.copy(pos);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      
      this.particleSystem.setMatrixAt(idx, dummy.matrix);
      this.particleSystem.setColorAt(idx, color);
      
      this.particleData[idx] = {
        velocity: new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 10, (Math.random() - 0.5) * 10),
        life: 1.0,
        maxLife: 1.0
      };
      
      this.particleCount++;
    }
    
    this.particleSystem.instanceMatrix.needsUpdate = true;
    if (this.particleSystem.instanceColor) this.particleSystem.instanceColor.needsUpdate = true;
    this.particleSystem.count = this.particleCount;
  }

  public spawnDamageNumber(pos: THREE.Vector3, amount: number | string, color = '#ffffff') {
    this.activeDamageNumbers.push({
      id: Math.random().toString(36).substr(2, 9),
      text: amount.toString(),
      pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, Math.random() * 0.5, (Math.random() - 0.5) * 0.5)),
      color,
      life: 1.0,
      maxLife: 1.0
    });
  }

  private applyLifeLeech(damage: number, isSpell: boolean) {
    const stats = this.derivedStats();
    const leechPercent = isSpell ? stats.lifeLeechSpell : stats.lifeLeechAttack;
    if (leechPercent > 0) {
      const totalHeal = damage * (leechPercent / 100);
      const amountPerSec = totalHeal / 5;
      this.activeLeeches.push({ amountPerSec, remainingTime: 5 });
    }
  }

  private castSpell() {
    const skillId = this.activeSpell();
    const stats = this.getSkillStats(skillId);
    const now = Date.now();
    if (now - this.lastCastTime < stats.cooldown * 1000) return;
    this.lastCastTime = now;

    // Animation
    if (this.activeAction !== this.playerActionIdle) {
      this.activeAction?.stop();
      this.activeAction = this.playerActionIdle;
      this.activeAction?.play();
    }

    const playerPos = this.player.position.clone();
    let playerDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.player.quaternion);
    if (this.cursorPosition) {
      playerDir = new THREE.Vector3().subVectors(this.cursorPosition, playerPos);
      playerDir.y = 0;
      playerDir.normalize();
      const angle = Math.atan2(playerDir.x, playerDir.z);
      this.player.rotation.y = angle;
    }

    if (skillId === 'nova') {
      // AoE Circle
      this.spawnParticles(playerPos, 0x00aaff, 40); // Big burst
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const enemy = this.enemies[i];
        if (enemy.mesh.position.distanceTo(playerPos) < stats.aoe) {
          const isDead = enemy.takeDamage(stats.damage);
          enemy.applyStatusEffect(StatusEffectType.FREEZE, 3.0, 50);
          this.applyLifeLeech(stats.damage, true);
          this.spawnDamageNumber(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(stats.damage) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : '#00aaff');
          if (isDead) this.enemies.splice(i, 1);
        }
      }
    } else if (skillId === 'meteor') {
      // Meteor (Delayed AoE at cursor)
      const targetPos = this.cursorPosition ? this.cursorPosition.clone() : playerPos.clone().add(playerDir.clone().multiplyScalar(5));
      
      // Warning circle
      this.spawnParticles(targetPos, 0xff2200, 10);
      
      setTimeout(() => {
        // Impact
        this.spawnParticles(targetPos, 0xff2200, 50);
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          const enemy = this.enemies[i];
          if (enemy.mesh.position.distanceTo(targetPos) < stats.aoe) {
            const isDead = enemy.takeDamage(stats.damage);
            enemy.applyStatusEffect(StatusEffectType.BURN, 5.0, stats.damage * 0.2);
            this.applyLifeLeech(stats.damage, true);
            this.spawnDamageNumber(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(stats.damage) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : '#ff2200');
            if (isDead) this.enemies.splice(i, 1);
          }
        }
      }, 1000);
    } else if (skillId === 'arc') {
      // Chain Lightning
      let currentPos = playerPos.clone().add(new THREE.Vector3(0, 1, 0));
      let remainingChains = stats.projectiles + 2; // Base chains
      let hitEnemies = new Set<Enemy>();
      
      const findNextTarget = (pos: THREE.Vector3) => {
        let closest = null;
        let minDist = stats.aoe;
        for (const enemy of this.enemies) {
          if (!hitEnemies.has(enemy)) {
            const dist = enemy.mesh.position.distanceTo(pos);
            if (dist < minDist) {
              minDist = dist;
              closest = enemy;
            }
          }
        }
        return closest;
      };

      const chain = () => {
        if (remainingChains <= 0) return;
        const target = findNextTarget(currentPos);
        if (!target) return;

        const targetPos = target.mesh.position.clone().add(new THREE.Vector3(0, 1, 0));
        
        // Visual lightning bolt (simple line)
        const material = new THREE.LineBasicMaterial({ color: 0xaa00ff, linewidth: 2 });
        const points = [currentPos, targetPos];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        this.scene.add(line);
        setTimeout(() => this.scene.remove(line), 150);
        this.spawnParticles(targetPos, 0xaa00ff, 5);

        const isDead = target.takeDamage(stats.damage);
        target.applyStatusEffect(StatusEffectType.SHOCK, 4.0, 20);
        this.applyLifeLeech(stats.damage, true);
        this.spawnDamageNumber(targetPos.clone().add(new THREE.Vector3(0, 0.5, 0)), Math.floor(stats.damage) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : '#aa00ff');
        
        hitEnemies.add(target);
        if (isDead) {
          const idx = this.enemies.indexOf(target);
          if (idx > -1) this.enemies.splice(idx, 1);
        }

        currentPos = targetPos;
        remainingChains--;
        setTimeout(chain, 100); // Delay between chains
      };
      
      chain();
    } else {
      // Projectiles (Fireball, Ice Spear)
      const count = Math.max(1, stats.projectiles);
      const spreadAngle = Math.PI / 12; // 15 degrees
      const startAngle = count > 1 ? -(spreadAngle * (count - 1)) / 2 : 0;
      
      const isPiercing = skillId === 'ice_spear';
      const projColor = skillId === 'ice_spear' ? 0x88ffff : 0xff5500;
      const projSpeed = skillId === 'ice_spear' ? 30 : 20;

      for (let i = 0; i < count; i++) {
        const angleOffset = startAngle + i * spreadAngle;
        const dir = playerDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOffset);
        
        const geom = new THREE.SphereGeometry(0.3);
        const mat = new THREE.MeshBasicMaterial({ color: projColor });
        const proj = new THREE.Mesh(geom, mat);
        proj.position.copy(playerPos).add(new THREE.Vector3(0, 1, 0));
        this.scene.add(proj);

        const startTime = Date.now();
        const duration = 2000;
        const hitEnemies = new Set<Enemy>();

        const updateSpell = () => {
          const elapsed = Date.now() - startTime;
          if (elapsed > duration) {
            this.scene.remove(proj);
            return;
          }

          // Check wall collision using Rapier raycast
          const ray = new RAPIER.Ray(
            { x: proj.position.x, y: proj.position.y, z: proj.position.z },
            { x: dir.x, y: dir.y, z: dir.z }
          );
          const hit = this.world.castRay(ray, projSpeed * 0.016, true);
          if (hit && hit.collider && !hit.collider.parent()) {
            this.scene.remove(proj);
            return;
          }

          proj.position.add(dir.clone().multiplyScalar(projSpeed * 0.016));
          this.spawnParticles(proj.position, projColor, 1); // Trail
          
          // Hit detection
          for (let j = this.enemies.length - 1; j >= 0; j--) {
            const enemy = this.enemies[j];
            if (hitEnemies.has(enemy)) continue;
            
            const enemyCenter = enemy.mesh.position.clone();
            enemyCenter.y += 1;
            
            if (proj.position.distanceTo(enemyCenter) < 1.5) {
              hitEnemies.add(enemy);
              const isDead = enemy.takeDamage(stats.damage);
              if (skillId === 'ice_spear') {
                enemy.applyStatusEffect(StatusEffectType.FREEZE, 2.0, 30);
              } else if (skillId === 'fireball') {
                enemy.applyStatusEffect(StatusEffectType.BURN, 3.0, stats.damage * 0.3);
              }
              this.applyLifeLeech(stats.damage, true);
              this.spawnDamageNumber(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(stats.damage) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : (skillId === 'ice_spear' ? '#88ffff' : '#ff5500'));
              if (isDead) this.enemies.splice(j, 1);
              
              if (!isPiercing) {
                this.scene.remove(proj);
                return;
              }
            }
          }
          requestAnimationFrame(updateSpell);
        };
        updateSpell();
      }
    }
  }

  private attack() {
    const skillId = this.activeAttack();
    const stats = this.getSkillStats(skillId);
    const now = Date.now();
    if (now - this.lastAttackTime < stats.cooldown * 1000) return;
    this.lastAttackTime = now;

    const playerPos = this.player.position.clone();
    let playerDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.player.quaternion);
    
    if (this.cursorPosition) {
      playerDir = new THREE.Vector3().subVectors(this.cursorPosition, playerPos);
      playerDir.y = 0;
      playerDir.normalize();
      const angle = Math.atan2(playerDir.x, playerDir.z);
      this.player.rotation.y = angle;
    }

    if (skillId === 'cleave') {
      // AoE Cone
      this.spawnParticles(playerPos.clone().add(playerDir.clone().multiplyScalar(2)), 0xffaa00, 20);
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const enemy = this.enemies[i];
        const dirToEnemy = enemy.mesh.position.clone().sub(playerPos);
        const dist = dirToEnemy.length();
        if (dist < stats.aoe) {
          dirToEnemy.normalize();
          const angle = playerDir.angleTo(dirToEnemy);
          if (angle < Math.PI / 3) { // 60 degree cone
            const isDead = enemy.takeDamage(stats.damage);
            this.applyLifeLeech(stats.damage, false);
            this.spawnDamageNumber(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(stats.damage) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : '#ffaa00');
            if (isDead) this.enemies.splice(i, 1);
          }
        }
      }
    } else if (skillId === 'whirlwind') {
      // AoE Circle around player
      this.spawnParticles(playerPos, 0xaaaaaa, 30);
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const enemy = this.enemies[i];
        if (enemy.mesh.position.distanceTo(playerPos) < stats.aoe) {
          const isDead = enemy.takeDamage(stats.damage);
          this.applyLifeLeech(stats.damage, false);
          this.spawnDamageNumber(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(stats.damage) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : '#aaaaaa');
          if (isDead) this.enemies.splice(i, 1);
        }
      }
    } else if (skillId === 'leap') {
      // Leap Slam
      const jumpDist = Math.min(8, stats.aoe * 1.5);
      const targetPos = playerPos.clone().add(playerDir.clone().multiplyScalar(jumpDist));
      
      // Simple jump animation
      const jumpDuration = 400;
      const startTime = Date.now();
      const startY = playerPos.y;
      
      const jumpAnim = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / jumpDuration);
        
        // Parabola
        const height = Math.sin(progress * Math.PI) * 3;
        
        const currentPos = new THREE.Vector3().lerpVectors(playerPos, targetPos, progress);
        currentPos.y = startY + height;
        
        this.player.position.copy(currentPos);
        
        // Update physics body position manually for the jump
        this.playerBody.setTranslation(currentPos, true);
        
        if (progress < 1) {
          requestAnimationFrame(jumpAnim);
        } else {
          // Landed
          this.spawnParticles(targetPos, 0xff8844, 30);
          for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (enemy.mesh.position.distanceTo(targetPos) < stats.aoe) {
              const isDead = enemy.takeDamage(stats.damage);
              this.applyLifeLeech(stats.damage, false);
              this.spawnDamageNumber(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(stats.damage) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : '#ff8844');
              if (isDead) this.enemies.splice(i, 1);
            }
          }
        }
      };
      jumpAnim();
      
    } else {
      // Strike / Smite (Single target, closest)
      const color = skillId === 'smite' ? 0xffffaa : 0xff4444;
      this.spawnParticles(playerPos.clone().add(playerDir), color, 10);
      let closestEnemy = null;
      let closestDist = stats.aoe;
      let closestIdx = -1;
      
      for (let i = 0; i < this.enemies.length; i++) {
        const enemy = this.enemies[i];
        const dist = enemy.mesh.position.distanceTo(playerPos);
        if (dist < closestDist) {
          closestDist = dist;
          closestEnemy = enemy;
          closestIdx = i;
        }
      }

      if (closestEnemy) {
        const isDead = closestEnemy.takeDamage(stats.damage);
        this.applyLifeLeech(stats.damage, false);
        this.spawnDamageNumber(closestEnemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(stats.damage) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : (skillId === 'smite' ? '#ffffaa' : '#ff4444'));
        
        if (skillId === 'smite') {
          // Lightning strike visual
          const targetPos = closestEnemy.mesh.position.clone();
          const material = new THREE.LineBasicMaterial({ color: 0xffffaa, linewidth: 3 });
          const points = [targetPos.clone().add(new THREE.Vector3(0, 10, 0)), targetPos];
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(geometry, material);
          this.scene.add(line);
          setTimeout(() => this.scene.remove(line), 150);
          this.spawnParticles(targetPos, 0xffffaa, 20);
          
          // Smite AoE
          for (let i = this.enemies.length - 1; i >= 0; i--) {
            if (i === closestIdx) continue;
            const enemy = this.enemies[i];
            if (enemy.mesh.position.distanceTo(targetPos) < stats.aoe) {
              const isDeadAoE = enemy.takeDamage(stats.damage * 0.5); // 50% damage to AoE
              this.applyLifeLeech(stats.damage * 0.5, false);
              this.spawnDamageNumber(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(stats.damage * 0.5) + (stats.isCrit ? '!' : ''), stats.isCrit ? '#ff00ff' : '#ffffaa');
              if (isDeadAoE) this.enemies.splice(i, 1);
            }
          }
        }

        if (isDead) {
          const idx = this.enemies.indexOf(closestEnemy);
          if (idx > -1) this.enemies.splice(idx, 1);
        }
      }
    }
  }

  private shootProjectile(startPos: THREE.Vector3, direction: THREE.Vector3, stats: CharacterStats) {
    const projGeom = new THREE.SphereGeometry(0.2);
    const projMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    const proj = new THREE.Mesh(projGeom, projMat);
    proj.position.copy(startPos).add(new THREE.Vector3(0, 1, 0));
    this.scene.add(proj);

    const speed = 20;
    let damage = stats.attack;
    let isCrit = false;
    if (Math.random() * 100 < stats.critChance) {
      damage *= (1 + stats.critDamage / 100);
      isCrit = true;
    }

    const startTime = Date.now();
    const duration = 1500;

    const updateProj = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > duration) {
        this.scene.remove(proj);
        return;
      }

      // Check wall collision using Rapier raycast
      const ray = new RAPIER.Ray(
        { x: proj.position.x, y: proj.position.y, z: proj.position.z },
        { x: direction.x, y: direction.y, z: direction.z }
      );
      const hit = this.world.castRay(ray, speed * 0.016, true);
      if (hit && hit.collider && !hit.collider.parent()) {
        this.scene.remove(proj);
        return;
      }

      proj.position.add(direction.clone().multiplyScalar(speed * 0.016));
      
      // Hit detection
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const enemy = this.enemies[i];
        const enemyCenter = enemy.mesh.position.clone();
        enemyCenter.y += 1;
        
        if (proj.position.distanceTo(enemyCenter) < 1.5) {
          const isDead = enemy.takeDamage(damage);
          this.applyLifeLeech(damage, false);
          this.spawnDamageNumber(
            enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 
            Math.floor(damage) + (isCrit ? '!' : ''), 
            isCrit ? '#ff00ff' : '#ffff00'
          );
          if (isDead) this.enemies.splice(i, 1);
          this.scene.remove(proj);
          return;
        }
      }
      requestAnimationFrame(updateProj);
    };
    updateProj();
  }

  private createEnvironment() {
    // Clear existing environment
    this.enemies.forEach(e => {
      e.onDeath = undefined;
      e.destroy();
    });
    this.enemies = [];
    
    this.interactables.forEach(i => {
      if (i.mesh) this.scene.remove(i.mesh);
    });
    this.interactables = [];
    this.interactablesSignal.set([]);
    
    // Clear physics colliders
    this.envColliders.forEach(c => this.world.removeCollider(c, true));
    this.envColliders = [];
    
    // Properly dispose of old scene objects to prevent memory leaks
    const objectsToRemove: THREE.Object3D[] = [];
    this.scene.children.forEach(child => {
      if (child !== this.player && child !== this.particleSystem) {
        objectsToRemove.push(child);
      }
    });
    
    objectsToRemove.forEach(obj => {
      this.scene.remove(obj);
      obj.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.dispose();
        }
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m.dispose());
          } else {
            mesh.material.dispose();
          }
        }
      });
    });
    
    // Re-add lights
    const ambientLight = new THREE.AmbientLight(0x444455, 2.0);
    this.scene.add(ambientLight);
    const sunLight = new THREE.DirectionalLight(0xffffff, 3.0);
    sunLight.position.set(20, 30, 10);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.left = -30;
    sunLight.shadow.camera.right = 30;
    sunLight.shadow.camera.top = 30;
    sunLight.shadow.camera.bottom = -30;
    this.scene.add(sunLight);

    // Re-add player
    this.scene.add(this.player);

    if (this.currentRegion() === 'town') {
      this.createTown();
    } else {
      this.createDungeon();
    }
  }

  private vendorPosition = new THREE.Vector3(5, 1, 5);
  private gamblerPosition = new THREE.Vector3(-5, 1, -5);
  private chestPosition = new THREE.Vector3(-5, 1, 5);
  private craftingBenchPosition = new THREE.Vector3(5, 1, -5);

  private createTown() {
    this.mapSize.set(40);
    this.dungeonRooms.set([]);
    this.dungeonGrid.set([]);
    
    // Invisible ground plane for raycasting
    const groundGeometry = new THREE.PlaneGeometry(this.mapSize(), this.mapSize());
    const groundMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.groundPlane);

    // Town Floor
    const floorGeom = new THREE.PlaneGeometry(this.mapSize(), this.mapSize());
    floorGeom.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x3a4a3a }); // Grassy
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.receiveShadow = true;
    this.scene.add(floor);

    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(this.mapSize() / 2, 0.1, this.mapSize() / 2)
      .setTranslation(0, -0.1, 0);
    this.envColliders.push(this.world.createCollider(groundColliderDesc));

    // Town Walls (Visible)
    const wallGeom = new THREE.BoxGeometry(this.mapSize(), 4, 1);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2a3a2a });
    
    const wallN = new THREE.Mesh(wallGeom, wallMat);
    wallN.position.set(0, 2, -this.mapSize()/2);
    this.scene.add(wallN);
    this.envColliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(this.mapSize()/2, 2, 0.5).setTranslation(0, 2, -this.mapSize()/2)));

    const wallS = new THREE.Mesh(wallGeom, wallMat);
    wallS.position.set(0, 2, this.mapSize()/2);
    this.scene.add(wallS);
    this.envColliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(this.mapSize()/2, 2, 0.5).setTranslation(0, 2, this.mapSize()/2)));

    const wallEGeom = new THREE.BoxGeometry(1, 4, this.mapSize());
    const wallE = new THREE.Mesh(wallEGeom, wallMat);
    wallE.position.set(this.mapSize()/2, 2, 0);
    this.scene.add(wallE);
    this.envColliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 2, this.mapSize()/2).setTranslation(this.mapSize()/2, 2, 0)));

    const wallW = new THREE.Mesh(wallEGeom, wallMat);
    wallW.position.set(-this.mapSize()/2, 2, 0);
    this.scene.add(wallW);
    this.envColliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 2, this.mapSize()/2).setTranslation(-this.mapSize()/2, 2, 0)));

    // Campfire
    const fireGeom = new THREE.ConeGeometry(1, 2, 8);
    const fireMat = new THREE.MeshStandardMaterial({ color: 0xff4400, emissive: 0xff4400 });
    const fire = new THREE.Mesh(fireGeom, fireMat);
    fire.position.set(0, 1, 0);
    this.scene.add(fire);
    
    const fireLight = new THREE.PointLight(0xffaa00, 10, 20);
    fireLight.position.set(0, 2, 0);
    this.scene.add(fireLight);

    // Vendor NPC
    const vendorGeom = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
    const vendorMat = new THREE.MeshStandardMaterial({ color: 0x0000ff });
    const vendor = new THREE.Mesh(vendorGeom, vendorMat);
    vendor.position.copy(this.vendorPosition);
    vendor.castShadow = true;
    this.scene.add(vendor);
    this.envColliders.push(this.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.5).setTranslation(this.vendorPosition.x, this.vendorPosition.y, this.vendorPosition.z)));

    // Gambler NPC
    const gamblerMat = new THREE.MeshStandardMaterial({ color: 0x800080 }); // Purple
    const gambler = new THREE.Mesh(vendorGeom, gamblerMat);
    gambler.position.copy(this.gamblerPosition);
    gambler.castShadow = true;
    this.scene.add(gambler);
    this.envColliders.push(this.world.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.5).setTranslation(this.gamblerPosition.x, this.gamblerPosition.y, this.gamblerPosition.z)));

    // Chest
    const chestGeom = new THREE.BoxGeometry(1.2, 1, 0.8);
    const chestMat = new THREE.MeshStandardMaterial({ color: 0x8b4513 }); // SaddleBrown
    const chestMesh = new THREE.Mesh(chestGeom, chestMat);
    chestMesh.position.copy(this.chestPosition);
    chestMesh.castShadow = true;
    this.scene.add(chestMesh);
    this.envColliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.5, 0.4).setTranslation(this.chestPosition.x, this.chestPosition.y, this.chestPosition.z)));
    
    // Crafting Bench (Anvil)
    const anvilGeom = new THREE.BoxGeometry(1, 0.8, 1.5);
    const anvilMat = new THREE.MeshStandardMaterial({ color: 0x444444 });
    const anvil = new THREE.Mesh(anvilGeom, anvilMat);
    anvil.position.copy(this.craftingBenchPosition);
    anvil.castShadow = true;
    this.scene.add(anvil);
    this.envColliders.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.4, 0.75).setTranslation(this.craftingBenchPosition.x, this.craftingBenchPosition.y, this.craftingBenchPosition.z)));

    // Dungeon Portal
    const portalGeom = new THREE.TorusGeometry(2, 0.2, 8, 16);
    const portalMat = new THREE.MeshStandardMaterial({ color: 0xaa00ff, emissive: 0xaa00ff });
    this.portalMesh = new THREE.Mesh(portalGeom, portalMat);
    this.portalMesh.position.set(-5, 2, -5);
    this.scene.add(this.portalMesh);

    // Initialize Particle System
    const pGeom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleSystem = new THREE.InstancedMesh(pGeom, pMat, this.maxParticles);
    this.particleSystem.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleSystem.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
    this.particleSystem.count = 0;
    this.scene.add(this.particleSystem);

    this.player.position.set(0, 1, 5);
    this.playerBody.setTranslation({ x: 0, y: 1, z: 5 }, true);
  }

  private portalMesh?: THREE.Mesh;

  private createDungeon() {
    // Generate Dungeon
    const generator = new DungeonGenerator(50, 50);
    const { grid, rooms } = generator.generate(15, 4, 8);
    this.dungeonRooms.set(rooms);
    this.dungeonGrid.set(grid);
    this.mapSize.set(50 * this.tileSize);
    this.pathfinding = new Pathfinding(grid);

    // Invisible ground plane for raycasting (movement clicks)
    const groundGeometry = new THREE.PlaneGeometry(this.mapSize(), this.mapSize());
    const groundMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.groundPlane);

    // We will use InstancedMesh for floors and walls
    let floorCount = 0;
    let wallCount = 0;
    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        if (grid[y][x] === TileType.FLOOR) floorCount++;
        if (grid[y][x] === TileType.WALL) wallCount++;
      }
    }

    // Floor InstancedMesh
    const floorGeom = new THREE.PlaneGeometry(this.tileSize, this.tileSize);
    floorGeom.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a });
    const floorTex = this.assetService.getTexture('floor');
    if (floorTex) {
      floorTex.wrapS = THREE.RepeatWrapping;
      floorTex.wrapT = THREE.RepeatWrapping;
      floorMat.map = floorTex;
      floorMat.needsUpdate = true;
    }
    const instancedFloors = new THREE.InstancedMesh(floorGeom, floorMat, floorCount);
    instancedFloors.receiveShadow = true;

    // Wall InstancedMesh
    const wallHeight = 4;
    const wallGeom = new THREE.BoxGeometry(this.tileSize, wallHeight, this.tileSize);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const instancedWalls = new THREE.InstancedMesh(wallGeom, wallMat, wallCount);
    instancedWalls.castShadow = true;
    instancedWalls.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let fIdx = 0;
    let wIdx = 0;

    const halfMap = this.mapSize() / 2;

    for (let y = 0; y < 50; y++) {
      for (let x = 0; x < 50; x++) {
        const worldX = (x * this.tileSize) - halfMap + (this.tileSize / 2);
        const worldZ = (y * this.tileSize) - halfMap + (this.tileSize / 2);

        if (grid[y][x] === TileType.FLOOR) {
          dummy.position.set(worldX, 0, worldZ);
          dummy.updateMatrix();
          instancedFloors.setMatrixAt(fIdx++, dummy.matrix);

          // Floor physics
          const groundColliderDesc = RAPIER.ColliderDesc.cuboid(this.tileSize / 2, 0.1, this.tileSize / 2)
            .setTranslation(worldX, -0.1, worldZ);
          this.envColliders.push(this.world.createCollider(groundColliderDesc));
        } else if (grid[y][x] === TileType.WALL) {
          dummy.position.set(worldX, wallHeight / 2, worldZ);
          dummy.updateMatrix();
          instancedWalls.setMatrixAt(wIdx++, dummy.matrix);

          // Wall physics
          const wallColliderDesc = RAPIER.ColliderDesc.cuboid(this.tileSize / 2, wallHeight / 2, this.tileSize / 2)
            .setTranslation(worldX, wallHeight / 2, worldZ);
          this.envColliders.push(this.world.createCollider(wallColliderDesc));
        }
      }
    }

    this.scene.add(instancedFloors);
    this.scene.add(instancedWalls);

    // Initialize Particle System
    const pGeom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.particleSystem = new THREE.InstancedMesh(pGeom, pMat, this.maxParticles);
    this.particleSystem.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particleSystem.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxParticles * 3), 3);
    this.particleSystem.count = 0;
    this.scene.add(this.particleSystem);

    // Move player to first room
    if (this.dungeonRooms().length > 0) {
      const firstRoom = this.dungeonRooms()[0];
      const startX = (firstRoom.centerX * this.tileSize) - halfMap + (this.tileSize / 2);
      const startZ = (firstRoom.centerY * this.tileSize) - halfMap + (this.tileSize / 2);
      this.player.position.set(startX, 1, startZ);
      this.playerBody.setTranslation({ x: startX, y: 1, z: startZ }, true);

      // Town Portal
      const portalGeom = new THREE.TorusGeometry(2, 0.2, 8, 16);
      const portalMat = new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x00aaff });
      this.portalMesh = new THREE.Mesh(portalGeom, portalMat);
      this.portalMesh.position.set(startX, 2, startZ - 3);
      this.scene.add(this.portalMesh);
    }

    // Initial Spawn
    this.spawnEnemies(150);
    this.spawnInteractables();
    
    // Set initial health
    this.playerHealth.set(this.derivedStats().maxHealth);
  }

  private createWall(x: number, y: number, z: number, w: number, h: number, d: number) {
    const wallGeom = new THREE.BoxGeometry(w, h, d);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wall = new THREE.Mesh(wallGeom, wallMat);
    wall.position.set(x, y, z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.scene.add(wall);

    const wallColliderDesc = RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
      .setTranslation(x, y, z);
    this.envColliders.push(this.world.createCollider(wallColliderDesc));
  }

  private spawnEnemies(count: number) {
    for (let i = 0; i < count; i++) {
      this.spawnSingleEnemy();
    }

    // Spawn Boss in the last room
    if (this.dungeonRooms().length > 1) {
      const lastRoom = this.dungeonRooms()[this.dungeonRooms().length - 1];
      const halfMap = this.mapSize() / 2;
      const x = (lastRoom.centerX * this.tileSize) - halfMap + (this.tileSize / 2);
      const z = (lastRoom.centerY * this.tileSize) - halfMap + (this.tileSize / 2);
      this.spawnEnemyAt(x, z, EnemyType.BOSS);
    }
  }

  private spawnEnemyAt(x: number, z: number, type: EnemyType) {
    const enemy = new Enemy(this.scene, this.world, new THREE.Vector3(x, 0, z), type, this.dungeonLevel(), this.pathfinding, this.tileSize, this.mapSize());
    
    enemy.onShoot = (pos, dir, damage) => {
      this.spawnEnemyProjectile(pos, dir, damage);
    };

    enemy.onTakeDamage = (amount, color) => {
      this.spawnDamageNumber(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0)), Math.floor(amount), color);
    };

    enemy.onAttack = (damage) => {
      const stats = this.derivedStats();
      const actualDamage = Math.max(1, damage - stats.defense / 2);
      this.playerHealth.update(h => Math.max(0, h - actualDamage));
      this.spawnDamageNumber(this.player.position.clone().add(new THREE.Vector3(0, 2, 0)), Math.floor(actualDamage), '#ff0000');
      
      if (this.playerHealth() <= 0) {
        this.playerHealth.set(0);
        this.gameState.set('dead');
        this.targetPosition = null;
      }
    };

    enemy.onDeath = (loot) => {
      this.inventory.update(inv => [...inv, loot]);
      
      // Gain EXP based on dungeon level and enemy type
      const baseExp = type === EnemyType.BOSS ? 200 : (type === EnemyType.BRUTE ? 30 : 10);
      const expMult = 1 + (this.dungeonLevel() - 1) * 0.5;
      this.gainExp(Math.floor(baseExp * expMult));
      
      this.enemies = this.enemies.filter(e => e.id !== enemy.id);
      
      if (type === EnemyType.BOSS) {
        this.spawnDamageNumber(this.player.position.clone().add(new THREE.Vector3(0, 3, 0)), 'BOSS DEFEATED!', '#ffaa00');
        // Level up dungeon
        if (this.dungeonLevel() < 10) {
          this.dungeonLevel.update(l => l + 1);
          this.spawnDamageNumber(this.player.position.clone().add(new THREE.Vector3(0, 4, 0)), `DUNGEON LEVEL ${this.dungeonLevel()}`, '#ff00ff');
        }
      }

      // Spawn death particles based on enemy type color
      let color = 0xff4444;
      if (enemy.type === EnemyType.BOSS) color = 0x8800ff;
      else if (enemy.type === EnemyType.BRUTE) color = 0x8b0000;
      else if (enemy.type === EnemyType.ARCHER) color = 0x88ff88;
      
      this.spawnParticles(enemy.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), color, 15);

      // Respawn after a delay (only for non-bosses)
      if (type !== EnemyType.BOSS) {
        setTimeout(() => this.spawnSingleEnemy(), 5000);
      }
    };

    this.enemies.push(enemy);
  }

  private spawnSingleEnemy() {
    if (this.dungeonRooms().length === 0) return;

    // Pick a random room (prefer not the first room where player spawns)
    const roomIndex = Math.floor(Math.random() * (this.dungeonRooms().length - 1)) + 1;
    const room = this.dungeonRooms()[roomIndex] || this.dungeonRooms()[0];

    const halfMap = this.mapSize() / 2;
    const rx = room.x + Math.floor(Math.random() * room.width);
    const ry = room.y + Math.floor(Math.random() * room.height);

    const x = (rx * this.tileSize) - halfMap + (this.tileSize / 2);
    const z = (ry * this.tileSize) - halfMap + (this.tileSize / 2);
    
    // Don't spawn too close to player
    if (this.player && new THREE.Vector3(x, 0, z).distanceTo(this.player.position) < 10) {
      this.spawnSingleEnemy();
      return;
    }
    
    const rand = Math.random();
    let type = EnemyType.GRUNT;
    if (rand > 0.8) type = EnemyType.BRUTE;
    else if (rand > 0.6) type = EnemyType.ARCHER;

    this.spawnEnemyAt(x, z, type);
  }

  private spawnInteractables() {
    this.interactables.forEach(i => {
      if (i.mesh) this.scene.remove(i.mesh);
    });
    this.interactables = [];
    
    if (this.dungeonRooms().length === 0) return;
    
    const halfMap = this.mapSize() / 2;
    
    // Spawn a few interactables in random rooms
    const numInteractables = Math.floor(this.dungeonRooms().length / 2);
    
    for (let i = 0; i < numInteractables; i++) {
      const roomIndex = Math.floor(Math.random() * (this.dungeonRooms().length - 1)) + 1;
      const room = this.dungeonRooms()[roomIndex] || this.dungeonRooms()[0];
      
      const rx = room.x + Math.floor(Math.random() * room.width);
      const ry = room.y + Math.floor(Math.random() * room.height);

      const x = (rx * this.tileSize) - halfMap + (this.tileSize / 2);
      const z = (ry * this.tileSize) - halfMap + (this.tileSize / 2);
      
      const rand = Math.random();
      let type = InteractableType.CHEST;
      if (rand > 0.8) type = InteractableType.SHRINE_HEALTH;
      else if (rand > 0.6) type = InteractableType.SHRINE_EXP;
      
      const interactable: Interactable = {
        id: `interactable_${Date.now()}_${i}`,
        type,
        position: new THREE.Vector3(x, 1, z),
        isUsed: false
      };
      
      // Create mesh
      const geom = new THREE.BoxGeometry(1.5, 1.5, 1.5);
      const mat = new THREE.MeshStandardMaterial();
      
      // Try to load texture, fallback to generated image
      const tex = createFallbackTexture(type);
      mat.map = tex;
      
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(interactable.position);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      
      interactable.mesh = mesh;
      this.scene.add(mesh);
      this.interactables.push(interactable);
    }
    
    this.interactablesSignal.set(this.interactables);
  }

  public saveGame() {
    if (typeof localStorage === 'undefined') return;
    const data = {
      inventory: this.inventory(),
      chest: this.chest(),
      equipped: this.equipped(),
      gold: this.gold(),
      materials: this.materials(),
      baseStats: this.baseStats(),
      currentRegion: this.currentRegion(),
      dungeonLevel: this.dungeonLevel(),
      activeAttack: this.activeAttack(),
      activeSpell: this.activeSpell(),
      linkedSupports: this.linkedSupports()
    };
    localStorage.setItem('project_abyss_save', JSON.stringify(data));
  }

  public loadGame(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const dataStr = localStorage.getItem('project_abyss_save');
    if (!dataStr) return false;
    try {
      const data = JSON.parse(dataStr);
      this.inventory.set(data.inventory || []);
      this.chest.set(data.chest || []);
      this.equipped.set(data.equipped || {});
      this.gold.set(data.gold || 0);
      this.materials.set(data.materials || {
        [CraftingMaterial.DUST]: 0,
        [CraftingMaterial.SHARD]: 0,
        [CraftingMaterial.ESSENCE]: 0,
        [CraftingMaterial.RUNE]: 0
      });
      const stats = data.baseStats;
      if (!stats.allocatedPassives) {
        stats.allocatedPassives = ['start'];
      }
      // Add new stats if missing from older saves
      stats.lifeRegeneration = stats.lifeRegeneration || 0;
      stats.lifeLeechAttack = stats.lifeLeechAttack || 0;
      stats.lifeLeechSpell = stats.lifeLeechSpell || 0;
      stats.fireResistance = stats.fireResistance || 0;
      stats.lightningResistance = stats.lightningResistance || 0;
      stats.iceResistance = stats.iceResistance || 0;
      stats.poisonResistance = stats.poisonResistance || 0;
      stats.maxLifeLeechRate = stats.maxLifeLeechRate || 10;
      
      this.baseStats.set(stats);
      this.currentRegion.set(data.currentRegion || 'town');
      this.dungeonLevel.set(data.dungeonLevel || 1);
      if (data.activeAttack) this.activeAttack.set(data.activeAttack);
      if (data.activeSpell) this.activeSpell.set(data.activeSpell);
      if (data.linkedSupports) this.linkedSupports.set(data.linkedSupports);
      this.createEnvironment();
      this.gameState.set('playing');
      return true;
    } catch (e) {
      return false;
    }
  }

  public newGame() {
    this.inventory.set([]);
    this.chest.set([]);
    this.equipped.set({});
    this.gold.set(0);
    this.materials.set({
      [CraftingMaterial.DUST]: 0,
      [CraftingMaterial.SHARD]: 0,
      [CraftingMaterial.ESSENCE]: 0,
      [CraftingMaterial.RUNE]: 0
    });
    this.baseStats.set({
      level: 1,
      exp: 0,
      expToNext: 100,
      skillPoints: 0,
      strength: 10,
      dexterity: 10,
      intelligence: 10,
      vitality: 10,
      allocatedPassives: ['start'],
      attack: 0,
      defense: 0,
      speed: 8, // Increased base speed
      maxHealth: 100,
      critChance: 5,
      critDamage: 100,
      attackSpeed: 1.0,
      castSpeed: 1.0,
      lifeRegeneration: 0,
      lifeLeechAttack: 0,
      lifeLeechSpell: 0,
      fireResistance: 0,
      lightningResistance: 0,
      iceResistance: 0,
      poisonResistance: 0,
      maxLifeLeechRate: 10
    });
    this.activeAttack.set('strike');
    this.activeSpell.set('fireball');
    this.linkedSupports.set({
      'strike': [], 'cleave': [], 'leap': [], 'whirlwind': [], 'smite': [],
      'fireball': [], 'nova': [], 'arc': [], 'ice_spear': [], 'meteor': []
    });
    this.currentRegion.set('town');
    this.dungeonLevel.set(1);
    this.createEnvironment();
    this.gameState.set('playing');
  }

  public respawn(location: 'town' | 'dungeon') {
    this.playerHealth.set(this.derivedStats().maxHealth);
    this.spawnDamageNumber(this.player.position.clone().add(new THREE.Vector3(0, 2, 0)), 'REVIVED', '#00ff00');
    
    if (location === 'town') {
      this.currentRegion.set('town');
      this.createEnvironment();
    } else {
      // Respawn at dungeon entrance (first room)
      if (this.currentRegion() === 'dungeon' && this.dungeonRooms().length > 0) {
        const firstRoom = this.dungeonRooms()[0];
        const halfMap = this.mapSize() / 2;
        const startX = (firstRoom.centerX * this.tileSize) - halfMap + (this.tileSize / 2);
        const startZ = (firstRoom.centerY * this.tileSize) - halfMap + (this.tileSize / 2);
        this.player.position.set(startX, 1, startZ);
        this.playerBody.setTranslation({ x: startX, y: 1, z: startZ }, true);
        this.targetPosition = null;
      } else {
        // Fallback to town
        this.currentRegion.set('town');
        this.createEnvironment();
      }
    }
    this.gameState.set('playing');
  }

  public salvageItem(item: Item) {
    this.inventory.update(inv => inv.filter(i => i.id !== item.id));
    this.materials.update(m => {
      const newM = { ...m };
      if (item.rarity === Rarity.COMMON) newM[CraftingMaterial.DUST] += Math.floor(Math.random() * 2) + 1;
      if (item.rarity === Rarity.UNCOMMON) {
        newM[CraftingMaterial.DUST] += Math.floor(Math.random() * 3) + 2;
        if (Math.random() < 0.2) newM[CraftingMaterial.SHARD] += 1;
      }
      if (item.rarity === Rarity.RARE) {
        newM[CraftingMaterial.SHARD] += Math.floor(Math.random() * 2) + 1;
        if (Math.random() < 0.1) newM[CraftingMaterial.ESSENCE] += 1;
      }
      if (item.rarity === Rarity.EPIC) {
        newM[CraftingMaterial.ESSENCE] += Math.floor(Math.random() * 2) + 1;
        if (Math.random() < 0.1) newM[CraftingMaterial.RUNE] += 1;
      }
      if (item.rarity === Rarity.LEGENDARY) {
        newM[CraftingMaterial.RUNE] += Math.floor(Math.random() * 2) + 1;
      }
      return newM;
    });
  }

  public bulkSalvage(rarity: Rarity) {
    const itemsToSalvage = this.inventory().filter(i => i.rarity === rarity);
    itemsToSalvage.forEach(item => this.salvageItem(item));
  }

  public craftRerollStats(item: Item): boolean {
    if (this.materials()[CraftingMaterial.DUST] < 5) return false;
    if (item.corrupted) return false;
    
    this.materials.update(m => ({ ...m, [CraftingMaterial.DUST]: m[CraftingMaterial.DUST] - 5 }));
    
    // Generate a new item of the same level and rarity to steal its stats
    const newItem = LootManager.generateItem(item.level, item.rarity);
    // Keep the same slot, rarity, name, but swap stats
    item.stats = newItem.stats;
    this.inventory.update(inv => [...inv]); // trigger update
    return true;
  }

  public craftUpgradeRarity(item: Item): boolean {
    if (this.materials()[CraftingMaterial.SHARD] < 3) return false;
    if (item.corrupted) return false;
    
    const rarityOrder = [Rarity.COMMON, Rarity.UNCOMMON, Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY];
    const idx = rarityOrder.indexOf(item.rarity);
    if (idx >= rarityOrder.length - 1) return false; // Already max
    
    this.materials.update(m => ({ ...m, [CraftingMaterial.SHARD]: m[CraftingMaterial.SHARD] - 3 }));
    
    item.rarity = rarityOrder[idx + 1];
    const newItem = LootManager.generateItem(item.level, item.rarity);
    item.stats = newItem.stats;
    this.inventory.update(inv => [...inv]);
    return true;
  }

  public craftAddStat(item: Item): boolean {
    if (this.materials()[CraftingMaterial.SHARD] < 5) return false;
    if (item.corrupted) return false;
    
    const possibleStats: (keyof ItemStats)[] = ['attack', 'defense', 'speed', 'intelligence', 'strength', 'dexterity', 'vitality', 'critChance', 'critDamage', 'attackSpeed', 'castSpeed'];
    const missingStats = possibleStats.filter(s => item.stats[s] === undefined);
    
    if (missingStats.length === 0) return false;
    
    this.materials.update(m => ({ ...m, [CraftingMaterial.SHARD]: m[CraftingMaterial.SHARD] - 5 }));
    
    const statToAdd = missingStats[Math.floor(Math.random() * missingStats.length)];
    const bonus = item.level * 2 + Math.floor(Math.random() * 5);
    item.stats[statToAdd] = bonus;
    
    this.inventory.update(inv => [...inv]);
    return true;
  }

  public craftCorruptItem(item: Item): boolean {
    if (this.materials()[CraftingMaterial.RUNE] < 1) return false;
    if (item.corrupted) return false;
    
    this.materials.update(m => ({ ...m, [CraftingMaterial.RUNE]: m[CraftingMaterial.RUNE] - 1 }));
    item.corrupted = true;
    
    // 50% chance to brick (reduce stats), 50% chance to massively buff
    if (Math.random() > 0.5) {
      // Buff
      const keys = Object.keys(item.stats) as (keyof ItemStats)[];
      if (keys.length > 0) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        item.stats[key] = (item.stats[key] || 0) * 2;
      }
    } else {
      // Brick
      const keys = Object.keys(item.stats) as (keyof ItemStats)[];
      if (keys.length > 0) {
        const key = keys[Math.floor(Math.random() * keys.length)];
        item.stats[key] = Math.floor((item.stats[key] || 0) * 0.5);
      }
    }
    
    this.inventory.update(inv => [...inv]);
    return true;
  }

  public craftAddSocket(item: Item): boolean {
    if (this.materials()[CraftingMaterial.ESSENCE] < 1) return false;
    if (item.corrupted) return false;
    if ((item.sockets || 0) >= 3) return false; // Max 3 sockets
    
    this.materials.update(m => ({ ...m, [CraftingMaterial.ESSENCE]: m[CraftingMaterial.ESSENCE] - 1 }));
    item.sockets = (item.sockets || 0) + 1;
    this.inventory.update(inv => [...inv]);
    return true;
  }

  public craftImprintStat(item: Item): boolean {
    if (this.materials()[CraftingMaterial.RUNE] < 1) return false;
    if (item.corrupted || item.imprinted) return false;
    
    const possibleStats: (keyof ItemStats)[] = ['attack', 'defense', 'speed', 'intelligence', 'strength', 'dexterity', 'vitality', 'critChance', 'critDamage', 'attackSpeed', 'castSpeed'];
    const missingStats = possibleStats.filter(s => item.stats[s] === undefined);
    
    if (missingStats.length === 0) return false;
    
    this.materials.update(m => ({ ...m, [CraftingMaterial.RUNE]: m[CraftingMaterial.RUNE] - 1 }));
    
    const statToAdd = missingStats[Math.floor(Math.random() * missingStats.length)];
    // Imprinted stats are max rolled
    const bonus = item.level * 5 + 10; 
    item.stats[statToAdd] = bonus;
    item.imprinted = true;
    
    this.inventory.update(inv => [...inv]);
    return true;
  }

  public gainExp(amount: number) {
    this.baseStats.update(stats => {
      if (stats.level >= 20) return stats;

      let newExp = stats.exp + amount;
      let newLevel = stats.level;
      let newExpToNext = stats.expToNext;
      let newStr = stats.strength;
      let newDex = stats.dexterity;
      let newInt = stats.intelligence;
      let newVit = stats.vitality;
      let newSkillPoints = stats.skillPoints;

      while (newExp >= newExpToNext && newLevel < 20) {
        newExp -= newExpToNext;
        newLevel++;
        newExpToNext = Math.floor(newExpToNext * 1.5);
        newStr += 2;
        newDex += 2;
        newInt += 2;
        newVit += 2;
        newSkillPoints += 1;
        
        this.spawnDamageNumber(this.player.position.clone().add(new THREE.Vector3(0, 2.5, 0)), 'LEVEL UP!', '#ffff00');
        
        // Heal on level up
        setTimeout(() => {
          this.playerHealth.set(this.derivedStats().maxHealth);
        }, 0);
      }

      if (newLevel >= 20) {
        newExp = 0;
        newExpToNext = 0;
      }

      return {
        ...stats,
        level: newLevel,
        exp: newExp,
        expToNext: newExpToNext,
        skillPoints: newSkillPoints,
        strength: newStr,
        dexterity: newDex,
        intelligence: newInt,
        vitality: newVit
      };
    });
  }

  private spawnEnemyProjectile(startPos: THREE.Vector3, direction: THREE.Vector3, damage: number) {
    const geom = new THREE.SphereGeometry(0.2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x88ff88 });
    const proj = new THREE.Mesh(geom, mat);
    proj.position.copy(startPos).add(new THREE.Vector3(0, 1, 0));
    this.scene.add(proj);

    const speed = 12;
    const startTime = Date.now();
    const duration = 2000;

    const updateProj = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > duration) {
        this.scene.remove(proj);
        return;
      }

      proj.position.add(direction.clone().multiplyScalar(speed * 0.016));
      
      // Hit detection with player
      if (proj.position.distanceTo(this.player.position) < 1.0) {
        const stats = this.derivedStats();
        const avgRes = (stats.fireResistance + stats.lightningResistance + stats.iceResistance + stats.poisonResistance) / 4;
        const resReduction = Math.min(0.75, avgRes / 100); // Cap at 75% reduction
        const actualDamage = Math.max(1, damage * (1 - resReduction));
        
        this.playerHealth.update(h => Math.max(0, h - actualDamage));
        this.spawnDamageNumber(this.player.position.clone().add(new THREE.Vector3(0, 2, 0)), Math.floor(actualDamage), '#ff00ff'); // Purple for magic damage
        
        if (this.playerHealth() <= 0) {
          this.playerHealth.set(0);
          this.gameState.set('dead');
          this.targetPosition = null;
        }
        this.scene.remove(proj);
        return;
      }
      requestAnimationFrame(updateProj);
    };
    updateProj();
  }

  private createPlayer() {
    // Visuals
    this.player = new THREE.Group();
    
    const playerModel = this.assetService.cloneModel('player');
    if (playerModel) {
      playerModel.scale.set(0.8, 0.8, 0.8);
      
      // Fix materials and shadows
      playerModel.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      this.player.add(playerModel);
      
      const gltf = this.assetService.getModel('player');
      if (gltf && gltf.animations && gltf.animations.length > 0) {
        // Strip root motion (position tracks) from animations
        gltf.animations.forEach(clip => {
          clip.tracks = clip.tracks.filter(track => !track.name.match(/\.position$/));
        });

        this.playerMixer = new THREE.AnimationMixer(playerModel);
        // Soldier.glb animations: 0: Idle, 1: Run, 2: TPose, 3: Walk
        this.playerActionIdle = this.playerMixer.clipAction(gltf.animations[0]); 
        this.playerActionRun = this.playerMixer.clipAction(gltf.animations[1] || gltf.animations[0]); 
        this.activeAction = this.playerActionIdle;
        this.activeAction.play();
      }
    } else {
      // Fallback
      const bodyGeom = new THREE.CapsuleGeometry(0.4, 1, 4, 8);
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x00ff88 });
      const bodyMesh = new THREE.Mesh(bodyGeom, bodyMat);
      bodyMesh.position.y = 0.9;
      bodyMesh.castShadow = true;
      this.player.add(bodyMesh);
    }

    this.scene.add(this.player);

    // Physics
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 1, 0)
      .setCanSleep(false)
      .enabledRotations(false, false, false);
    this.playerBody = this.world.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.capsule(0.5, 0.4);
    this.world.createCollider(colliderDesc, this.playerBody);
  }

  private onMouseDown(event: MouseEvent) {
    if (this.gameState() !== 'playing') return;
    if (event.target !== this.renderer.domElement) return;

    const mouse = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObject(this.groundPlane);
    if (intersects.length > 0) {
      this.targetPosition = intersects[0].point;
    }
  }

  private onMouseMove(event: MouseEvent) {
    if (this.gameState() !== 'playing') return;
    if (event.target !== this.renderer.domElement) return;

    const mouse = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObject(this.groundPlane);
    if (intersects.length > 0) {
      this.cursorPosition = intersects[0].point;
    }
  }

  private onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private lastRegenTime = 0;

  private animate() {
    this.ngZone.runOutsideAngular(() => {
      let lastTime = performance.now();

      const loop = () => {
        const now = performance.now();
        const delta = (now - lastTime) / 1000;
        lastTime = now;

        this.stats.begin();
        
        // Physics Step
        if (this.gameState() === 'playing') {
          this.world.step();

          // Update Player Movement
          this.updatePlayer();
          this.checkInteractions();

          // Update Enemies
          for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (enemy.isDead) {
              this.enemies.splice(i, 1);
              continue;
            }
            enemy.update(this.player.position, delta);
          }
          
          // Life Regeneration
          if (now - this.lastRegenTime > 1000) {
            this.lastRegenTime = now;
            const regen = this.derivedStats().lifeRegeneration;
            if (regen > 0 && this.playerHealth() > 0 && this.playerHealth() < this.derivedStats().maxHealth) {
              this.playerHealth.update(h => Math.min(this.derivedStats().maxHealth, h + regen));
            }
          }

          // Process Life Leech
          let totalLeechThisFrame = 0;
          for (let i = this.activeLeeches.length - 1; i >= 0; i--) {
            const leech = this.activeLeeches[i];
            totalLeechThisFrame += leech.amountPerSec * delta;
            leech.remainingTime -= delta;
            if (leech.remainingTime <= 0) {
              this.activeLeeches.splice(i, 1);
            }
          }

          if (totalLeechThisFrame > 0 && this.playerHealth() > 0 && this.playerHealth() < this.derivedStats().maxHealth) {
            const maxLeechPerSec = this.derivedStats().maxHealth * (this.derivedStats().maxLifeLeechRate / 100);
            const maxLeechThisFrame = maxLeechPerSec * delta;
            const actualLeech = Math.min(totalLeechThisFrame, maxLeechThisFrame);
            this.playerHealth.update(h => Math.min(this.derivedStats().maxHealth, h + actualLeech));
          }
        }

        // Sync Visuals
        const t = this.playerBody.translation();
        this.player.position.set(t.x, t.y - 0.5, t.z);
        
        // Update Minimap Signals
        this.playerPos.set({ x: t.x, z: t.z });
        this.enemyPositions.set(this.enemies.map(e => ({
          x: e.body.translation().x,
          z: e.body.translation().z
        })));

        if (this.playerMixer) this.playerMixer.update(delta);

        // Update Instanced Particles
        const dummy = new THREE.Object3D();
        let aliveCount = 0;
        
        for (let i = 0; i < this.particleCount; i++) {
          const p = this.particleData[i];
          p.life -= delta;
          
          if (p.life > 0) {
            this.particleSystem.getMatrixAt(i, dummy.matrix);
            dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
            
            p.velocity.y -= 20 * delta; // gravity
            dummy.position.add(p.velocity.clone().multiplyScalar(delta));
            dummy.rotation.x += delta * 10;
            dummy.rotation.y += delta * 10;
            
            const s = p.life / p.maxLife;
            dummy.scale.setScalar(s);
            dummy.updateMatrix();
            
            this.particleSystem.setMatrixAt(aliveCount, dummy.matrix);
            
            const color = new THREE.Color();
            this.particleSystem.getColorAt(i, color);
            this.particleSystem.setColorAt(aliveCount, color);
            
            this.particleData[aliveCount] = p;
            aliveCount++;
          }
        }
        
        this.particleCount = aliveCount;
        this.particleSystem.count = this.particleCount;
        this.particleSystem.instanceMatrix.needsUpdate = true;
        if (this.particleSystem.instanceColor) this.particleSystem.instanceColor.needsUpdate = true;

        // Update 2D Screen Projections (Damage Numbers & Health Bars)
        this.updateUIProjections(delta);

        // Update cooldown progress
        const currentTime = Date.now();
        const attackStats = this.getSkillStats(this.activeAttack());
        const attackCd = attackStats.cooldown * 1000;
        const attackElapsed = currentTime - this.lastAttackTime;
        this.attackCooldownProgress.set(Math.max(0, 1 - (attackElapsed / attackCd)));

        const spellStats = this.getSkillStats(this.activeSpell());
        const spellCd = spellStats.cooldown * 1000;
        const spellElapsed = currentTime - this.lastCastTime;
        this.spellCooldownProgress.set(Math.max(0, 1 - (spellElapsed / spellCd)));

        // Camera Follow
        const targetCamPos = new THREE.Vector3(t.x + 15, t.y + 15, t.z + 15);
        this.camera.position.lerp(targetCamPos, 0.1);
        this.camera.lookAt(t.x, t.y, t.z);

        this.renderer.render(this.scene, this.camera);
        
        this.stats.end();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
  }

  private updateUIProjections(delta: number) {
    const widthHalf = window.innerWidth / 2;
    const heightHalf = window.innerHeight / 2;

    // Update Damage Numbers
    const currentDNs = [];
    for (let i = this.activeDamageNumbers.length - 1; i >= 0; i--) {
      const dn = this.activeDamageNumbers[i];
      dn.life -= delta;
      if (dn.life <= 0) {
        this.activeDamageNumbers.splice(i, 1);
        continue;
      }
      dn.pos.y += delta * 2; // float up
      
      const vector = dn.pos.clone();
      vector.project(this.camera);
      
      if (vector.z < 1) { // Only show if in front of camera
        currentDNs.push({
          id: dn.id,
          text: dn.text,
          x: (vector.x * widthHalf) + widthHalf,
          y: -(vector.y * heightHalf) + heightHalf,
          color: dn.color,
          opacity: dn.life / dn.maxLife
        });
      }
    }
    this.damageNumbers.set(currentDNs);

    // Update Enemy UI
    const currentEnemies = [];
    for (const enemy of this.enemies) {
      if (enemy.health >= enemy.maxHealth && enemy.activeEffects.length === 0) continue; // Only show if damaged or has effects

      const vector = enemy.mesh.position.clone();
      vector.y += 1.5; // above head
      vector.project(this.camera);
      
      if (vector.z < 1) {
        currentEnemies.push({
          id: enemy.id,
          x: (vector.x * widthHalf) + widthHalf,
          y: -(vector.y * heightHalf) + heightHalf,
          hpPercent: (enemy.health / enemy.maxHealth) * 100,
          effects: enemy.activeEffects.map(e => ({ type: e.type, duration: e.duration }))
        });
      }
    }
    this.enemyUI.set(currentEnemies);
  }

  private checkInteractions() {
    const playerPos = this.player.position;
    
    // Check Portal
    if (this.portalMesh) {
      const distToPortal = playerPos.distanceTo(this.portalMesh.position);
      if (distToPortal < 2) {
        // Switch region
        this.currentRegion.set(this.currentRegion() === 'town' ? 'dungeon' : 'town');
        this.createEnvironment();
        return; // Stop further checks this frame
      }
    }

    // Check Vendor, Gambler, Chest & Crafting Bench
    if (this.currentRegion() === 'town') {
      const distToVendor = playerPos.distanceTo(this.vendorPosition);
      this.isNearVendor.set(distToVendor < 3);

      const distToGambler = playerPos.distanceTo(this.gamblerPosition);
      this.isNearGambler.set(distToGambler < 3);

      const distToChest = playerPos.distanceTo(this.chestPosition);
      this.isNearChest.set(distToChest < 3);

      const distToBench = playerPos.distanceTo(this.craftingBenchPosition);
      this.isNearCraftingBench.set(distToBench < 3);
    } else {
      this.isNearVendor.set(false);
      this.isNearGambler.set(false);
      this.isNearChest.set(false);
      this.isNearCraftingBench.set(false);
      
      // Check Dungeon Interactables
      for (const interactable of this.interactables) {
        if (interactable.isUsed) continue;
        
        const dist = playerPos.distanceTo(interactable.position);
        if (dist < 2) {
          this.interactWith(interactable);
        }
      }
    }
  }

  private interactWith(interactable: Interactable) {
    interactable.isUsed = true;
    if (interactable.mesh) {
      this.scene.remove(interactable.mesh);
    }
    
    switch (interactable.type) {
      case InteractableType.CHEST:
        this.spawnDamageNumber(interactable.position.clone().add(new THREE.Vector3(0, 2, 0)), 'LOOT!', '#ffff00');
        // Drop 1-3 items
        const numItems = Math.floor(Math.random() * 3) + 1;
        for (let i = 0; i < numItems; i++) {
          const item = LootManager.generateItem(this.dungeonLevel(), undefined, this.dungeonLevel());
          this.inventory.update(inv => {
            if (inv.length < 20) return [...inv, item];
            return inv;
          });
        }
        this.gold.update(g => g + Math.floor(Math.random() * 50 * this.dungeonLevel()));
        break;
      case InteractableType.SHRINE_HEALTH:
        this.spawnDamageNumber(interactable.position.clone().add(new THREE.Vector3(0, 2, 0)), 'HEALED', '#00ff00');
        this.playerHealth.set(this.derivedStats().maxHealth);
        break;
      case InteractableType.SHRINE_EXP:
        const expAmount = 100 * this.dungeonLevel();
        this.spawnDamageNumber(interactable.position.clone().add(new THREE.Vector3(0, 2, 0)), `+${expAmount} EXP`, '#aa00ff');
        this.gainExp(expAmount);
        break;
    }
    
    this.interactablesSignal.set([...this.interactables]);
  }

  private updatePlayer() {
    // Out of bounds safety net
    if (this.player && this.player.position.y < -10) {
      this.playerHealth.set(0);
      this.gameState.set('dead');
      this.targetPosition = null;
      return;
    }

    if (!this.targetPosition) return;

    const stats = this.derivedStats();
    const currentPos = new THREE.Vector3().copy(this.player.position);
    const direction = new THREE.Vector3().subVectors(this.targetPosition, currentPos);
    direction.y = 0;

    const distance = direction.length();
    if (distance > 0.2) {
      direction.normalize();
      
      // Rotate player to face direction (+ Math.PI to fix walking backwards)
      const angle = Math.atan2(direction.x, direction.z);
      this.player.rotation.y = angle + Math.PI;

      // Move via velocity
      const velocity = direction.multiplyScalar(stats.speed);
      this.playerBody.setLinvel({ x: velocity.x, y: this.playerBody.linvel().y, z: velocity.z }, true);
      
      if (this.activeAction !== this.playerActionRun) {
        this.activeAction?.fadeOut(0.2);
        this.activeAction = this.playerActionRun;
        this.activeAction?.reset().fadeIn(0.2).play();
      }
    } else {
      this.playerBody.setLinvel({ x: 0, y: this.playerBody.linvel().y, z: 0 }, true);
      this.targetPosition = null;
      
      if (this.activeAction !== this.playerActionIdle) {
        this.activeAction?.fadeOut(0.2);
        this.activeAction = this.playerActionIdle;
        this.activeAction?.reset().fadeIn(0.2).play();
      }
    }
  }
}
