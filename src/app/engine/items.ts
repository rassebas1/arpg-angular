export enum Rarity {
  COMMON = 'common',
  UNCOMMON = 'uncommon',
  RARE = 'rare',
  EPIC = 'epic',
  LEGENDARY = 'legendary'
}

export enum CraftingMaterial {
  DUST = 'dust',
  SHARD = 'shard',
  ESSENCE = 'essence',
  RUNE = 'rune'
}

export enum WeaponType {
  DAGGER = 'dagger',
  SWORD = 'sword',
  AXE = 'axe',
  MACE = 'mace',
  GREATSWORD = 'greatsword',
  BOW = 'bow',
  STAFF = 'staff',
  WAND = 'wand',
  SPELLBLADE = 'spellblade',
  SHIELD = 'shield'
}

export enum ItemSlot {
  MAIN_HAND = 'main_hand',
  OFF_HAND = 'off_hand',
  HEAD = 'head',
  CHEST = 'chest',
  LEGS = 'legs',
  SHOULDERS = 'shoulders',
  GLOVES = 'gloves',
  BOOTS = 'boots',
  BELT = 'belt',
  NECKLACE = 'necklace',
  RING_1 = 'ring_1',
  RING_2 = 'ring_2',
  EARRING = 'earring',
  CONSUMABLE = 'consumable'
}

export enum ConsumableType {
  HEALTH_POTION = 'health_potion',
  MANA_POTION = 'mana_potion',
  BLOCK_POTION = 'block_potion',
  EVADE_POTION = 'evade_potion'
}

export interface ItemStats {
  attack?: number;
  defense?: number;
  speed?: number;
  intelligence?: number;
  strength?: number;
  dexterity?: number;
  vitality?: number;
  critChance?: number;
  critDamage?: number;
  attackSpeed?: number;
  castSpeed?: number;
  manaRegeneration?: number;
  lifeRegeneration?: number;
  lifeLeechAttack?: number;
  lifeLeechSpell?: number;
  fireResistance?: number;
  lightningResistance?: number;
  iceResistance?: number;
  poisonResistance?: number;
  blockChance?: number;
  evasion?: number;
  maxHealth?: number;
  maxMana?: number;
}

export interface Item {
  id: string;
  name: string;
  rarity: Rarity;
  slot: ItemSlot;
  level: number;
  isTwoHanded?: boolean;
  weaponType?: WeaponType;
  consumableType?: ConsumableType;
  goldValue: number;
  stats: ItemStats;
  corrupted?: boolean;
  sockets?: number;
  imprinted?: boolean;
  setId?: string;
}

export interface SetBonus {
  piecesRequired: number;
  stats: ItemStats;
}

export interface ItemSet {
  id: string;
  name: string;
  bonuses: SetBonus[];
}

export const ITEM_SETS: Record<string, ItemSet> = {
  'warlord': {
    id: 'warlord',
    name: "Warlord's",
    bonuses: [
      { piecesRequired: 2, stats: { maxHealth: 50, vitality: 10 } },
      { piecesRequired: 4, stats: { strength: 20, attack: 15 } },
      { piecesRequired: 6, stats: { lifeLeechAttack: 5, attackSpeed: 20 } }
    ]
  },
  'archmage': {
    id: 'archmage',
    name: "Archmage's",
    bonuses: [
      { piecesRequired: 2, stats: { maxMana: 50, intelligence: 10 } },
      { piecesRequired: 4, stats: { castSpeed: 20, manaRegeneration: 10 } },
      { piecesRequired: 6, stats: { lifeLeechSpell: 5, evasion: 20 } }
    ]
  },
  'assassin': {
    id: 'assassin',
    name: "Assassin's",
    bonuses: [
      { piecesRequired: 2, stats: { speed: 10, dexterity: 10 } },
      { piecesRequired: 4, stats: { critChance: 10, critDamage: 50 } },
      { piecesRequired: 6, stats: { evasion: 30, attackSpeed: 30 } }
    ]
  }
};

export const RARITY_COLORS = {
  [Rarity.COMMON]: '#ffffff',
  [Rarity.UNCOMMON]: '#1eff00',
  [Rarity.RARE]: '#0070dd',
  [Rarity.EPIC]: '#a335ee',
  [Rarity.LEGENDARY]: '#ff8000'
};

export class LootManager {
  static generateItem(level: number, forceRarity?: Rarity, dungeonLevel: number = 1, forceSlot?: ItemSlot): Item {
    const rarities = Object.values(Rarity);
    const weights = [60, 25, 10, 4, 1];
    
    let rarity = Rarity.COMMON;
    let rarityIndex = 0;

    if (forceRarity) {
      rarity = forceRarity;
      rarityIndex = rarities.indexOf(forceRarity);
    } else {
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let random = Math.random() * totalWeight;
      
      for (let i = 0; i < weights.length; i++) {
        if (random < weights[i]) {
          rarity = rarities[i];
          rarityIndex = i;
          break;
        }
        random -= weights[i];
      }
    }

    let isSetItem = false;
    let setId: string | undefined = undefined;
    
    // 5% chance to roll a set item if not forcing a specific rarity other than Rare/Epic/Legendary
    if (!forceRarity && Math.random() < 0.05) {
      isSetItem = true;
      rarity = Rarity.LEGENDARY; // Set items are legendary tier
      rarityIndex = 4;
      
      const setKeys = Object.keys(ITEM_SETS);
      setId = setKeys[Math.floor(Math.random() * setKeys.length)];
    }

    const slots = Object.values(ItemSlot).filter(s => s !== ItemSlot.CONSUMABLE);
    
    // 20% chance to drop a consumable if not forced
    if (!forceSlot && Math.random() < 0.20) {
      const cTypes = Object.values(ConsumableType);
      const cType = cTypes[Math.floor(Math.random() * cTypes.length)];
      
      let pName = 'Health Potion';
      if (cType === ConsumableType.MANA_POTION) pName = 'Mana Potion';
      if (cType === ConsumableType.BLOCK_POTION) pName = 'Block Potion';
      if (cType === ConsumableType.EVADE_POTION) pName = 'Evade Potion';
      
      return {
        id: `consumable_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name: pName,
        rarity: Rarity.COMMON,
        slot: ItemSlot.CONSUMABLE,
        consumableType: cType,
        level: level,
        goldValue: 10 * level,
        stats: {} // Potions don't use equip stats
      };
    }
    
    const slot = forceSlot || slots[Math.floor(Math.random() * slots.length)];

    const prefixes = ['Rusty', 'Sharp', 'Ancient', 'Glowing', 'Cursed', 'Divine', 'Heavy', 'Light'];
    
    let typeName = '';
    const stats: ItemStats = {};
    let isTwoHanded = false;
    let weaponType: WeaponType | undefined;

    let itemCategory: 'weapon' | 'armor' | 'jewelry' = 'armor';

    const rollMultiplier = 1 + (dungeonLevel - 1) * 0.2;

    if (slot === ItemSlot.MAIN_HAND || slot === ItemSlot.OFF_HAND) {
      itemCategory = 'weapon';
      const weapons = Object.values(WeaponType).filter(w => w !== WeaponType.SHIELD);
      
      if (slot === ItemSlot.OFF_HAND) {
        // Offhand can be shield or specific offhand weapons. Let's just give it a chance to be a shield
        if (Math.random() > 0.5) {
          weaponType = WeaponType.SHIELD;
        } else {
          weaponType = weapons[Math.floor(Math.random() * weapons.length)];
        }
      } else {
        weaponType = weapons[Math.floor(Math.random() * weapons.length)];
      }

      typeName = weaponType.charAt(0).toUpperCase() + weaponType.slice(1);
      
      if (weaponType === WeaponType.SHIELD) {
        stats.defense = Math.floor((Math.random() * 8 * level + 5) * rollMultiplier);
        // Base block chance between 10% and 30%
        stats.blockChance = Math.floor(10 + Math.random() * 20);
      } else {
        stats.attack = Math.floor((Math.random() * 10 * level + 5) * rollMultiplier);
        if (weaponType === WeaponType.GREATSWORD || weaponType === WeaponType.BOW || weaponType === WeaponType.STAFF) {
          isTwoHanded = true;
          stats.attack = Math.floor(stats.attack * 1.5);
        }
      }
    } else if ([ItemSlot.NECKLACE, ItemSlot.RING_1, ItemSlot.RING_2, ItemSlot.EARRING].includes(slot)) {
      itemCategory = 'jewelry';
      const jewels = ['Amulet', 'Band', 'Signet', 'Pendant', 'Stud'];
      typeName = jewels[Math.floor(Math.random() * jewels.length)];
      // Jewelry base stat
      stats.intelligence = Math.floor((Math.random() * 3 * level + 1) * rollMultiplier);
      stats.vitality = Math.floor((Math.random() * 3 * level + 1) * rollMultiplier);
    } else {
      itemCategory = 'armor';
      const armors: Record<string, string[]> = {
        [ItemSlot.HEAD]: ['Helmet', 'Cap', 'Crown'],
        [ItemSlot.CHEST]: ['Armor', 'Tunic', 'Plate'],
        [ItemSlot.LEGS]: ['Pants', 'Greaves', 'Leggings'],
        [ItemSlot.SHOULDERS]: ['Spaulders', 'Mantle', 'Shoulderguards'],
        [ItemSlot.GLOVES]: ['Gloves', 'Gauntlets', 'Mitts'],
        [ItemSlot.BOOTS]: ['Boots', 'Shoes', 'Sabatons'],
        [ItemSlot.BELT]: ['Belt', 'Sash', 'Girdle']
      };
      const names = armors[slot] || ['Armor'];
      typeName = names[Math.floor(Math.random() * names.length)];
      stats.defense = Math.floor((Math.random() * 5 * level + 2) * rollMultiplier);
      if (slot === ItemSlot.CHEST) stats.defense *= 2;
    }
    
    // Add extra stats based on rarity
    const numExtraStats = rarityIndex; // COMMON = 0, UNCOMMON = 1, RARE = 2, EPIC = 3, LEGENDARY = 4
    
    const weaponPool: (keyof ItemStats)[] = ['strength', 'dexterity', 'intelligence', 'critChance', 'critDamage', 'attackSpeed', 'castSpeed', 'lifeLeechAttack', 'lifeLeechSpell'];
    const armorPool: (keyof ItemStats)[] = ['strength', 'dexterity', 'intelligence', 'vitality', 'speed', 'lifeRegeneration', 'manaRegeneration', 'fireResistance', 'lightningResistance', 'iceResistance', 'poisonResistance', 'evasion'];
    const jewelryPool: (keyof ItemStats)[] = ['critChance', 'critDamage', 'attackSpeed', 'castSpeed', 'strength', 'dexterity', 'intelligence', 'vitality', 'lifeRegeneration', 'manaRegeneration', 'fireResistance', 'lightningResistance', 'iceResistance', 'poisonResistance', 'evasion'];
    const shieldPool: (keyof ItemStats)[] = ['strength', 'vitality', 'lifeRegeneration', 'fireResistance', 'lightningResistance', 'iceResistance', 'poisonResistance', 'blockChance', 'evasion'];
    
    let pool = armorPool;
    if (itemCategory === 'weapon') {
      if (weaponType === WeaponType.SHIELD) {
        pool = shieldPool;
      } else {
        pool = weaponPool;
      }
    }
    if (itemCategory === 'jewelry') pool = jewelryPool;

    // Shuffle pool to pick unique random stats
    const shuffledPool = [...pool].sort(() => 0.5 - Math.random());
    
    for (let i = 0; i < numExtraStats && i < shuffledPool.length; i++) {
      const statName = shuffledPool[i];
      switch (statName) {
        case 'critChance':
          stats.critChance = (stats.critChance || 0) + Math.floor((Math.random() * 5 + 1) * rollMultiplier); // 1-5%
          break;
        case 'critDamage':
          stats.critDamage = (stats.critDamage || 0) + Math.floor((Math.random() * 20 + 5) * rollMultiplier); // 5-25%
          break;
        case 'attackSpeed':
          stats.attackSpeed = (stats.attackSpeed || 0) + Math.floor((Math.random() * 10 + 2) * rollMultiplier); // 2-12%
          break;
        case 'castSpeed':
          stats.castSpeed = (stats.castSpeed || 0) + Math.floor((Math.random() * 10 + 2) * rollMultiplier); // 2-12%
          break;
        case 'speed':
          stats.speed = (stats.speed || 0) + Math.floor((Math.random() * 2 * level + 1) * rollMultiplier);
          break;
        case 'lifeLeechAttack':
        case 'lifeLeechSpell':
          stats[statName] = (stats[statName] || 0) + Math.floor((Math.random() * 5 + 1) * rollMultiplier); // 1-6% chance
          break;
        case 'fireResistance':
        case 'lightningResistance':
        case 'iceResistance':
        case 'poisonResistance':
          stats[statName] = (stats[statName] || 0) + Math.floor((Math.random() * 15 + 5) * rollMultiplier); // 5-20 resistance
          break;
        case 'blockChance':
        case 'evasion':
          stats[statName] = (stats[statName] || 0) + Math.floor((Math.random() * 10 + 2) * rollMultiplier);
          break;
        case 'lifeRegeneration':
        case 'manaRegeneration':
          stats[statName] = (stats[statName] || 0) + Math.floor((Math.random() * 5 * level + 1) * rollMultiplier);
          break;
        default:
          stats[statName] = (stats[statName] || 0) + Math.floor((Math.random() * 4 * level + 1) * rollMultiplier);
          break;
      }
    }

    let name = `${prefixes[Math.floor(Math.random() * prefixes.length)]} ${typeName}`;
    if (isSetItem && setId) {
      name = `${ITEM_SETS[setId].name} ${typeName}`;
    }

    const goldValue = Math.floor((Math.random() * 10 * level + (rarityIndex * 20) + 5) * rollMultiplier);

    return {
      id: Math.random().toString(36).substring(2, 9),
      name,
      rarity,
      slot,
      level,
      isTwoHanded,
      weaponType,
      goldValue,
      stats,
      setId
    };
  }
}
