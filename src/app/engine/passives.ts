export interface PassiveStatModifiers {
  strength?: number;
  dexterity?: number;
  intelligence?: number;
  vitality?: number;
  maxHealthMultiplier?: number;
  damageMultiplier?: number;
  attackSpeedMultiplier?: number;
  movementSpeedMultiplier?: number;
  critChance?: number;
  critDamage?: number;
}

export interface PassiveNode {
  id: string;
  name: string;
  description: string;
  x: number;
  y: number;
  connections: string[];
  stats: PassiveStatModifiers;
  isKeystone?: boolean;
  isNotable?: boolean;
}

export const PASSIVE_TREE: Record<string, PassiveNode> = {
  'start': {
    id: 'start',
    name: 'The Beginning',
    description: 'Your journey starts here.',
    x: 50,
    y: 50,
    connections: ['str_1', 'dex_1', 'int_1'],
    stats: {}
  },
  // Strength Branch
  'str_1': {
    id: 'str_1',
    name: 'Minor Strength',
    description: '+5 Strength',
    x: 30,
    y: 40,
    connections: ['start', 'str_2', 'str_3'],
    stats: { strength: 5 }
  },
  'str_2': {
    id: 'str_2',
    name: 'Minor Strength',
    description: '+5 Strength',
    x: 15,
    y: 35,
    connections: ['str_1', 'str_notable_1'],
    stats: { strength: 5 }
  },
  'str_3': {
    id: 'str_3',
    name: 'Minor Vitality',
    description: '+5 Vitality',
    x: 25,
    y: 20,
    connections: ['str_1', 'str_notable_1'],
    stats: { vitality: 5 }
  },
  'str_notable_1': {
    id: 'str_notable_1',
    name: 'Juggernaut',
    description: '+15 Strength, +10% Max Health',
    x: 10,
    y: 15,
    connections: ['str_2', 'str_3', 'keystone_blood_magic'],
    stats: { strength: 15, maxHealthMultiplier: 1.1 },
    isNotable: true
  },
  'keystone_blood_magic': {
    id: 'keystone_blood_magic',
    name: 'Blood Magic',
    description: 'Removes Mana. Skills cost Life instead. +30% Max Health.',
    x: -10,
    y: 0,
    connections: ['str_notable_1'],
    stats: { maxHealthMultiplier: 1.3 }, // Simplified for now, just gives huge health
    isKeystone: true
  },
  'keystone_glass_cannon': {
    id: 'keystone_glass_cannon',
    name: 'Glass Cannon',
    description: '50% More Damage, 30% Less Max Health',
    x: 10,
    y: -10,
    connections: ['str_notable_1', 'dex_notable_1'],
    stats: { damageMultiplier: 1.5, maxHealthMultiplier: 0.7 },
    isKeystone: true
  },

  // Dexterity Branch
  'dex_1': {
    id: 'dex_1',
    name: 'Minor Dexterity',
    description: '+5 Dexterity',
    x: 50,
    y: 20,
    connections: ['start', 'dex_2', 'dex_3'],
    stats: { dexterity: 5 }
  },
  'dex_2': {
    id: 'dex_2',
    name: 'Minor Dexterity',
    description: '+5 Dexterity',
    x: 40,
    y: 5,
    connections: ['dex_1', 'dex_notable_1'],
    stats: { dexterity: 5 }
  },
  'dex_3': {
    id: 'dex_3',
    name: 'Minor Speed',
    description: '+5% Movement Speed',
    x: 60,
    y: 5,
    connections: ['dex_1', 'dex_notable_1'],
    stats: { movementSpeedMultiplier: 1.05 }
  },
  'dex_notable_1': {
    id: 'dex_notable_1',
    name: 'Acrobatics',
    description: '+15 Dexterity, +10% Movement Speed',
    x: 50,
    y: -10,
    connections: ['dex_2', 'dex_3', 'keystone_glass_cannon', 'keystone_perfect_agony'],
    stats: { dexterity: 15, movementSpeedMultiplier: 1.1 },
    isNotable: true
  },
  'keystone_perfect_agony': {
    id: 'keystone_perfect_agony',
    name: 'Perfect Agony',
    description: '+50% Crit Damage, -20% Attack Speed',
    x: 50,
    y: -30,
    connections: ['dex_notable_1'],
    stats: { critDamage: 50, attackSpeedMultiplier: 0.8 },
    isKeystone: true
  },

  // Intelligence Branch
  'int_1': {
    id: 'int_1',
    name: 'Minor Intelligence',
    description: '+5 Intelligence',
    x: 70,
    y: 40,
    connections: ['start', 'int_2', 'int_3'],
    stats: { intelligence: 5 }
  },
  'int_2': {
    id: 'int_2',
    name: 'Minor Intelligence',
    description: '+5 Intelligence',
    x: 85,
    y: 35,
    connections: ['int_1', 'int_notable_1'],
    stats: { intelligence: 5 }
  },
  'int_3': {
    id: 'int_3',
    name: 'Minor Cast Speed',
    description: '+5% Cast Speed',
    x: 75,
    y: 20,
    connections: ['int_1', 'int_notable_1'],
    stats: { attackSpeedMultiplier: 1.05 } // Using attackSpeedMultiplier for both for simplicity
  },
  'int_notable_1': {
    id: 'int_notable_1',
    name: 'Arcanist',
    description: '+15 Intelligence, +10% Cast Speed',
    x: 90,
    y: 15,
    connections: ['int_2', 'int_3', 'keystone_chaos_inoculation'],
    stats: { intelligence: 15, attackSpeedMultiplier: 1.1 },
    isNotable: true
  },
  'keystone_chaos_inoculation': {
    id: 'keystone_chaos_inoculation',
    name: 'Eldritch Battery',
    description: '+50% Cast Speed, -30% Damage',
    x: 110,
    y: 0,
    connections: ['int_notable_1'],
    stats: { attackSpeedMultiplier: 1.5, damageMultiplier: 0.7 },
    isKeystone: true
  }
};
