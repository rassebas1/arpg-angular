# ⚔️ Web-ARPG Project Roadmap: "Project Abyss"

Project Goal: A high-performance, browser-based ARPG with isometric camera, click-to-move mechanics, and procedural loot systems.
Primary Stack: TypeScript, Three.js (Rendering), Rapier.js (Physics), and Colyseus (Networking/State).

## 🟦 Phase 1: Core Engine & Boilerplate [DONE]
- [x] Environment Setup
- [x] Isometric Camera System
- [x] Basic Player Controller

## 🟥 Phase 2: The "Diablo" Aesthetic (Visuals) [DONE]
- [x] Lighting & Atmosphere
- [x] Asset Pipeline

## 🟧 Phase 3: Combat & Skill Systems [DONE]
- [x] Combat Logic
- [x] The Skill Tree / Ability System
- [x] Enemy AI

## 🟩 Phase 4: RPG Systems (The Loot Grind) [DONE]
- [x] Data Schema (Slots, Rarities, Stats)
- [x] Inventory System (Equipping gear)
- [x] Character Attributes (STR, DEX, INT, VIT)
- [x] Expanded Itemization (13 slots, 2-handed weapons, base stats by category)
- [x] Advanced Stats (Crit Chance, Crit Damage, Attack Speed)
- [x] Spell System (Fireball)
- [x] Persistence (LocalStorage)
- [x] Experience & Leveling

## 🟨 Phase 5: Visuals & "The Juice" [DONE]
- [x] Floating Damage Numbers
- [x] Particle Effects
- [x] Real 3D Models & Animations

## 🟧 Phase 6: Combat & Survival [DONE]
- [x] Player Health & Mana Globes (Replaced with modern HUD)
- [x] Enemy Attacks & Damage
- [x] Enemy Health Bars

## 🟪 Phase 7: Web Optimization (Performance) [DONE]
- [x] Asset Management
- [x] Instanced Rendering (Pillars & Particles)
- [x] Worker Threads / WASM Physics (Rapier)

## 🟫 Phase 8: Procedural Generation & World Building [DONE]
- [x] Procedural Dungeon Generation (BSP or Cellular Automata)
- [x] NavMesh Generation for AI Pathfinding (A*)
- [x] Interactable Objects (Chests, Doors, Shrines, Crafting Bench)
- [x] Minimap System (Full dungeon grid, walls, corridors, rooms, entities)

## ⬛ Phase 9: Advanced RPG Mechanics & Itemization [DONE]
- [x] Advanced Survival Stats (Life Regeneration, Elemental Resistances)
- [x] Life Leech Mechanics (Heal-over-time, Max Leech Rate caps, Attack vs Spell leech)
- [x] Expanded Item Affixes (Resistances, Leech, Regen on gear)
- [x] Crafting System (Materials, Upgrading, Rerolling)

## ⬜ Phase 10: Advanced Enemy Mechanics & Bosses [PLANNED]
- [ ] Elite Enemy Modifiers (e.g., "Fire Enchanted", "Fast")
- [ ] Boss Fights with Phased Mechanics
- [ ] Telegraphing Attacks (AoE indicators)

## 🟨 Phase 11: Polish & Game Loop [PLANNED]
- [ ] Main Menu & Character Selection
- [ ] Sound Effects & Adaptive Music
- [ ] Game Over & Respawn Mechanics
- [ ] Final Performance Tuning
