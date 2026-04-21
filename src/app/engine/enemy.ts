import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { LootManager, Item } from './items';

import { Pathfinding } from './pathfinding';

export enum EnemyType {
  GRUNT = 'GRUNT',
  BRUTE = 'BRUTE',
  ARCHER = 'ARCHER',
  BOSS = 'BOSS'
}

export enum StatusEffectType {
  BURN = 'BURN',
  FREEZE = 'FREEZE',
  SHOCK = 'SHOCK',
  POISON = 'POISON'
}

export interface StatusEffect {
  type: StatusEffectType;
  duration: number;
  magnitude: number;
  tickTimer: number;
}

export class Enemy {
  public id = Math.random().toString(36).substr(2, 9);
  public type: EnemyType;
  public mesh: THREE.Group;
  public lod!: THREE.LOD;
  public coreMesh!: THREE.Mesh;
  public shellMesh!: THREE.Mesh;
  public body: RAPIER.RigidBody;
  public maxHealth = 100;
  public health = 100;
  private moveSpeed = 2;
  private attackCooldown = 0;
  public attackDamage = 15;
  public attackRange = 1.5;
  private bossTimer = 0;
  private aoeIndicator?: THREE.Mesh;
  private directionalIndicator?: THREE.Mesh;
  private attackWindupTimer = 0;
  private isWindingUpAttack = false;
  private attackTargetDir = new THREE.Vector3();
  
  public activeEffects: StatusEffect[] = [];
  public fireResistance = 0;
  public iceResistance = 0;
  public lightningResistance = 0;
  public poisonResistance = 0;
  
  public onDeath?: (loot: Item) => void;
  public onAttack?: (damage: number) => void;
  public onShoot?: (pos: THREE.Vector3, dir: THREE.Vector3, damage: number) => void;
  public onTakeDamage?: (amount: number, color: string) => void;

  private currentPath: {x: number, y: number}[] = [];
  private pathUpdateTimer = 0;

  constructor(
    private scene: THREE.Scene,
    private world: RAPIER.World,
    position: THREE.Vector3,
    type: EnemyType = EnemyType.GRUNT,
    public dungeonLevel: number = 1,
    private pathfinding: Pathfinding | null = null,
    private tileSize: number = 4,
    private mapSize: number = 200
  ) {
    this.type = type;
    
    let color = 0xff4444;
    let scale = 1;
    
    // Scale multiplier: +20% per dungeon level
    const scaleMult = 1 + (dungeonLevel - 1) * 0.2;
    
    switch(type) {
      case EnemyType.GRUNT:
        this.maxHealth = this.health = Math.floor(100 * scaleMult);
        this.moveSpeed = 2;
        this.attackDamage = Math.floor(15 * scaleMult);
        this.attackRange = 1.5;
        this.fireResistance = 10;
        this.iceResistance = 10;
        this.lightningResistance = 10;
        this.poisonResistance = 10;
        color = 0xff4444;
        scale = 1;
        break;
      case EnemyType.BRUTE:
        this.maxHealth = this.health = Math.floor(300 * scaleMult);
        this.moveSpeed = 1;
        this.attackDamage = Math.floor(30 * scaleMult);
        this.attackRange = 2.0;
        this.fireResistance = 30;
        this.iceResistance = 30;
        this.lightningResistance = 30;
        this.poisonResistance = 30;
        color = 0x8b0000;
        scale = 1.5;
        break;
      case EnemyType.ARCHER:
        this.maxHealth = this.health = Math.floor(60 * scaleMult);
        this.moveSpeed = 2.5;
        this.attackDamage = Math.floor(10 * scaleMult);
        this.attackRange = 10.0;
        this.fireResistance = 0;
        this.iceResistance = 0;
        this.lightningResistance = 0;
        this.poisonResistance = 0;
        color = 0x88ff88;
        scale = 0.8;
        break;
      case EnemyType.BOSS:
        this.maxHealth = this.health = Math.floor(1000 * scaleMult);
        this.moveSpeed = 1.2;
        this.attackDamage = Math.floor(50 * scaleMult);
        this.attackRange = 3.0;
        this.fireResistance = 50;
        this.iceResistance = 50;
        this.lightningResistance = 50;
        this.poisonResistance = 50;
        color = 0x8800ff;
        scale = 2.5;
        break;
    }

    // Visuals
    this.mesh = new THREE.Group();
    this.lod = new THREE.LOD();
    
    // --- LOD 0: High Detail ---
    const highDetailGroup = new THREE.Group();
    const coreGeom = new THREE.OctahedronGeometry(0.4 * scale, 1);
    const coreMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
    this.coreMesh = new THREE.Mesh(coreGeom, coreMat);
    this.coreMesh.position.y = 0.6 * scale;
    this.coreMesh.castShadow = true;
    highDetailGroup.add(this.coreMesh);

    const shellGeom = new THREE.OctahedronGeometry(0.6 * scale, 2);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0x222222, wireframe: true, transparent: true, opacity: 0.5 });
    this.shellMesh = new THREE.Mesh(shellGeom, shellMat);
    this.shellMesh.position.y = 0.6 * scale;
    highDetailGroup.add(this.shellMesh);
    
    this.lod.addLevel(highDetailGroup, 0);

    // --- LOD 1: Medium Detail ---
    const medDetailGroup = new THREE.Group();
    const medGeom = new THREE.OctahedronGeometry(0.6 * scale, 0); // simpler geometry
    const medMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 });
    const medMesh = new THREE.Mesh(medGeom, medMat);
    medMesh.position.y = 0.6 * scale;
    medMesh.castShadow = true;
    medDetailGroup.add(medMesh);
    
    this.lod.addLevel(medDetailGroup, 40);

    // --- LOD 2: Billboard (Very Low Detail) ---
    const lowDetailGroup = new THREE.Group();
    // Sprite always faces the camera and drops complex geometry/lighting rendering
    const spriteMat = new THREE.SpriteMaterial({ color: color });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 0.6 * scale;
    sprite.scale.set(scale, scale * 1.5, 1);
    lowDetailGroup.add(sprite);

    this.lod.addLevel(lowDetailGroup, 80);

    this.mesh.add(this.lod);
    this.mesh.position.copy(position);
    this.scene.add(this.mesh);

    // Physics
    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y + (1 * scale), position.z)
      .setCanSleep(false)
      .enabledRotations(false, false, false);
    this.body = this.world.createRigidBody(rigidBodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.4 * scale, 0.6 * scale, 0.4 * scale);
    this.world.createCollider(colliderDesc, this.body);

    if (this.type === EnemyType.BOSS) {
      const aoeGeom = new THREE.CircleGeometry(15, 32);
      const aoeMat = new THREE.MeshBasicMaterial({ 
        color: 0xff0000, 
        transparent: true, 
        opacity: 0.0, 
        side: THREE.DoubleSide,
        depthWrite: false
      });
      this.aoeIndicator = new THREE.Mesh(aoeGeom, aoeMat);
      this.aoeIndicator.rotation.x = -Math.PI / 2;
      this.aoeIndicator.position.y = 0.05;
      this.scene.add(this.aoeIndicator);
    }

    // Directional indicator for normal attacks
    const dirWidth = this.type === EnemyType.BOSS ? 3 : (this.type === EnemyType.BRUTE ? 2 : 1);
    const dirGeom = new THREE.PlaneGeometry(dirWidth, this.attackRange);
    dirGeom.translate(0, this.attackRange / 2, 0);
    const dirMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.directionalIndicator = new THREE.Mesh(dirGeom, dirMat);
    this.directionalIndicator.rotation.x = -Math.PI / 2;
    this.directionalIndicator.position.y = 0.06;
    this.scene.add(this.directionalIndicator);
  }

  applyStatusEffect(type: StatusEffectType, duration: number, magnitude: number) {
    let res = 0;
    if (type === StatusEffectType.BURN) res = this.fireResistance;
    if (type === StatusEffectType.FREEZE) res = this.iceResistance;
    if (type === StatusEffectType.SHOCK) res = this.lightningResistance;
    if (type === StatusEffectType.POISON) res = this.poisonResistance;

    const resMult = Math.max(0, 1 - (res / 100));
    const actualDuration = duration * resMult;
    const actualMagnitude = magnitude * resMult;

    if (actualDuration <= 0) return;

    const existing = this.activeEffects.find(e => e.type === type);
    if (existing) {
      existing.duration = Math.max(existing.duration, actualDuration);
      if (type === StatusEffectType.POISON) {
        existing.magnitude += actualMagnitude; // Poison stacks
      } else {
        existing.magnitude = Math.max(existing.magnitude, actualMagnitude);
      }
    } else {
      this.activeEffects.push({
        type,
        duration: actualDuration,
        magnitude: actualMagnitude,
        tickTimer: 0
      });
    }
  }

  update(playerPos: THREE.Vector3, deltaTime: number, camera?: THREE.Camera) {
    // Process status effects
    let speedMult = 1.0;
    let damageTakenMult = 1.0;

    for (let i = this.activeEffects.length - 1; i >= 0; i--) {
      const effect = this.activeEffects[i];
      effect.duration -= deltaTime;
      
      if (effect.type === StatusEffectType.FREEZE) {
        speedMult *= Math.max(0.1, 1 - (effect.magnitude / 100));
      } else if (effect.type === StatusEffectType.SHOCK) {
        damageTakenMult *= (1 + (effect.magnitude / 100));
      } else if (effect.type === StatusEffectType.BURN || effect.type === StatusEffectType.POISON) {
        effect.tickTimer += deltaTime;
        if (effect.tickTimer >= 1.0) {
          effect.tickTimer -= 1.0;
          const dmg = effect.magnitude * damageTakenMult;
          this.takeDamage(dmg);
          if (this.onTakeDamage) {
            this.onTakeDamage(dmg, effect.type === StatusEffectType.BURN ? '#ff8800' : '#00ff00');
          }
        }
      }

      if (effect.duration <= 0) {
        this.activeEffects.splice(i, 1);
      }
    }

    const currentPos = new THREE.Vector3(
      this.body.translation().x,
      this.body.translation().y,
      this.body.translation().z
    );

    const direction = new THREE.Vector3().subVectors(playerPos, currentPos);
    direction.y = 0;

    const distance = direction.length();
    let isWindingUp = false;

    if (this.type === EnemyType.BOSS) {
      this.bossTimer += deltaTime;
      const windupStart = 2.5;
      const attackTime = 4.0;
      
      if (this.bossTimer > windupStart && this.bossTimer <= attackTime) {
        isWindingUp = true;
        const progress = (this.bossTimer - windupStart) / (attackTime - windupStart);
        
        if (this.aoeIndicator) {
          this.aoeIndicator.position.set(currentPos.x, 0.05, currentPos.z);
          this.aoeIndicator.scale.setScalar(progress);
          (this.aoeIndicator.material as THREE.MeshBasicMaterial).opacity = progress * 0.4;
        }
        
        if (this.coreMesh && this.coreMesh.material) {
           (this.coreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + progress * 5;
        }
      } else {
        if (this.aoeIndicator) {
          (this.aoeIndicator.material as THREE.MeshBasicMaterial).opacity = 0;
        }
        if (this.coreMesh && this.coreMesh.material) {
           (this.coreMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5;
        }
      }

      if (this.bossTimer > attackTime) {
        this.bossTimer = 0;
        // Boss AoE Projectile Nova
        if (this.onShoot) {
          for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
            this.onShoot(currentPos, dir, this.attackDamage * 0.8);
          }
        }
        if (this.aoeIndicator) {
          (this.aoeIndicator.material as THREE.MeshBasicMaterial).opacity = 0;
        }
      }
    }

    if (!isWindingUp) {
      if (this.isWindingUpAttack) {
        this.body.setLinvel({ x: 0, y: this.body.linvel().y, z: 0 }, true);
        this.attackWindupTimer += deltaTime;
        const windupDuration = 0.6;
        
        if (this.directionalIndicator) {
          const progress = this.attackWindupTimer / windupDuration;
          this.directionalIndicator.position.set(currentPos.x, 0.06, currentPos.z);
          const angle = Math.atan2(this.attackTargetDir.x, this.attackTargetDir.z);
          this.directionalIndicator.rotation.set(-Math.PI / 2, 0, angle + Math.PI);
          (this.directionalIndicator.material as THREE.MeshBasicMaterial).opacity = progress * 0.6;
        }

        if (this.attackWindupTimer >= windupDuration) {
          // Fire attack
          if (this.type === EnemyType.ARCHER) {
            if (this.onShoot) this.onShoot(currentPos, this.attackTargetDir, this.attackDamage);
          } else {
            if (this.onAttack) this.onAttack(this.attackDamage);
          }
          this.attackCooldown = 1.5;
          this.isWindingUpAttack = false;
          if (this.directionalIndicator) {
            (this.directionalIndicator.material as THREE.MeshBasicMaterial).opacity = 0;
          }
        }
      } else {
        if (distance < 15 && distance > this.attackRange) {
          let moveDir = direction.clone().normalize();

          if (this.pathfinding) {
            this.pathUpdateTimer -= deltaTime;
            if (this.pathUpdateTimer <= 0) {
              this.pathUpdateTimer = 0.5; // Update path every 0.5 seconds
              
              const halfMap = this.mapSize / 2;
              const startX = Math.floor((currentPos.x + halfMap) / this.tileSize);
              const startY = Math.floor((currentPos.z + halfMap) / this.tileSize);
              const targetX = Math.floor((playerPos.x + halfMap) / this.tileSize);
              const targetY = Math.floor((playerPos.z + halfMap) / this.tileSize);

              this.currentPath = this.pathfinding.findPath(startX, startY, targetX, targetY);
            }

            if (this.currentPath.length > 1) {
              // The first node is usually the current position, so target the second node
              const nextNode = this.currentPath[1];
              const halfMap = this.mapSize / 2;
              const targetWorldX = (nextNode.x * this.tileSize) - halfMap + (this.tileSize / 2);
              const targetWorldZ = (nextNode.y * this.tileSize) - halfMap + (this.tileSize / 2);
              
              const targetWorldPos = new THREE.Vector3(targetWorldX, currentPos.y, targetWorldZ);
              moveDir = new THREE.Vector3().subVectors(targetWorldPos, currentPos);
              moveDir.y = 0;
              
              // If we are very close to the next node, we might get a zero vector
              if (moveDir.lengthSq() > 0.01) {
                moveDir.normalize();
              } else {
                moveDir = direction.clone().normalize();
              }
            }
          }

          const velocity = moveDir.multiplyScalar(this.moveSpeed * speedMult);
          this.body.setLinvel({ x: velocity.x, y: this.body.linvel().y, z: velocity.z }, true);
          
          // Rotate to face movement direction
          const angle = Math.atan2(moveDir.x, moveDir.z);
          this.mesh.rotation.y = angle;
        } else if (distance <= this.attackRange) {
          this.body.setLinvel({ x: 0, y: this.body.linvel().y, z: 0 }, true);
          
          // Rotate to face player even when attacking
          direction.normalize();
          const angle = Math.atan2(direction.x, direction.z);
          this.mesh.rotation.y = angle;

          if (this.attackCooldown <= 0) {
            this.isWindingUpAttack = true;
            this.attackWindupTimer = 0;
            this.attackTargetDir.copy(direction);
          }
        } else {
          this.body.setLinvel({ x: 0, y: this.body.linvel().y, z: 0 }, true);
        }
      }
    } else {
      // Stop moving during windup
      this.body.setLinvel({ x: 0, y: this.body.linvel().y, z: 0 }, true);
      if (this.directionalIndicator) {
        (this.directionalIndicator.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      this.isWindingUpAttack = false;
    }

    if (this.attackCooldown > 0) {
      this.attackCooldown -= deltaTime;
    }

    // Animate mesh parts
    if (this.coreMesh) this.coreMesh.rotation.y += deltaTime * (isWindingUp ? 10 : 2);
    if (this.shellMesh) {
      this.shellMesh.rotation.y -= deltaTime * (isWindingUp ? 5 : 1);
      this.shellMesh.rotation.x += deltaTime * (isWindingUp ? 2.5 : 0.5);
    }

    if (camera) {
      this.lod.update(camera);
    }

    // Sync mesh
    const t = this.body.translation();
    // Calculate offset based on scale to keep it on ground
    const scale = this.type === EnemyType.BOSS ? 2.5 : (this.type === EnemyType.BRUTE ? 1.5 : (this.type === EnemyType.ARCHER ? 0.8 : 1));
    this.mesh.position.set(t.x, t.y - (0.6 * scale), t.z);
  }

  public isDead = false;

  takeDamage(amount: number) {
    if (this.isDead) return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.isDead = true;
      this.destroy();
      return true;
    }
    return false;
  }

  destroy() {
    if (this.onDeath) {
      // Bosses drop 3 items, others drop 1
      const drops = this.type === EnemyType.BOSS ? 3 : 1;
      const itemLevel = this.type === EnemyType.BOSS ? this.dungeonLevel + 2 : this.dungeonLevel;
      for(let i=0; i<drops; i++) {
        this.onDeath(LootManager.generateItem(itemLevel, undefined, this.dungeonLevel));
      }
    }

    // Dispose of mesh resources to prevent memory leaks
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });

    this.scene.remove(this.mesh);
    if (this.aoeIndicator) {
      this.scene.remove(this.aoeIndicator);
      this.aoeIndicator.geometry.dispose();
      (this.aoeIndicator.material as THREE.Material).dispose();
    }
    if (this.directionalIndicator) {
      this.scene.remove(this.directionalIndicator);
      this.directionalIndicator.geometry.dispose();
      (this.directionalIndicator.material as THREE.Material).dispose();
    }
    this.world.removeRigidBody(this.body);
  }
}
