export type SkillCategory = 'attack' | 'spell' | 'support';

export interface SkillEffect {
  damageMultiplier?: number;
  projectiles?: number;
  aoeMultiplier?: number;
  cooldownMultiplier?: number;
}

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  category: SkillCategory;
  baseDamage: number;
  baseCooldown: number;
  baseManaCost?: number;
  baseAoe?: number;
  baseProjectiles?: number;
  supportEffects?: SkillEffect;
  allowedCategories?: SkillCategory[];
  color: string;
}

export const SKILL_REGISTRY: Record<string, SkillDef> = {
  // Attacks
  'strike': { id: 'strike', name: 'Heavy Strike', description: 'A powerful single-target melee attack.', category: 'attack', baseDamage: 15, baseCooldown: 0.5, baseManaCost: 5, baseAoe: 2, color: '#ff4444' },
  'cleave': { id: 'cleave', name: 'Cleave', description: 'A sweeping attack that hits multiple enemies in front of you.', category: 'attack', baseDamage: 10, baseCooldown: 0.8, baseManaCost: 8, baseAoe: 3.5, color: '#ffaa00' },
  'leap': { id: 'leap', name: 'Leap Slam', description: 'Jump to a location, damaging enemies where you land.', category: 'attack', baseDamage: 12, baseCooldown: 2.0, baseManaCost: 10, baseAoe: 4, color: '#ff8844' },
  'whirlwind': { id: 'whirlwind', name: 'Whirlwind', description: 'Spin rapidly, damaging all nearby enemies.', category: 'attack', baseDamage: 8, baseCooldown: 0.3, baseManaCost: 4, baseAoe: 3, color: '#aaaaaa' },
  'smite': { id: 'smite', name: 'Smite', description: 'Strike an enemy and call down lightning.', category: 'attack', baseDamage: 18, baseCooldown: 1.0, baseManaCost: 8, baseAoe: 2.5, color: '#ffffaa' },
  
  // Spells
  'fireball': { id: 'fireball', name: 'Fireball', description: 'Shoots a flaming projectile.', category: 'spell', baseDamage: 20, baseCooldown: 1.0, baseManaCost: 15, baseProjectiles: 1, color: '#ff5500' },
  'nova': { id: 'nova', name: 'Frost Nova', description: 'An explosion of ice that damages all enemies around you.', category: 'spell', baseDamage: 15, baseCooldown: 1.5, baseManaCost: 20, baseAoe: 5, color: '#00aaff' },
  'arc': { id: 'arc', name: 'Arc', description: 'Lightning that chains between enemies.', category: 'spell', baseDamage: 18, baseCooldown: 1.2, baseManaCost: 18, baseAoe: 6, color: '#aa00ff' },
  'ice_spear': { id: 'ice_spear', name: 'Ice Spear', description: 'Fires a fast, piercing icy projectile.', category: 'spell', baseDamage: 25, baseCooldown: 0.8, baseManaCost: 15, baseProjectiles: 1, color: '#88ffff' },
  'meteor': { id: 'meteor', name: 'Meteor', description: 'Calls down a massive meteor from the sky.', category: 'spell', baseDamage: 40, baseCooldown: 3.0, baseManaCost: 35, baseAoe: 8, color: '#ff2200' },
  
  // Supports
  'lmp': { id: 'lmp', name: 'Multiple Projectiles', description: 'Fires 2 additional projectiles but deals 30% less damage.', category: 'support', baseDamage: 0, baseCooldown: 0, supportEffects: { projectiles: 2, damageMultiplier: 0.7 }, allowedCategories: ['spell'], color: '#44ff44' },
  'gmp': { id: 'gmp', name: 'Greater Multiple Projectiles', description: 'Fires 4 additional projectiles but deals 50% less damage.', category: 'support', baseDamage: 0, baseCooldown: 0, supportEffects: { projectiles: 4, damageMultiplier: 0.5 }, allowedCategories: ['spell'], color: '#22cc22' },
  'inc_aoe': { id: 'inc_aoe', name: 'Increased Area', description: 'Increases area of effect by 50%.', category: 'support', baseDamage: 0, baseCooldown: 0, supportEffects: { aoeMultiplier: 1.5 }, allowedCategories: ['attack', 'spell'], color: '#4444ff' },
  'conc_effect': { id: 'conc_effect', name: 'Concentrated Effect', description: 'Deals 40% more damage but reduces area of effect by 30%.', category: 'support', baseDamage: 0, baseCooldown: 0, supportEffects: { aoeMultiplier: 0.7, damageMultiplier: 1.4 }, allowedCategories: ['attack', 'spell'], color: '#1111aa' },
  'fast_cast': { id: 'fast_cast', name: 'Faster Actions', description: 'Reduces cooldown by 30% but deals 10% less damage.', category: 'support', baseDamage: 0, baseCooldown: 0, supportEffects: { cooldownMultiplier: 0.7, damageMultiplier: 0.9 }, allowedCategories: ['attack', 'spell'], color: '#ffff44' },
  'added_fire': { id: 'added_fire', name: 'Added Fire Damage', description: 'Adds 20% more damage.', category: 'support', baseDamage: 0, baseCooldown: 0, supportEffects: { damageMultiplier: 1.2 }, allowedCategories: ['attack', 'spell'], color: '#ff2222' },
  'brutality': { id: 'brutality', name: 'Brutality', description: 'Deals 30% more damage.', category: 'support', baseDamage: 0, baseCooldown: 0, supportEffects: { damageMultiplier: 1.3 }, allowedCategories: ['attack'], color: '#aa1111' },
  'echo': { id: 'echo', name: 'Spell Echo', description: 'Massively reduces cooldown by 50% but deals 20% less damage.', category: 'support', baseDamage: 0, baseCooldown: 0, supportEffects: { cooldownMultiplier: 0.5, damageMultiplier: 0.8 }, allowedCategories: ['spell'], color: '#aa44ff' }
};
