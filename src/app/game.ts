import { Component, ElementRef, ViewChild, AfterViewInit, OnInit, inject, HostListener, signal, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { GameEngine } from './engine/game-engine';
import { RARITY_COLORS, Rarity, Item, ItemSlot, ItemStats, LootManager, CraftingMaterial, ConsumableType, ITEM_SETS } from './engine/items';
import { SKILL_REGISTRY, SkillDef, SkillCategory } from './engine/skills';
import { AssetService } from './engine/asset-service';
import { PASSIVE_TREE, PassiveNode } from './engine/passives';

@Component({
  selector: 'app-game',
  standalone: true,
  imports: [MatIconModule, DecimalPipe],
  template: `
    <div #gameContainer class="w-full h-full relative bg-[#050508]">
      <!-- Loading Overlay -->
      @if (!isLoaded()) {
        <div class="absolute inset-0 z-50 bg-[#050508] flex flex-col items-center justify-center">
          <div class="w-64 h-1 bg-white/5 rounded-full overflow-hidden mb-4">
            <div class="h-full bg-emerald-500 transition-all duration-300" [style.width.%]="loadingProgress()"></div>
          </div>
          <p class="text-[10px] font-mono text-white/40 uppercase tracking-[0.2em]">Loading Assets {{ loadingProgress() }}%</p>
        </div>
      }

      <!-- HUD Top -->
      @if (gameState() === 'playing') {
      <div class="absolute top-4 left-4 z-10 pointer-events-none">
        <h1 class="text-4xl font-display font-bold text-white tracking-tighter uppercase italic">Project Abyss</h1>
        <p class="text-xs font-mono text-emerald-400">PHASE 10: ITEM SYSTEM POLISH</p>
        <div class="mt-2 flex items-center gap-2 bg-black/60 backdrop-blur-md border border-white/10 rounded-full px-3 py-1 w-fit">
          <mat-icon class="text-yellow-400 text-sm">monetization_on</mat-icon>
          <span class="text-yellow-400 font-mono text-sm font-bold">{{ gold() }}</span>
        </div>
      </div>

      <!-- 2D Overlays (Health Bars & Damage Numbers) -->
      <div class="absolute inset-0 z-20 pointer-events-none overflow-hidden">
        <!-- Enemy Health Bars & Debuffs -->
        @for (enemy of enemyUI(); track enemy.id) {
          <div class="absolute flex flex-col items-center gap-0.5" 
               [style.left.px]="enemy.x - 24" 
               [style.top.px]="enemy.y - 10">
            <div class="w-12 h-1.5 bg-black/80 border border-white/20 rounded-full overflow-hidden">
              <div class="h-full bg-red-500 transition-all duration-100" [style.width.%]="enemy.hpPercent"></div>
            </div>
            @if (enemy.effects.length > 0) {
              <div class="flex gap-0.5">
                @for (effect of enemy.effects; track effect.type) {
                  <div class="w-3 h-3 rounded-sm border border-white/20 flex items-center justify-center relative"
                       [class.bg-orange-500]="effect.type === 'BURN'"
                       [class.bg-cyan-500]="effect.type === 'FREEZE'"
                       [class.bg-purple-500]="effect.type === 'SHOCK'"
                       [class.bg-green-500]="effect.type === 'POISON'">
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- Damage Numbers -->
        @for (dn of damageNumbers(); track dn.id) {
          <div class="absolute text-xl font-display font-bold drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)] transition-opacity" 
               [style.left.px]="dn.x" 
               [style.top.px]="dn.y" 
               [style.color]="dn.color"
               [style.opacity]="dn.opacity"
               style="transform: translate(-50%, -50%);">
            {{ dn.text }}
          </div>
        }
      </div>

      <!-- Minimap -->
      <div class="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 pointer-events-none">
        <div class="w-40 h-40 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full overflow-hidden">
          <div class="relative w-full h-full">
            <!-- Map Container (Moves opposite to player) -->
            <div class="absolute top-0 left-0 w-full h-full transition-transform duration-75 origin-center"
                 [style.transform]="'scale(2) translate(' + (-playerPos().x / mapSize() * 100) + '%, ' + (-playerPos().z / mapSize() * 100) + '%)'">
              
              <!-- Map Grid (Rooms, Corridors, Walls) -->
              @for (row of dungeonGrid(); track $index) {
                @let y = $index;
                @for (tile of row; track $index) {
                  @let x = $index;
                  @if (tile === 1 || tile === 2) {
                    <div [class]="tile === 1 ? 'absolute bg-white/10' : 'absolute bg-white/30'"
                         [style.left.%]="50 + ((x * tileSize - mapSize()/2) / mapSize() * 100)"
                         [style.top.%]="50 + ((y * tileSize - mapSize()/2) / mapSize() * 100)"
                         [style.width.%]="(tileSize / mapSize() * 100)"
                         [style.height.%]="(tileSize / mapSize() * 100)">
                    </div>
                  }
                }
              }

              <!-- Enemy Dots -->
              @for (enemy of enemyPositions(); track $index) {
                <div class="absolute w-1 h-1 bg-red-500 rounded-full z-10 -translate-x-1/2 -translate-y-1/2"
                     [style.left.%]="50 + (enemy.x / mapSize() * 100)"
                     [style.top.%]="50 + (enemy.z / mapSize() * 100)">
                </div>
              }

              <!-- Interactable Dots -->
              @for (interactable of interactables(); track interactable.id) {
                @if (!interactable.isUsed) {
                  <div class="absolute w-1.5 h-1.5 rounded-full z-10 -translate-x-1/2 -translate-y-1/2"
                       [class.bg-yellow-500]="interactable.type === 'chest'"
                       [class.bg-green-500]="interactable.type === 'shrine_health'"
                       [class.bg-purple-500]="interactable.type === 'shrine_exp'"
                       [style.left.%]="50 + (interactable.position.x / mapSize() * 100)"
                       [style.top.%]="50 + (interactable.position.z / mapSize() * 100)">
                  </div>
                }
              }
            </div>

            <!-- Player Dot (Fixed Center) -->
            <div class="absolute top-1/2 left-1/2 w-2 h-2 bg-emerald-400 rounded-full shadow-[0_0_10px_rgba(52,211,153,0.8)] z-20 -translate-x-1/2 -translate-y-1/2">
            </div>
          </div>
        </div>
        <div class="bg-black/60 backdrop-blur-xl border border-white/10 rounded-full px-4 py-1 pointer-events-auto">
          <span class="text-[10px] font-mono font-bold text-white/80 uppercase tracking-widest">
            {{ currentRegion() === 'town' ? 'Town' : 'Dungeon Lv.' + dungeonLevel() }}
          </span>
        </div>
      </div>

      <!-- Character Stats Modal -->
      @if (showCharacter()) {
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[700px] bg-black/90 backdrop-blur-xl border border-white/20 rounded-2xl flex flex-col max-h-[80vh] shadow-2xl">
        <div class="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center rounded-t-2xl">
          <span class="text-sm font-display font-bold text-white uppercase tracking-widest">Character Profile</span>
          <button (click)="showCharacter.set(false)" class="text-white/40 hover:text-white"><mat-icon>close</mat-icon></button>
        </div>
        
        <div class="flex flex-1 overflow-hidden p-6 gap-8">
          <!-- Left Column: Stats -->
          <div class="w-1/2 flex flex-col space-y-6 overflow-y-auto custom-scrollbar pr-4">
            <div>
              <div class="flex justify-between items-end mb-2">
                <span class="text-2xl font-display font-bold text-white">Level {{ stats().level }}</span>
                <span class="text-xs font-mono text-emerald-400">{{ stats().exp }} / {{ stats().expToNext }} EXP</span>
              </div>
              <div class="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div class="h-full bg-emerald-500 transition-all duration-300" [style.width.%]="(stats().exp / stats().expToNext) * 100"></div>
              </div>
            </div>

            <div class="space-y-4">
              <div>
                <h3 class="text-xs font-mono text-white/40 uppercase tracking-widest mb-2 border-b border-white/10 pb-1">Core Attributes</h3>
                <div class="grid grid-cols-2 gap-2">
                  <div class="bg-white/5 p-2 rounded-lg flex justify-between items-center relative group cursor-help">
                    <span class="text-[10px] font-mono text-red-400/80">STR</span>
                    <span class="text-sm font-bold text-white">{{ stats().strength }}</span>
                    <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-xs font-bold text-red-400 mb-1">Strength</div>
                      <div class="text-[10px] text-white/60">Increases Attack Damage (+2 per point) and Critical Damage (+0.5% per point).</div>
                    </div>
                  </div>
                  <div class="bg-white/5 p-2 rounded-lg flex justify-between items-center relative group cursor-help">
                    <span class="text-[10px] font-mono text-green-400/80">DEX</span>
                    <span class="text-sm font-bold text-white">{{ stats().dexterity }}</span>
                    <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-xs font-bold text-green-400 mb-1">Dexterity</div>
                      <div class="text-[10px] text-white/60">Increases Movement Speed (+0.1 per point) and Critical Chance (+0.2% per point).</div>
                    </div>
                  </div>
                  <div class="bg-white/5 p-2 rounded-lg flex justify-between items-center relative group cursor-help">
                    <span class="text-[10px] font-mono text-blue-400/80">INT</span>
                    <span class="text-sm font-bold text-white">{{ stats().intelligence }}</span>
                    <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-xs font-bold text-blue-400 mb-1">Intelligence</div>
                      <div class="text-[10px] text-white/60">Increases Spell Damage (+2 per point).</div>
                    </div>
                  </div>
                  <div class="bg-white/5 p-2 rounded-lg flex justify-between items-center relative group cursor-help">
                    <span class="text-[10px] font-mono text-orange-400/80">VIT</span>
                    <span class="text-sm font-bold text-white">{{ stats().vitality }}</span>
                    <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-xs font-bold text-orange-400 mb-1">Vitality</div>
                      <div class="text-[10px] text-white/60">Increases Max Health (+10 per point) and Defense (+1 per point).</div>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 class="text-xs font-mono text-white/40 uppercase tracking-widest mb-2 border-b border-white/10 pb-1">Combat Stats</h3>
                <div class="space-y-1">
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-emerald-400/80">Attack</span>
                    <span class="text-sm font-bold text-emerald-400">{{ stats().attack }}</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Base physical damage dealt by your attacks and weapon skills.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-blue-400/80">Defense</span>
                    <span class="text-sm font-bold text-blue-400">{{ stats().defense }}</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Reduces incoming physical damage from enemies.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-amber-400/80">Movement Speed</span>
                    <span class="text-sm font-bold text-amber-400">{{ stats().speed.toFixed(1) }}</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">How fast your character moves around the world.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-purple-400/80">Crit Chance</span>
                    <span class="text-sm font-bold text-purple-400">{{ stats().critChance.toFixed(1) }}%</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">The probability of dealing a critical hit for extra damage.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-purple-400/80">Crit Damage</span>
                    <span class="text-sm font-bold text-purple-400">{{ stats().critDamage.toFixed(0) }}%</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">The damage multiplier applied when a critical hit occurs.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-orange-400/80">Attack Speed</span>
                    <span class="text-sm font-bold text-orange-400">{{ stats().attackSpeed.toFixed(0) }}%</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Reduces the cooldown between your attacks.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-pink-400/80">Cast Speed</span>
                    <span class="text-sm font-bold text-pink-400">{{ stats().castSpeed.toFixed(0) }}%</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Reduces the cooldown between your spells.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-red-400/80">Life Regen</span>
                    <span class="text-sm font-bold text-red-400">{{ stats().lifeRegeneration }}/s</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Health recovered every second.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-blue-400/80">Mana Regen</span>
                    <span class="text-sm font-bold text-blue-400">{{ stats().manaRegeneration.toFixed(1) }}/s</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Extra mana recovered every second.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-red-500/80">Life Leech (Attack)</span>
                    <span class="text-sm font-bold text-red-500">{{ stats().lifeLeechAttack }}%</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Heals for {{ stats().lifeLeechAttack }}% of Attack damage dealt over 5 seconds.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-blue-500/80">Life Leech (Spell)</span>
                    <span class="text-sm font-bold text-blue-500">{{ stats().lifeLeechSpell }}%</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Heals for {{ stats().lifeLeechSpell }}% of Spell damage dealt over 5 seconds.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-pink-500/80">Max Leech Rate</span>
                    <span class="text-sm font-bold text-pink-500">{{ stats().maxLifeLeechRate }}%</span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Maximum health that can be recovered per second from Life Leech.</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-orange-500/80">Fire Res</span>
                    <span class="text-sm font-bold text-orange-500">
                      {{ stats().fireResistance > 75 ? '75% (' + stats().fireResistance + '%)' : stats().fireResistance + '%' }}
                    </span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Reduces incoming fire damage (capped at 75%).</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-yellow-300/80">Lightning Res</span>
                    <span class="text-sm font-bold text-yellow-300">
                      {{ stats().lightningResistance > 75 ? '75% (' + stats().lightningResistance + '%)' : stats().lightningResistance + '%' }}
                    </span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Reduces incoming lightning damage (capped at 75%).</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-cyan-400/80">Ice Res</span>
                    <span class="text-sm font-bold text-cyan-400">
                      {{ stats().iceResistance > 75 ? '75% (' + stats().iceResistance + '%)' : stats().iceResistance + '%' }}
                    </span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Reduces incoming ice damage (capped at 75%).</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-green-500/80">Poison Res</span>
                    <span class="text-sm font-bold text-green-500">
                      {{ stats().poisonResistance > 75 ? '75% (' + stats().poisonResistance + '%)' : stats().poisonResistance + '%' }}
                    </span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Reduces incoming poison damage (capped at 75%).</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-cyan-500/80">Evasion</span>
                    <span class="text-sm font-bold text-cyan-500">
                      {{ stats().evasion > 70 ? '70% (' + stats().evasion + '%)' : stats().evasion + '%' }}
                    </span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Chance to completely evade an attack (capped at 70%).</div>
                    </div>
                  </div>
                  <div class="flex justify-between items-center p-1.5 hover:bg-white/5 rounded relative group cursor-help">
                    <span class="text-xs font-mono text-blue-500/80">Block Chance</span>
                    <span class="text-sm font-bold text-blue-500">
                      {{ stats().blockChance > 70 ? '70% (' + stats().blockChance + '%)' : stats().blockChance + '%' }}
                    </span>
                    <div class="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 w-48 bg-black/95 border border-white/20 p-2 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl text-center">
                      <div class="text-[10px] text-white/60">Chance to block incoming damage by 70% (capped at 70%).</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Equipment -->
          <div class="w-1/2 flex flex-col overflow-y-auto custom-scrollbar pr-4">
            <h3 class="text-xs font-mono text-white/40 uppercase tracking-widest mb-4 border-b border-white/10 pb-1 shrink-0">Equipment</h3>
            <div class="grid grid-cols-2 gap-3">
              @for (slot of slots; track slot) {
                <div class="bg-black/40 border border-white/10 rounded-xl p-3 flex flex-col relative group cursor-pointer hover:bg-white/5 transition-colors min-h-[80px]" (click)="unequip(slot)">
                  <span class="text-[9px] font-mono text-white/40 uppercase mb-1">{{ slot.replace('_', ' ') }}</span>
                  @if (equipped()[slot]; as item) {
                    <div class="flex items-center gap-2">
                      <div class="w-8 h-8 rounded flex items-center justify-center shrink-0" [style.backgroundColor]="getRarityColor(item.rarity) + '22'">
                        <mat-icon class="text-sm" [style.color]="getRarityColor(item.rarity)">
                          {{ slot === 'main_hand' || slot === 'off_hand' ? 'colorize' : 'shield' }}
                        </mat-icon>
                      </div>
                      <div class="flex-1 min-w-0">
                        <div class="text-xs font-bold truncate" [style.color]="getRarityColor(item.rarity)">{{ item.name }}</div>
                        <div class="text-[9px] text-white/50">Lv. {{ item.level }}</div>
                      </div>
                    </div>
                    <!-- Tooltip -->
                    <div class="absolute bottom-full mb-2 left-0 w-48 bg-black/95 border border-white/20 p-3 rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-2xl">
                      <div class="text-sm font-bold mb-1" [style.color]="getRarityColor(item.rarity)">{{ item.name }}</div>
                      <div class="text-[10px] text-white/40 font-mono space-y-1 border-t border-white/10 pt-2 mt-2">
                        @for (stat of allStats; track stat.key) {
                          @if (item.stats[stat.key]) {
                            <div [class]="stat.colorClass">{{ stat.label }}: +{{ item.stats[stat.key] }}{{ stat.isPercent ? '%' : '' }}</div>
                          }
                        }
                      </div>
                    </div>
                  } @else {
                    <div class="flex-1 flex items-center justify-center">
                      <mat-icon class="text-white/10 text-2xl">add</mat-icon>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      </div>
      }

      <!-- Inventory Overlay -->
      @if (showInventory()) {
      <div class="absolute top-4 right-4 z-10 w-64 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl flex flex-col max-h-[80vh]">
        <div class="p-4 border-b border-white/10 bg-white/5 flex justify-between items-center rounded-t-2xl">
          <span class="text-xs font-mono font-bold text-white/60 uppercase tracking-widest">Inventory</span>
          <span class="text-[10px] font-mono text-white/30">{{ inventory().length }} / 20</span>
        </div>
        <div class="p-2 border-b border-white/10 flex gap-1 bg-black/40">
          <button (click)="inventorySort.set('rarity')" [class.bg-white]="inventorySort() === 'rarity'" [class.bg-opacity-20]="inventorySort() === 'rarity'" class="flex-1 text-[9px] font-mono text-white/60 hover:bg-white/10 py-1 rounded transition-colors">Rarity</button>
          <button (click)="inventorySort.set('level')" [class.bg-white]="inventorySort() === 'level'" [class.bg-opacity-20]="inventorySort() === 'level'" class="flex-1 text-[9px] font-mono text-white/60 hover:bg-white/10 py-1 rounded transition-colors">Level</button>
          <button (click)="inventorySort.set('slot')" [class.bg-white]="inventorySort() === 'slot'" [class.bg-opacity-20]="inventorySort() === 'slot'" class="flex-1 text-[9px] font-mono text-white/60 hover:bg-white/10 py-1 rounded transition-colors">Slot</button>
          <button (click)="inventorySort.set('value')" [class.bg-white]="inventorySort() === 'value'" [class.bg-opacity-20]="inventorySort() === 'value'" class="flex-1 text-[9px] font-mono text-white/60 hover:bg-white/10 py-1 rounded transition-colors">Value</button>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar rounded-b-2xl">
          @for (item of sortedInventory(); track item.id) {
            <button (click)="equip(item)" 
                    (mouseenter)="hoveredItem.set(item)"
                    (mouseleave)="hoveredItem.set(null)"
                    class="w-full text-left p-3 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer relative group">
              <div class="flex justify-between items-start">
                <span class="text-sm font-medium" [style.color]="getRarityColor(item.rarity)">{{ item.name }} <span class="text-[10px] text-white/50">(Lv. {{ item.level }})</span></span>
                <span class="text-[10px] font-mono text-white/20">{{ item.slot.replace('_', ' ') }}</span>
              </div>
              <div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                @if (item.stats.attack) { <span class="text-[10px] font-mono text-emerald-400">ATK: {{ item.stats.attack }}</span> }
                @if (item.stats.defense) { <span class="text-[10px] font-mono text-blue-400">DEF: {{ item.stats.defense }}</span> }
                @if (item.stats.speed) { <span class="text-[10px] font-mono text-amber-400">SPD: {{ item.stats.speed }}</span> }
                @if (item.stats.intelligence) { <span class="text-[10px] font-mono text-purple-400">INT: {{ item.stats.intelligence }}</span> }
                @if (item.stats.strength) { <span class="text-[10px] font-mono text-red-400">STR: {{ item.stats.strength }}</span> }
                @if (item.stats.dexterity) { <span class="text-[10px] font-mono text-green-400">DEX: {{ item.stats.dexterity }}</span> }
                @if (item.stats.vitality) { <span class="text-[10px] font-mono text-orange-400">VIT: {{ item.stats.vitality }}</span> }
                @if (item.stats.critChance) { <span class="text-[10px] font-mono text-pink-400">CRIT: {{ item.stats.critChance }}%</span> }
                @if (item.stats.critDamage) { <span class="text-[10px] font-mono text-pink-400">CRIT DMG: {{ item.stats.critDamage }}%</span> }
                @if (item.stats.attackSpeed) { <span class="text-[10px] font-mono text-yellow-400">ATK SPD: {{ item.stats.attackSpeed }}%</span> }
                @if (item.stats.manaRegeneration) { <span class="text-[10px] font-mono text-blue-400">MP REG: {{ item.stats.manaRegeneration }}</span> }
                @if (item.stats.blockChance) { <span class="text-[10px] font-mono text-blue-500">BLOCK: {{ item.stats.blockChance }}%</span> }
                @if (item.stats.evasion) { <span class="text-[10px] font-mono text-cyan-500">EVA: {{ item.stats.evasion }}%</span> }
              </div>
            </button>
          } @empty {
            <div class="p-8 text-center">
              <p class="text-[10px] font-mono text-white/20 uppercase">No items found</p>
            </div>
          }
        </div>
      </div>

      <!-- Inventory Comparison Tooltip (Rendered outside to avoid clipping) -->
      @if (hoveredItem(); as item) {
        @let compareItem = getCompareItem(item);
        <div class="absolute top-4 right-[280px] z-50 flex gap-2 pointer-events-none animate-in fade-in duration-200">
          <!-- Hovered Item Stats -->
          <div class="w-64 bg-black/95 border border-white/10 p-3 rounded-xl shadow-2xl">
            <div class="text-[9px] text-white/40 uppercase tracking-wider mb-1 border-b border-white/10 pb-1">Hovered Item</div>
            <div class="text-xs font-bold mb-1" [style.color]="getRarityColor(item.rarity)">{{ item.name }} <span class="text-[9px] text-white/50">(Lv. {{ item.level }})</span></div>
            @if (item.setId) {
              @let setDef = getItemSet(item.setId);
              @if (setDef) {
                <div class="text-[10px] text-green-400 font-bold mb-1">{{ setDef.name }} Set ({{ getEquippedSetPiecesCount(item.setId) }} equipped)</div>
              }
            }
            <div class="text-[10px] text-white/40 font-mono space-y-0.5 mb-2">
              @for (stat of allStats; track stat.key) {
                @if (item.stats[stat.key] || (compareItem && compareItem.stats[stat.key])) {
                  <div class="flex justify-between items-center" [class]="stat.colorClass">
                    <span>{{ stat.label }}: +{{ item.stats[stat.key] || 0 }}{{ stat.isPercent ? '%' : '' }}</span>
                    @if (compareItem) {
                      @let diff = (item.stats[stat.key] || 0) - (compareItem.stats[stat.key] || 0);
                      @if (diff > 0) {
                        <span class="text-green-500 text-[9px]">▲ {{ diff }}{{ stat.isPercent ? '%' : '' }}</span>
                      } @else if (diff < 0) {
                        <span class="text-red-500 text-[9px]">▼ {{ diff * -1 }}{{ stat.isPercent ? '%' : '' }}</span>
                      }
                    }
                  </div>
                }
              }
            </div>

            @if (item.setId) {
              @let setDef = getItemSet(item.setId);
              @if (setDef) {
                <div class="text-[10px] mt-2 border-t border-white/10 pt-2 space-y-1">
                  @for (bonus of setDef.bonuses; track bonus.piecesRequired) {
                    @let isActive = getEquippedSetPiecesCount(item.setId) >= bonus.piecesRequired;
                    <div [class.text-green-400]="isActive" [class.text-white]="!isActive" [class.opacity-50]="!isActive">
                      <span class="font-bold">({{ bonus.piecesRequired }} Pieces):</span>
                      @for (stat of allStats; track stat.key) {
                        @if (bonus.stats[stat.key]) {
                          <span class="ml-1">{{ stat.label }} +{{ bonus.stats[stat.key] }}{{ stat.isPercent ? '%' : '' }}</span>
                        }
                      }
                    </div>
                  }
                </div>
              }
            }
          </div>

          <!-- Equipped Item Stats -->
          @if (compareItem) {
            <div class="w-48 bg-black/95 border border-white/10 p-3 rounded-xl shadow-2xl opacity-80">
              <div class="text-[9px] text-white/40 uppercase tracking-wider mb-1 border-b border-white/10 pb-1">Currently Equipped</div>
              <div class="text-xs font-bold mb-1" [style.color]="getRarityColor(compareItem.rarity)">{{ compareItem.name }}</div>
              <div class="text-[10px] text-white/40 font-mono space-y-0.5">
                @for (stat of allStats; track stat.key) {
                  @if (compareItem.stats[stat.key]) {
                    <div [class]="stat.colorClass">{{ stat.label }}: +{{ compareItem.stats[stat.key] }}{{ stat.isPercent ? '%' : '' }}</div>
                  }
                }
              </div>
            </div>
          }
        </div>
      }
      }
      
      <!-- Gambler Overlay -->
      @if (showGambler() && isNearGambler()) {
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[400px] bg-black/80 backdrop-blur-xl border border-purple-500/30 rounded-2xl flex flex-col max-h-[80vh] shadow-2xl">
        <div class="p-4 border-b border-purple-500/30 bg-purple-500/10 flex justify-between items-center rounded-t-2xl">
          <span class="text-sm font-display font-bold text-purple-400 uppercase tracking-widest">The Gambler</span>
          <button (click)="showGambler.set(false)" class="text-white/40 hover:text-white"><mat-icon>close</mat-icon></button>
        </div>
        <div class="p-4 overflow-y-auto custom-scrollbar">
          <p class="text-xs text-white/60 mb-4 font-mono">Test your luck. Buy unidentified items. They could be legendary... or trash.</p>
          <div class="grid grid-cols-2 gap-2">
            @for (slot of gamblerSlots; track slot) {
              <button (click)="gambleItem(slot)" [disabled]="gold() < gambleCost()" class="flex flex-col items-center justify-center p-3 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                <span class="text-sm font-bold text-purple-300 mb-1 capitalize">{{ slot.replace('_', ' ') }}</span>
                <div class="flex items-center gap-1 text-xs font-mono text-yellow-400">
                  <span>{{ gambleCost() }}</span>
                  <mat-icon class="text-[14px] w-[14px] h-[14px]">monetization_on</mat-icon>
                </div>
              </button>
            }
          </div>
        </div>
      </div>
      }

      <!-- Chest Overlay -->
      @if (showChest() && isNearChest()) {
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[600px] bg-black/80 backdrop-blur-xl border border-amber-500/30 rounded-2xl flex flex-col max-h-[80vh] shadow-2xl">
        <div class="p-4 border-b border-amber-500/30 bg-amber-500/10 flex justify-between items-center rounded-t-2xl">
          <span class="text-sm font-display font-bold text-amber-400 uppercase tracking-widest">Stash</span>
          <button (click)="showChest.set(false)" class="text-white/40 hover:text-white"><mat-icon>close</mat-icon></button>
        </div>
        <div class="flex flex-1 overflow-hidden">
          <!-- Chest Section -->
          <div class="flex-1 border-r border-white/10 p-4 overflow-y-auto custom-scrollbar">
            <h3 class="text-xs font-mono text-white/40 mb-3 uppercase">Chest Contents</h3>
            <div class="space-y-2">
              @for (item of chest(); track item.id) {
                <div class="flex justify-between items-center p-2 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10">
                  <div class="truncate mr-2">
                    <div class="text-sm font-bold truncate" [style.color]="getRarityColor(item.rarity)">{{ item.name }} <span class="text-[10px] text-white/50">(Lv. {{ item.level }})</span></div>
                    <div class="text-[10px] text-white/40 font-mono">{{ item.slot.replace('_', ' ') }}</div>
                  </div>
                  <button (click)="moveToInventory(item)" class="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/40 px-2 py-1 rounded text-xs font-mono text-amber-300 border border-amber-500/30 transition-colors shrink-0">
                    <mat-icon class="text-[14px] w-[14px] h-[14px]">arrow_forward</mat-icon>
                  </button>
                </div>
              } @empty {
                <div class="text-center text-white/20 text-xs font-mono mt-10">Chest is empty</div>
              }
            </div>
          </div>
          <!-- Inventory Section -->
          <div class="flex-1 p-4 overflow-y-auto custom-scrollbar flex flex-col">
            <h3 class="text-xs font-mono text-white/40 mb-3 uppercase">Your Inventory</h3>
            <div class="space-y-2 flex-1">
              @for (item of sortedInventory(); track item.id) {
                <div class="flex justify-between items-center p-2 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10">
                  <button (click)="moveToChest(item)" class="flex items-center gap-1 bg-amber-500/20 hover:bg-amber-500/40 px-2 py-1 rounded text-xs font-mono text-amber-300 border border-amber-500/30 transition-colors shrink-0 mr-2">
                    <mat-icon class="text-[14px] w-[14px] h-[14px]">arrow_back</mat-icon>
                  </button>
                  <div class="truncate text-right">
                    <div class="text-sm font-bold truncate" [style.color]="getRarityColor(item.rarity)">{{ item.name }} <span class="text-[10px] text-white/50">(Lv. {{ item.level }})</span></div>
                    <div class="text-[10px] text-white/40 font-mono">{{ item.slot.replace('_', ' ') }}</div>
                  </div>
                </div>
              } @empty {
                <div class="text-center text-white/20 text-xs font-mono mt-10">Inventory Empty</div>
              }
            </div>
          </div>
        </div>
      </div>
      }

      <!-- Crafting Overlay -->
      @if (showCrafting() && isNearCraftingBench()) {
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[700px] bg-black/80 backdrop-blur-xl border border-purple-500/30 rounded-2xl flex flex-col max-h-[80vh] shadow-2xl">
        <div class="p-4 border-b border-purple-500/30 bg-purple-500/10 flex justify-between items-center rounded-t-2xl">
          <span class="text-sm font-display font-bold text-purple-400 uppercase tracking-widest">Crafting Bench</span>
          <button (click)="showCrafting.set(false)" class="text-white/40 hover:text-white"><mat-icon>close</mat-icon></button>
        </div>
        
        <!-- Materials Header -->
        <div class="flex justify-around p-3 bg-black/40 border-b border-white/10">
          <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-gray-400"></span><span class="text-xs font-mono text-white/80">{{ materials()[CraftingMaterial.DUST] }} Dust</span></div>
          <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-blue-400"></span><span class="text-xs font-mono text-white/80">{{ materials()[CraftingMaterial.SHARD] }} Shards</span></div>
          <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-purple-400"></span><span class="text-xs font-mono text-white/80">{{ materials()[CraftingMaterial.ESSENCE] }} Essence</span></div>
          <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-orange-400"></span><span class="text-xs font-mono text-white/80">{{ materials()[CraftingMaterial.RUNE] }} Runes</span></div>
        </div>

        <div class="flex flex-1 overflow-hidden">
          <!-- Inventory List (Left) -->
          <div class="w-1/2 border-r border-white/10 p-4 overflow-y-auto custom-scrollbar">
            <h3 class="text-xs font-mono text-white/40 mb-3 uppercase flex justify-between">
              <span>Select Item</span>
              <button (click)="salvageMode.update(v => !v)" [class.text-red-400]="salvageMode()" class="hover:text-white transition-colors">
                {{ salvageMode() ? 'SALVAGE MODE ON' : 'Salvage Mode' }}
              </button>
            </h3>
            
            @if (salvageMode()) {
              <div class="flex gap-1 mb-3">
                <button (click)="bulkSalvage('common')" class="flex-1 text-[9px] font-mono bg-white/10 hover:bg-white/20 py-1.5 rounded text-white/80 transition-colors">All Common</button>
                <button (click)="bulkSalvage('uncommon')" class="flex-1 text-[9px] font-mono bg-green-500/20 hover:bg-green-500/40 py-1.5 rounded text-green-400 transition-colors">All Uncom</button>
                <button (click)="bulkSalvage('rare')" class="flex-1 text-[9px] font-mono bg-blue-500/20 hover:bg-blue-500/40 py-1.5 rounded text-blue-400 transition-colors">All Rare</button>
              </div>
            }

            <div class="space-y-2">
              @for (item of sortedInventory(); track item.id) {
                <button (click)="salvageMode() ? salvageItem(item) : selectedCraftingItem.set(item)" 
                        [class.border-purple-500]="selectedCraftingItem()?.id === item.id && !salvageMode()"
                        [class.border-red-500]="salvageMode()"
                        class="w-full text-left p-2 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 transition-colors">
                  <div class="flex justify-between items-start">
                    <span class="text-sm font-bold truncate" [style.color]="getRarityColor(item.rarity)">{{ item.name }} <span class="text-[10px] text-white/50">(Lv. {{ item.level }})</span></span>
                    <div class="flex items-center gap-1">
                      @if (item.imprinted) { <span class="text-[9px] text-orange-400 font-bold">IMPRINTED</span> }
                      @if (item.corrupted) { <span class="text-[9px] text-red-500 font-bold">CORRUPTED</span> }
                    </div>
                  </div>
                  <div class="flex justify-between items-center mt-1">
                    <div class="text-[10px] text-white/40 font-mono">{{ item.slot.replace('_', ' ') }}</div>
                    @if (item.sockets) {
                      <div class="flex gap-0.5">
                        @for (s of [].constructor(item.sockets); track $index) {
                          <div class="w-2 h-2 rounded-full bg-black border border-white/30"></div>
                        }
                      </div>
                    }
                  </div>
                </button>
              } @empty {
                <div class="text-center text-white/20 text-xs font-mono mt-10">Inventory Empty</div>
              }
            </div>
          </div>

          <!-- Crafting Actions (Right) -->
          <div class="w-1/2 p-4 overflow-y-auto custom-scrollbar flex flex-col">
            @if (selectedCraftingItem(); as item) {
              <div class="mb-6 p-4 bg-black/40 rounded-xl border border-white/10">
                <div class="text-lg font-bold text-center mb-2" [style.color]="getRarityColor(item.rarity)">{{ item.name }} <span class="text-xs text-white/50">(Lv. {{ item.level }})</span></div>
                <div class="flex flex-wrap gap-2 justify-center">
                  @for (stat of allStats; track stat.key) {
                    @if (item.stats[stat.key]) {
                      <span [class]="stat.colorClass + ' text-xs font-mono bg-white/5 px-2 py-1 rounded'">{{ stat.label }}: +{{ item.stats[stat.key] }}{{ stat.isPercent ? '%' : '' }}</span>
                    }
                  }
                </div>
              </div>

              <div class="space-y-3">
                <button (click)="craftReroll(item)" [disabled]="materials()[CraftingMaterial.DUST] < 5 || item.corrupted" class="w-full p-3 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 rounded-xl text-left transition-colors">
                  <div class="text-sm font-bold text-white/80">Reroll All Stats</div>
                  <div class="text-xs text-white/40">Randomizes all stats.</div>
                  <div class="text-xs font-mono text-gray-400 mt-1">Cost: 5 Dust</div>
                </button>

                <button (click)="craftUpgrade(item)" [disabled]="materials()[CraftingMaterial.SHARD] < 3 || item.corrupted || item.rarity === 'legendary'" class="w-full p-3 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 rounded-xl text-left transition-colors">
                  <div class="text-sm font-bold text-white/80">Upgrade Rarity</div>
                  <div class="text-xs text-white/40">Promotes item to next rarity tier. Rerolls stats.</div>
                  <div class="text-xs font-mono text-blue-400 mt-1">Cost: 3 Shards</div>
                </button>

                <button (click)="craftAddSocket(item)" [disabled]="materials()[CraftingMaterial.ESSENCE] < 1 || item.corrupted || (item.sockets || 0) >= 3" class="w-full p-3 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 rounded-xl text-left transition-colors">
                  <div class="text-sm font-bold text-white/80">Add Socket</div>
                  <div class="text-xs text-white/40">Carves one socket into the item (Max 3).</div>
                  <div class="text-xs font-mono text-purple-400 mt-1">Cost: 1 Essence</div>
                </button>

                <button (click)="craftImprint(item)" [disabled]="materials()[CraftingMaterial.RUNE] < 1 || item.corrupted || item.imprinted" class="w-full p-3 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10 rounded-xl text-left transition-colors">
                  <div class="text-sm font-bold text-white/80">Imprint Stat</div>
                  <div class="text-xs text-white/40">Forces a powerful guaranteed stat onto the item.</div>
                  <div class="text-xs font-mono text-orange-400 mt-1">Cost: 1 Rune</div>
                </button>
              </div>
            } @else {
              <div class="flex-1 flex items-center justify-center text-white/20 text-xs font-mono">
                Select an item to craft
              </div>
            }
          </div>
        </div>
      </div>
      }

      <!-- Vendor Overlay -->
      @if (showVendor() && isNearVendor()) {
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[600px] bg-black/80 backdrop-blur-xl border border-blue-500/30 rounded-2xl flex flex-col max-h-[80vh] shadow-2xl">
        <div class="p-4 border-b border-blue-500/30 bg-blue-500/10 flex justify-between items-center rounded-t-2xl">
          <span class="text-sm font-display font-bold text-blue-400 uppercase tracking-widest">Wandering Merchant (Lv. {{ vendorLevel() }})</span>
          <div class="flex items-center gap-4">
            <button (click)="upgradeVendor()" [disabled]="gold() < vendorUpgradeCost()" class="flex items-center gap-1 bg-blue-500/20 hover:bg-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded text-xs font-mono text-blue-300 border border-blue-500/30 transition-colors">
              <span>Upgrade ({{ vendorUpgradeCost() }}</span>
              <mat-icon class="text-[14px] w-[14px] h-[14px]">monetization_on</mat-icon>
              <span>)</span>
            </button>
            <button (click)="showVendor.set(false)" class="text-white/40 hover:text-white"><mat-icon>close</mat-icon></button>
          </div>
        </div>
        <div class="flex flex-1 overflow-hidden">
          <!-- Buy Section -->
          <div class="flex-1 border-r border-white/10 p-4 overflow-y-auto custom-scrollbar">
            <h3 class="text-xs font-mono text-white/40 mb-3 uppercase">Buy Items</h3>
            <div class="space-y-2">
              @for (item of vendorItems(); track item.id) {
                <div class="flex justify-between items-center p-2 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10">
                  <div>
                    <div class="text-sm font-bold" [style.color]="getRarityColor(item.rarity)">{{ item.name }} <span class="text-[10px] text-white/50">(Lv. {{ item.level }})</span></div>
                    <div class="text-[10px] text-white/40 font-mono">{{ item.slot.replace('_', ' ') }}</div>
                  </div>
                  <button (click)="buyItem(item)" [disabled]="gold() < (item.goldValue || 10) * 2" class="flex items-center gap-1 bg-blue-500/20 hover:bg-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed px-2 py-1 rounded text-xs font-mono text-blue-300 border border-blue-500/30 transition-colors">
                    <span>{{ (item.goldValue || 10) * 2 }}</span>
                    <mat-icon class="text-[14px] w-[14px] h-[14px]">monetization_on</mat-icon>
                  </button>
                </div>
              }
            </div>
          </div>
          <!-- Sell Section -->
          <div class="flex-1 p-4 overflow-y-auto custom-scrollbar flex flex-col">
            <div class="flex justify-between items-center mb-3">
              <h3 class="text-xs font-mono text-white/40 uppercase">Sell Items</h3>
              <button (click)="sellAll()" class="text-[10px] font-mono bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-1 rounded hover:bg-red-500/40 transition-colors">SELL ALL</button>
            </div>
            <div class="space-y-2 flex-1">
              @for (item of inventory(); track item.id) {
                <div class="flex justify-between items-center p-2 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10">
                  <div class="truncate mr-2">
                    <div class="text-sm font-bold truncate" [style.color]="getRarityColor(item.rarity)">{{ item.name }} <span class="text-[10px] text-white/50">(Lv. {{ item.level }})</span></div>
                  </div>
                  <button (click)="sellItem(item)" class="flex items-center gap-1 bg-yellow-500/20 hover:bg-yellow-500/40 px-2 py-1 rounded text-xs font-mono text-yellow-300 border border-yellow-500/30 transition-colors shrink-0">
                    <span>{{ item.goldValue || 10 }}</span>
                    <mat-icon class="text-[14px] w-[14px] h-[14px]">monetization_on</mat-icon>
                  </button>
                </div>
              } @empty {
                <div class="text-center text-white/20 text-xs font-mono mt-10">Inventory Empty</div>
              }
            </div>
          </div>
        </div>
      </div>
      }

      <!-- Passive Tree Overlay -->
      @if (showSkillTree()) {
      <div class="absolute inset-4 z-30 bg-black/95 backdrop-blur-xl border border-red-500/30 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
        <div class="p-4 border-b border-red-500/30 bg-red-500/10 flex justify-between items-center">
          <div class="flex items-center gap-4">
            <span class="text-sm font-display font-bold text-red-400 uppercase tracking-widest">Passive Skill Tree</span>
            <div class="text-xs font-mono text-white/60">Level: <span class="text-white">{{ stats().level }}</span></div>
            <div class="text-xs font-mono text-red-400">Unspent Points: <span class="font-bold text-white">{{ stats().skillPoints }}</span></div>
          </div>
          <button (click)="showSkillTree.set(false)" class="text-white/40 hover:text-white"><mat-icon>close</mat-icon></button>
        </div>
        
        <div class="flex-1 relative overflow-auto custom-scrollbar bg-[#0a0a0f]" #treeContainer>
          <!-- SVG Lines for connections -->
          <svg class="absolute inset-0 pointer-events-none" style="min-width: 1000px; min-height: 800px;">
            <g transform="translate(500, 400)">
              @for (node of passiveNodes; track node.id) {
                @for (connId of node.connections; track connId) {
                  @if (getPassiveNode(connId); as connNode) {
                    <line 
                      [attr.x1]="node.x * 4" 
                      [attr.y1]="node.y * 4" 
                      [attr.x2]="connNode.x * 4" 
                      [attr.y2]="connNode.y * 4" 
                      [attr.stroke]="isConnectionActive(node.id, connId) ? '#f87171' : '#333'" 
                      [attr.stroke-width]="isConnectionActive(node.id, connId) ? 3 : 1" 
                    />
                  }
                }
              }
            </g>
          </svg>

          <!-- HTML Nodes -->
          <div class="absolute inset-0" style="min-width: 1000px; min-height: 800px;">
            <div style="transform: translate(500px, 400px);">
              @for (node of passiveNodes; track node.id) {
                <button 
                  (click)="allocatePassive(node.id)"
                  (contextmenu)="refundPassive($event, node.id)"
                  (mouseenter)="hoveredPassive.set(node)"
                  (mouseleave)="hoveredPassive.set(null)"
                  class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-all duration-200"
                  [style.left.px]="node.x * 4"
                  [style.top.px]="node.y * 4"
                  [class]="getNodeClass(node)"
                  [style.width.px]="node.isKeystone ? 40 : (node.isNotable ? 30 : 20)"
                  [style.height.px]="node.isKeystone ? 40 : (node.isNotable ? 30 : 20)"
                >
                  @if (node.isKeystone) {
                    <div class="w-full h-full border-4 border-current rounded-full rotate-45"></div>
                  } @else if (node.isNotable) {
                    <div class="w-full h-full border-2 border-current rounded-full"></div>
                  }
                </button>
              }
            </div>
          </div>
          
          <!-- Tooltip -->
          @if (hoveredPassive(); as node) {
            <div class="fixed z-50 bg-black/95 border border-white/20 p-4 rounded-xl shadow-2xl pointer-events-none w-64"
                 [style.left.px]="mouseX() + 20"
                 [style.top.px]="mouseY() + 20">
              <div class="text-sm font-bold mb-1" [class.text-amber-400]="node.isKeystone" [class.text-purple-400]="node.isNotable" [class.text-white]="!node.isKeystone && !node.isNotable">
                {{ node.name }}
              </div>
              <div class="text-xs text-white/60 mb-2">{{ node.description }}</div>
              
              @if ((stats().allocatedPassives || []).includes(node.id)) {
                <div class="text-[10px] text-emerald-400 font-mono mt-2">Allocated (Right-click to refund)</div>
              } @else if (canAllocate(node.id)) {
                <div class="text-[10px] text-blue-400 font-mono mt-2">Click to allocate</div>
              } @else {
                <div class="text-[10px] text-red-400 font-mono mt-2">Unreachable</div>
              }
            </div>
          }
        </div>
      </div>
      }

      <!-- Action Bar (Globes + Skills) -->
      <div class="absolute bottom-0 left-1/2 -translate-x-1/2 z-10 flex items-end">
        
        <!-- Health Globe -->
        <div class="relative w-32 h-32 rounded-full bg-black/90 border-4 border-gray-800 overflow-hidden shadow-[0_0_30px_rgba(220,38,38,0.3)] z-20" style="margin-right: -24px; margin-bottom: 8px;">
          <div class="absolute bottom-0 w-full bg-gradient-to-t from-red-800 to-red-500 transition-all duration-300" 
               [style.height.%]="(playerHealth() / stats().maxHealth) * 100">
          </div>
          <!-- Glass reflection -->
          <div class="absolute inset-0 rounded-full shadow-[inset_0_8px_15px_rgba(255,255,255,0.2)]"></div>
          <div class="absolute inset-x-0 top-2 h-1/4 bg-gradient-to-b from-white/20 to-transparent rounded-t-full"></div>
          <div class="absolute inset-0 flex items-center justify-center text-white/90 font-mono text-sm font-bold drop-shadow-md">
            {{ playerHealth() | number:'1.0-0' }} / {{ stats().maxHealth | number:'1.0-0' }}
          </div>
        </div>

        <!-- Center Unified Bar -->
        <div class="bg-black/80 backdrop-blur-lg border-t border-x border-white/10 px-10 py-4 rounded-t-3xl flex flex-col gap-3 items-center z-10 shadow-2xl pb-6">
          
          <!-- Potions Row -->
          <div class="flex gap-2 items-center">
            @for (idx of [0, 1, 2, 3]; track idx) {
              <div class="relative group">
                <div class="w-10 h-10 rounded-lg bg-gray-900/80 border border-gray-700 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-800 transition-all relative overflow-hidden shadow-inner" (click)="usePotion(idx)" (contextmenu)="unequipPotion(idx); $event.preventDefault()">
                  @if (potions()[idx]) {
                    <div class="text-[8px] text-white/50 absolute top-0.5 right-1">{{ idx + 1 }}</div>
                    @if (potions()[idx]!.consumableType === 'health_potion') { <div class="w-5 h-5 rounded-full bg-gradient-to-br from-red-400 to-red-600 shadow-[0_0_10px_rgba(239,68,68,0.8)]"></div> }
                    @if (potions()[idx]!.consumableType === 'mana_potion') { <div class="w-5 h-5 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 shadow-[0_0_10px_rgba(59,130,246,0.8)]"></div> }
                    @if (potions()[idx]!.consumableType === 'block_potion') { <div class="w-5 h-5 rounded-sm rotate-45 bg-gradient-to-br from-indigo-400 to-indigo-600 shadow-[0_0_10px_rgba(99,102,241,0.8)]"></div> }
                    @if (potions()[idx]!.consumableType === 'evade_potion') { <div class="w-5 h-5 rounded-full border-2 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]"></div> }
                  } @else {
                    <span class="text-white/20 font-mono text-[10px]">{{ idx + 1 }}</span>
                  }
                </div>
                @if (potions()[idx]) {
                  <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-black/90 text-xs text-white/80 px-2 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap uppercase border border-white/10 z-50">
                    {{ potions()[idx]!.name }} (Right click to unequip)
                  </div>
                }
              </div>
            }
          </div>

          <!-- Skills Row -->
          <div class="flex gap-3 items-center">
            @for (key of ['Q', 'W', 'E', 'R']; track key; let i = $index) {
              <div class="relative group">
                <div class="w-14 h-14 rounded-full bg-gray-900/80 border border-gray-600 flex items-center justify-center font-mono text-sm transition-all cursor-pointer shadow-[0_0_15px_rgba(0,0,0,0.5)] overflow-hidden relative"
                     [class.border-cyan-500]="activeSkills()[i + 1]" [class.text-cyan-400]="activeSkills()[i + 1]" [class.text-white]="!activeSkills()[i + 1]">
                  <span class="relative z-10">{{ key }}</span>
                  @if (activeSkills()[i + 1]) {
                    <!-- Cooldown Sweep -->
                    @if (skillCooldownsProgress()[i + 1] < 1) {
                      <div class="absolute inset-0 bg-black/70 z-0" [style.height.%]="(1 - skillCooldownsProgress()[i + 1]) * 100"></div>
                    }
                  }
                </div>
                @if (activeSkills()[i + 1]) {
                  @let sId = activeSkills()[i + 1]!;
                  <div class="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-black/95 text-xs text-white/80 p-2 rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap border border-white/10 z-50 shadow-2xl flex flex-col gap-1 items-center min-w-[120px]">
                    <span class="font-bold text-cyan-400 uppercase tracking-widest">{{ getSkillName(sId) }}</span>
                    @let sStats = getSkillTooltipStats(sId);
                    @if (sStats) {
                      <div class="text-[9px] font-mono text-white/60 w-full">
                        <div class="flex justify-between w-full"><span>DMG:</span> <span class="text-white">{{ sStats.damage | number:'1.0-0' }}</span></div>
                        <div class="flex justify-between w-full"><span>CD:</span> <span>{{ sStats.cooldown | number:'1.1-2' }}s</span></div>
                        @if (sStats.manaCost > 0) {
                          <div class="flex justify-between w-full"><span>MP:</span> <span class="text-blue-400">{{ sStats.manaCost }}</span></div>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <div class="w-px h-10 bg-white/10 mx-2"></div>

            <div class="relative group">
              <div class="w-16 h-16 rounded-full bg-emerald-900/40 border-2 border-emerald-500/60 flex items-center justify-center text-emerald-400 font-mono text-xs hover:bg-emerald-800/50 transition-all cursor-pointer shadow-[0_0_20px_rgba(16,185,129,0.3)] overflow-hidden relative">
                <span class="relative z-10 font-bold">SPACE</span>
                <!-- Cooldown Sweep -->
                @if (skillCooldownsProgress()[0] < 1) {
                  <div class="absolute inset-0 bg-black/60 z-0" [style.height.%]="(1 - skillCooldownsProgress()[0]) * 100"></div>
                }
              </div>
              @if (activeSkills()[0]) {
                @let spaceId = activeSkills()[0]!;
                <div class="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-black/95 text-xs text-white/80 p-2 rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap border border-white/10 z-50 shadow-2xl flex flex-col gap-1 items-center min-w-[120px]">
                  <span class="font-bold text-emerald-400 uppercase tracking-widest">{{ getSkillName(spaceId) }}</span>
                  @let sStats = getSkillTooltipStats(spaceId);
                  @if (sStats) {
                    <div class="text-[9px] font-mono text-white/60 w-full">
                      <div class="flex justify-between w-full"><span>DMG:</span> <span class="text-white">{{ sStats.damage | number:'1.0-0' }}</span></div>
                      <div class="flex justify-between w-full"><span>CD:</span> <span>{{ sStats.cooldown | number:'1.1-2' }}s</span></div>
                      @if (sStats.manaCost > 0) {
                        <div class="flex justify-between w-full"><span>MP:</span> <span class="text-blue-400">{{ sStats.manaCost }}</span></div>
                      }
                    </div>
                  }
                </div>
              } @else {
                <div class="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-black/90 text-xs text-white/80 px-3 py-1 rounded opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap uppercase border border-white/10 z-50">Empty</div>
              }
            </div>
          </div>
        </div>

        <!-- Mana Globe -->
        <div class="relative w-32 h-32 rounded-full bg-black/90 border-4 border-gray-800 overflow-hidden shadow-[0_0_30px_rgba(59,130,246,0.3)] z-20" style="margin-left: -24px; margin-bottom: 8px;">
          <div class="absolute bottom-0 w-full bg-gradient-to-t from-blue-800 to-blue-500 transition-all duration-300" 
               [style.height.%]="(playerMana() / (stats().intelligence * 10)) * 100">
          </div>
          <div class="absolute inset-x-0 top-2 h-1/4 bg-gradient-to-b from-white/20 to-transparent rounded-t-full z-10"></div>
          <div class="absolute inset-0 rounded-full shadow-[inset_0_8px_15px_rgba(255,255,255,0.2)]"></div>
          <div class="absolute inset-0 flex items-center justify-center text-white/90 font-mono text-sm font-bold drop-shadow-md z-20">
            {{ playerMana() | number:'1.0-0' }} / {{ stats().intelligence * 10 | number:'1.0-0' }}
          </div>
        </div>
      </div>

      <!-- Controls Info & Toggles -->
      <div class="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-4 pointer-events-auto">
        <div class="text-right pointer-events-none">
          <div class="text-[10px] font-mono text-white/20 uppercase tracking-widest">Q, W, E, R to Cast Spell</div>
          <div class="text-[10px] font-mono text-white/20 uppercase tracking-widest">1, 2, 3, 4 to Use Potion</div>
          <div class="text-[10px] font-mono text-white/20 uppercase tracking-widest">Space to Attack</div>
          <div class="text-[10px] font-mono text-white/20 uppercase tracking-widest">Click to Move</div>
          <div class="text-[10px] font-mono text-white/20 uppercase tracking-widest mt-2">ESC to Menu</div>
        </div>
        <div class="flex gap-2">
          @if (isNearChest()) {
            <button (click)="showChest.update(v => !v)" class="w-12 h-12 bg-amber-500/20 backdrop-blur-md border border-amber-500/40 rounded-xl flex items-center justify-center hover:bg-amber-500/40 transition-colors relative" [class.bg-amber-500]="showChest()" [class.bg-opacity-40]="showChest()">
              <mat-icon class="text-amber-400">inventory</mat-icon>
              <span class="absolute -top-2 -right-2 bg-black border border-amber-500/40 text-[9px] px-1.5 py-0.5 rounded text-amber-400 font-mono">B</span>
            </button>
          }
          @if (isNearCraftingBench()) {
            <button (click)="showCrafting.update(v => !v)" class="w-12 h-12 bg-purple-500/20 backdrop-blur-md border border-purple-500/40 rounded-xl flex items-center justify-center hover:bg-purple-500/40 transition-colors relative" [class.bg-purple-500]="showCrafting()" [class.bg-opacity-40]="showCrafting()">
              <mat-icon class="text-purple-400">construction</mat-icon>
              <span class="absolute -top-2 -right-2 bg-black border border-purple-500/40 text-[9px] px-1.5 py-0.5 rounded text-purple-400 font-mono">O</span>
            </button>
          }
          @if (isNearVendor()) {
            <button (click)="showVendor.update(v => !v)" class="w-12 h-12 bg-blue-500/20 backdrop-blur-md border border-blue-500/40 rounded-xl flex items-center justify-center hover:bg-blue-500/40 transition-colors relative" [class.bg-blue-500]="showVendor()" [class.bg-opacity-40]="showVendor()">
              <mat-icon class="text-blue-400">storefront</mat-icon>
              <span class="absolute -top-2 -right-2 bg-black border border-blue-500/40 text-[9px] px-1.5 py-0.5 rounded text-blue-400 font-mono">V</span>
            </button>
          }
          @if (isNearGambler()) {
            <button (click)="showGambler.update(v => !v)" class="w-12 h-12 bg-purple-500/20 backdrop-blur-md border border-purple-500/40 rounded-xl flex items-center justify-center hover:bg-purple-500/40 transition-colors relative" [class.bg-purple-500]="showGambler()" [class.bg-opacity-40]="showGambler()">
              <mat-icon class="text-purple-400">casino</mat-icon>
              <span class="absolute -top-2 -right-2 bg-black border border-purple-500/40 text-[9px] px-1.5 py-0.5 rounded text-purple-400 font-mono">G</span>
            </button>
          }
          @if (currentRegion() === 'dungeon') {
            <button (click)="returnToTown()" class="w-12 h-12 bg-cyan-500/20 backdrop-blur-md border border-cyan-500/40 rounded-xl flex items-center justify-center hover:bg-cyan-500/40 transition-colors relative">
              <mat-icon class="text-cyan-400">sensor_door</mat-icon>
              <span class="absolute -top-2 -right-2 bg-black border border-cyan-500/40 text-[9px] px-1.5 py-0.5 rounded text-cyan-400 font-mono">P</span>
            </button>
          }

          <button (click)="showSkillTree.update(v => !v)" class="w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors relative" [class.bg-white]="showSkillTree()" [class.bg-opacity-10]="showSkillTree()">
            <mat-icon class="text-white/80">account_tree</mat-icon>
            <span class="absolute -top-2 -right-2 bg-black border border-white/20 text-[9px] px-1.5 py-0.5 rounded text-white/80 font-mono">T</span>
            @if (stats().skillPoints > 0) {
              <div class="absolute -bottom-1 -left-1 w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
            }
          </button>
          <button (click)="showSkills.update(v => !v)" class="w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors relative" [class.bg-white]="showSkills()" [class.bg-opacity-10]="showSkills()">
            <mat-icon class="text-white/80">auto_awesome</mat-icon>
            <span class="absolute -top-2 -right-2 bg-black border border-white/20 text-[9px] px-1.5 py-0.5 rounded text-white/80 font-mono">K</span>
          </button>
          <button (click)="showCharacter.update(v => !v)" class="w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors relative" [class.bg-white]="showCharacter()" [class.bg-opacity-10]="showCharacter()">
            <mat-icon class="text-white/80">person</mat-icon>
            <span class="absolute -top-2 -right-2 bg-black border border-white/20 text-[9px] px-1.5 py-0.5 rounded text-white/80 font-mono">C</span>
          </button>
          <button (click)="showInventory.update(v => !v)" class="w-12 h-12 bg-black/60 backdrop-blur-md border border-white/10 rounded-xl flex items-center justify-center hover:bg-white/10 transition-colors relative" [class.bg-white]="showInventory()" [class.bg-opacity-10]="showInventory()">
            <mat-icon class="text-white/80">inventory_2</mat-icon>
            <span class="absolute -top-2 -right-2 bg-black border border-white/20 text-[9px] px-1.5 py-0.5 rounded text-white/80 font-mono">I</span>
          </button>
        </div>
      </div>
      } <!-- End playing state -->

      <!-- Skills Overlay -->
      @if (showSkills() && gameState() === 'playing') {
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 w-[900px] bg-black/90 backdrop-blur-xl border border-blue-500/30 rounded-2xl flex flex-col max-h-[85vh] shadow-2xl">
        <div class="p-4 border-b border-blue-500/30 bg-blue-500/10 flex justify-between items-center rounded-t-2xl">
          <span class="text-sm font-display font-bold text-blue-400 uppercase tracking-widest">Abilities & Support Gems (6-Link System)</span>
          <button (click)="showSkills.set(false)" class="text-white/40 hover:text-white"><mat-icon>close</mat-icon></button>
        </div>
        
        <!-- Visual Links Display -->
        <div class="p-6 border-b border-white/10 bg-black/40 flex justify-center">
          <div class="flex flex-col items-center">
            <h4 class="text-[10px] font-mono text-cyan-400 uppercase mb-4 tracking-widest">Active Abilities</h4>
            <div class="flex gap-6">
              @for (key of ['SPACE', 'Q', 'W', 'E', 'R']; track key; let idx = $index) {
                <div class="flex flex-col items-center">
                  <div class="flex flex-col items-center cursor-pointer p-2 rounded-xl transition-all relative group"
                       [class.bg-cyan-500]="selectedSpellSlot() === idx" [class.bg-opacity-20]="selectedSpellSlot() === idx"
                       [class.border]="true" [class.border-cyan-500]="selectedSpellSlot() === idx" [class.border-transparent]="selectedSpellSlot() !== idx"
                       (click)="selectedSpellSlot.set(idx)">
                    <div class="text-[10px] text-white/60 mb-1 font-mono font-bold">{{ key }}</div>
                    <!-- Main Skill Socket -->
                    <div class="w-14 h-14 rounded-full border-2 border-cyan-500 bg-cyan-500/20 flex items-center justify-center shadow-[0_0_15px_rgba(34,211,238,0.3)] relative z-10 transition-transform" [class.scale-110]="selectedSpellSlot() === idx">
                      <span class="text-[10px] font-bold text-white text-center leading-tight">{{ activeSkills()[idx] ? getSkillName(activeSkills()[idx]!) : 'Empty' }}</span>
                    </div>
                    
                    @if (activeSkills()[idx]) {
                      @let sId = activeSkills()[idx]!;
                      <div class="absolute top-1/2 left-full ml-4 -translate-y-1/2 bg-black/95 text-xs text-white/80 p-2 rounded-xl opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap border border-white/10 z-50 shadow-2xl flex flex-col gap-1 items-center min-w-[120px]">
                        <span class="font-bold text-cyan-400 uppercase tracking-widest">{{ getSkillName(sId) }}</span>
                        @let sStats = getSkillTooltipStats(sId);
                        @if (sStats) {
                          <div class="text-[9px] font-mono text-white/60 w-full">
                            <div class="flex justify-between w-full"><span>DMG:</span> <span class="text-white">{{ sStats.damage | number:'1.0-0' }}</span></div>
                            <div class="flex justify-between w-full"><span>CD:</span> <span>{{ sStats.cooldown | number:'1.1-2' }}s</span></div>
                            @if (sStats.manaCost > 0) {
                              <div class="flex justify-between w-full"><span>MP:</span> <span class="text-blue-400">{{ sStats.manaCost }}</span></div>
                            }
                          </div>
                        }
                      </div>
                    }
                  </div>
                  <!-- Links Display -->
                  @if (activeSkills()[idx]) {
                    <div class="flex gap-1 mt-1">
                      @for (i of [0, 1, 2, 3, 4]; track i) {
                        <div class="w-2 h-2 rounded-full border border-white/30"
                             [class.bg-blue-400]="linkedSupports()[activeSkills()[idx]!]?.[i]" [class.border-blue-400]="linkedSupports()[activeSkills()[idx]!]?.[i]"></div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>

        <div class="flex flex-1 overflow-hidden">
          <!-- Active Skills List -->
          <div class="w-1/2 border-r border-white/10 p-4 overflow-y-auto custom-scrollbar">
            <div class="flex justify-between items-baseline mb-3">
              <h3 class="text-xs font-mono text-white/40 uppercase">Select Active Skill</h3>
              <div class="text-[10px] text-cyan-400 font-mono">Selecting for Slot: {{ ['SPACE', 'Q', 'W', 'E', 'R'][selectedSpellSlot()] }}</div>
            </div>
            
            <div class="grid grid-cols-2 gap-2">
              @for (skill of allSkills; track skill.id) {
                <button (click)="assignSpell(skill.id)" 
                        [class.border-cyan-500]="activeSkills()[selectedSpellSlot()] === skill.id"
                        [class.bg-cyan-500/10]="activeSkills()[selectedSpellSlot()] === skill.id"
                        class="text-left p-3 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 transition-colors flex flex-col relative overflow-hidden group">
                  @if (isSpellEquipped(skill.id)) {
                    <div class="absolute top-1 right-1 text-[8px] bg-cyan-500 text-white px-1 rounded font-bold">EQUIPPED</div>
                  }
                  <div class="flex justify-between items-center w-full mb-1">
                    <span class="text-sm font-bold" [style.color]="skill.color">{{ skill.name }}</span>
                    <span class="text-[8px] uppercase px-1 rounded bg-black/40 border border-white/10 text-white/60">{{ skill.category }}</span>
                  </div>
                  <span class="text-[10px] text-white/40 leading-tight block mb-2">{{ skill.description }}</span>
                  
                  @let sStats = getSkillTooltipStats(skill.id);
                  @if (sStats) {
                    <div class="w-full mt-auto bg-black/40 rounded p-1.5 border border-white/5 font-mono text-[9px] text-white/60 space-y-0.5">
                      <div class="flex justify-between items-center text-white/80">
                        <span>Damage: <span [style.color]="skill.color">{{ sStats.damage | number:'1.0-0' }}</span></span>
                        @if (sStats.manaCost > 0) {
                          <span class="text-blue-400">MP: {{ sStats.manaCost }}</span>
                        }
                      </div>
                      <div class="flex justify-between items-center">
                        <span>Cooldown: {{ sStats.cooldown | number:'1.1-2' }}s</span>
                        @if (sStats.scalingSource) {
                          <span class="text-white/40">Scales w/ {{ sStats.scalingSource }}</span>
                        }
                      </div>
                      @if (sStats.aoe > 1 || sStats.projectiles > 1) {
                        <div class="flex justify-between items-center text-[8px] text-white/40">
                          @if (sStats.aoe > 1) { <span>AoE Size: x{{ sStats.aoe | number:'1.1-1' }}</span> }
                          @if (sStats.projectiles > 1) { <span>Projectiles: {{ sStats.projectiles }}</span> }
                        </div>
                      }
                    </div>
                  }
                </button>
              }
              <!-- Unequip button -->
              <button (click)="assignSpell(null)" 
                      [class.border-red-500]="activeSkills()[selectedSpellSlot()] === null"
                      class="col-span-2 text-center p-2 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 transition-colors flex justify-center items-center text-red-400 text-xs font-mono">
                Unequip Slot {{ ['SPACE', 'Q', 'W', 'E', 'R'][selectedSpellSlot()] }}
              </button>
            </div>
          </div>

          <!-- Support Gems List -->
          <div class="w-1/2 p-4 overflow-y-auto custom-scrollbar bg-black/20">
            <h3 class="text-xs font-mono text-white/40 mb-3 uppercase">Link Support Gems</h3>
            <p class="text-[10px] text-white/30 mb-4">Click to toggle link. Applies to the selected active skill slot. Max 5 supports per skill.</p>
            
            @if (!activeSkills()[selectedSpellSlot()]) {
              <div class="text-center text-white/20 text-xs font-mono mt-10">Select an active skill slot to link supports.</div>
            } @else {
              <div class="grid grid-cols-2 gap-3">
                @for (sup of supports; track sup.id) {
                  @if (sup.allowedCategories?.includes(getSkillCategory(activeSkills()[selectedSpellSlot()]!))) {
                    <div class="p-3 bg-white/5 rounded-lg border border-white/5 flex flex-col cursor-pointer transition-colors"
                         [class.border-blue-500]="isLinked(activeSkills()[selectedSpellSlot()]!, sup.id)"
                         [class.bg-blue-500]="isLinked(activeSkills()[selectedSpellSlot()]!, sup.id)"
                         [class.bg-opacity-20]="isLinked(activeSkills()[selectedSpellSlot()]!, sup.id)"
                         [class.hover:bg-white]="!isLinked(activeSkills()[selectedSpellSlot()]!, sup.id)"
                         [class.hover:bg-opacity-10]="!isLinked(activeSkills()[selectedSpellSlot()]!, sup.id)"
                         (click)="toggleSupport(activeSkills()[selectedSpellSlot()]!, sup.id)">
                      <div class="mb-2">
                        <span class="text-sm font-bold flex items-center justify-between" [style.color]="sup.color">
                          {{ sup.name }}
                          @if (isLinked(activeSkills()[selectedSpellSlot()]!, sup.id)) {
                            <mat-icon class="text-[16px] w-[16px] h-[16px] text-blue-400">link</mat-icon>
                          }
                        </span>
                      </div>
                      <p class="text-[10px] text-white/40 flex-1 leading-tight">{{ sup.description }}</p>
                    </div>
                  }
                }
              </div>
            }
          </div>
        </div>
      </div>
      }

      <!-- Main Menu Overlay -->
      @if (gameState() === 'menu') {
        <div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
          <div class="mb-12 text-center">
            <h1 class="text-7xl font-display font-bold text-white tracking-tighter uppercase italic drop-shadow-[0_0_20px_rgba(255,255,255,0.3)]">Project Abyss</h1>
            <p class="text-sm font-mono text-emerald-400 mt-2 tracking-[0.3em]">ARPG PROTOTYPE</p>
          </div>
          
          <div class="flex flex-col gap-4 w-64">
            @if (hasSave()) {
              <button (click)="continueGame()" class="w-full py-3 bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/50 rounded-xl text-emerald-400 font-display font-bold uppercase tracking-widest transition-all hover:scale-105 shadow-[0_0_15px_rgba(16,185,129,0.2)]">
                Continue
              </button>
            }
            <button (click)="newGame()" class="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-display font-bold uppercase tracking-widest transition-all hover:scale-105">
              New Game
            </button>
            <button (click)="loadGame()" class="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-display font-bold uppercase tracking-widest transition-all hover:scale-105">
              Load Game
            </button>
            <button (click)="openSettings()" class="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-display font-bold uppercase tracking-widest transition-all hover:scale-105">
              Settings
            </button>
          </div>
        </div>
      }

      <!-- Settings Overlay -->
      @if (gameState() === 'settings') {
        <div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md">
          <div class="w-[500px] bg-white/5 border border-white/10 rounded-2xl p-8 flex flex-col shadow-2xl">
            <h2 class="text-2xl font-display font-bold text-white uppercase tracking-widest mb-6 text-center border-b border-white/10 pb-4">Settings</h2>
            
            <div class="space-y-6 flex-1">
              <div class="flex justify-between items-center">
                <span class="text-white/80 font-mono text-sm">Master Volume</span>
                <div class="w-48 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div class="w-[80%] h-full bg-emerald-500"></div>
                </div>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-white/80 font-mono text-sm">Graphics Quality</span>
                <span class="text-emerald-400 font-mono text-sm font-bold">HIGH</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-white/80 font-mono text-sm">Show Damage Numbers</span>
                <div class="w-10 h-5 bg-emerald-500 rounded-full relative">
                  <div class="absolute right-1 top-0.5 w-4 h-4 bg-white rounded-full"></div>
                </div>
              </div>
            </div>

            <div class="mt-8 pt-4 border-t border-white/10 flex justify-center">
              <button (click)="closeSettings()" class="px-8 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-display font-bold uppercase tracking-widest transition-all">
                Back
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Death Overlay -->
      @if (gameState() === 'dead') {
        <div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-red-900/80 backdrop-blur-sm">
          <div class="mb-12 text-center">
            <h1 class="text-7xl font-display font-bold text-red-500 tracking-tighter uppercase italic drop-shadow-[0_0_20px_rgba(255,0,0,0.5)]">You Died</h1>
          </div>
          
          <div class="flex flex-col gap-4 w-64">
            <button (click)="respawn('town')" class="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-display font-bold uppercase tracking-widest transition-all hover:scale-105">
              Respawn in Town
            </button>
            <button (click)="respawn('dungeon')" class="w-full py-3 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-white font-display font-bold uppercase tracking-widest transition-all hover:scale-105">
              Respawn at Dungeon Entrance
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
    }
    .custom-scrollbar::-webkit-scrollbar {
      width: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: transparent;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 10px;
    }
  `]
})
export class GameComponent implements AfterViewInit, OnInit {
  @ViewChild('gameContainer') gameContainer!: ElementRef<HTMLDivElement>;
  private engine = inject(GameEngine);
  private assetService = inject(AssetService);
  
  inventory = this.engine.inventory;
  chest = this.engine.chest;
  potions = this.engine.potions;
  equipped = this.engine.equipped;
  stats = this.engine.derivedStats;
  materials = this.engine.materials;
  CraftingMaterial = CraftingMaterial;
  slots = Object.values(ItemSlot).filter(s => s !== ItemSlot.CONSUMABLE);
  
  loadingProgress = this.assetService.loadingProgress;
  isLoaded = this.assetService.isLoaded;
  gameState = this.engine.gameState;
  
  // Minimap
  playerPos = this.engine.playerPos;
  enemyPositions = this.engine.enemyPositions;
  interactables = this.engine.interactablesSignal;
  mapSize = this.engine.mapSize;
  tileSize = this.engine.tileSize;
  dungeonRooms = this.engine.dungeonRooms;
  dungeonGrid = this.engine.dungeonGrid;

  // UI
  playerHealth = this.engine.playerHealth;
  playerMana = this.engine.playerMana;
  damageNumbers = this.engine.damageNumbers;
  enemyUI = this.engine.enemyUI;
  gold = this.engine.gold;
  isNearVendor = this.engine.isNearVendor;
  isNearGambler = this.engine.isNearGambler;
  isNearChest = this.engine.isNearChest;
  isNearCraftingBench = this.engine.isNearCraftingBench;
  currentRegion = this.engine.currentRegion;
  dungeonLevel = this.engine.dungeonLevel;
  vendorLevel = this.engine.vendorLevel;

  showCharacter = signal(false);
  showInventory = signal(false);
  showVendor = signal(false);
  showGambler = signal(false);
  showChest = signal(false);
  showCrafting = signal(false);
  showSkillTree = signal(false);
  showSkills = signal(false);
  hoveredItem = signal<Item | null>(null);
  
  selectedCraftingItem = signal<Item | null>(null);
  salvageMode = signal(false);
  
  vendorItems = signal<Item[]>([]);
  inventorySort = signal<'level' | 'slot' | 'rarity' | 'value'>('rarity');
  hasSave = signal(false);

  activeSkills = this.engine.activeSkills;
  skillCooldownsProgress = this.engine.skillCooldownsProgress;
  linkedSupports = this.engine.linkedSupports;
  
  allSkills = Object.values(SKILL_REGISTRY).filter(s => s.category === 'attack' || s.category === 'spell');
  supports = Object.values(SKILL_REGISTRY).filter(s => s.category === 'support');

  gamblerSlots: ItemSlot[] = [
    ItemSlot.HEAD, ItemSlot.CHEST, ItemSlot.LEGS, ItemSlot.BOOTS,
    ItemSlot.GLOVES, ItemSlot.NECKLACE, ItemSlot.RING_1, ItemSlot.MAIN_HAND
  ];

  vendorUpgradeCost = computed(() => this.vendorLevel() * 1000);
  gambleCost = computed(() => this.stats().level * 50);

  selectedSpellSlot = signal<number>(0);

  assignSpell(skillId: string | null) {
    this.engine.activeSkills.update(spells => {
      const newSpells = [...spells];
      newSpells[this.selectedSpellSlot()] = skillId;
      return newSpells;
    });
  }

  isSpellEquipped(skillId: string): boolean {
    return this.activeSkills().includes(skillId);
  }

  getSkillName(id: string): string {
    return SKILL_REGISTRY[id]?.name || id;
  }

  getSkillCategory(id: string): SkillCategory {
    return SKILL_REGISTRY[id]?.category || 'spell';
  }

  getSkillTooltipStats(id: string) {
    return this.engine.getSkillTooltipStats(id);
  }

  isLinked(skillId: string, supportId: string): boolean {
    const links = this.engine.linkedSupports()[skillId] || [];
    return links.includes(supportId);
  }

  toggleSupport(skillId: string, supportId: string) {
    this.engine.linkedSupports.update(links => {
      const newLinks = { ...links };
      if (!newLinks[skillId]) newLinks[skillId] = [];
      
      if (newLinks[skillId].includes(supportId)) {
        newLinks[skillId] = newLinks[skillId].filter(id => id !== supportId);
      } else {
        if (newLinks[skillId].length < 5) {
          newLinks[skillId].push(supportId);
        }
      }
      return newLinks;
    });
  }

  sortedInventory = computed(() => {
    const inv = [...this.inventory()];
    const sortType = this.inventorySort();
    
    const rarityOrder = {
      [Rarity.COMMON]: 0,
      [Rarity.UNCOMMON]: 1,
      [Rarity.RARE]: 2,
      [Rarity.EPIC]: 3,
      [Rarity.LEGENDARY]: 4
    };

    return inv.sort((a, b) => {
      if (sortType === 'level') return b.level - a.level;
      if (sortType === 'value') return (b.goldValue || 0) - (a.goldValue || 0);
      if (sortType === 'slot') return a.slot.localeCompare(b.slot);
      if (sortType === 'rarity') {
        const rDiff = rarityOrder[b.rarity] - rarityOrder[a.rarity];
        if (rDiff !== 0) return rDiff;
        return b.level - a.level; // fallback to level
      }
      return 0;
    });
  });

  allStats: { key: keyof ItemStats, label: string, colorClass: string, isPercent?: boolean }[] = [
    { key: 'attack', label: 'ATK', colorClass: 'text-emerald-400' },
    { key: 'defense', label: 'DEF', colorClass: 'text-blue-400' },
    { key: 'speed', label: 'SPD', colorClass: 'text-amber-400' },
    { key: 'intelligence', label: 'INT', colorClass: 'text-purple-400' },
    { key: 'strength', label: 'STR', colorClass: 'text-red-400' },
    { key: 'dexterity', label: 'DEX', colorClass: 'text-green-400' },
    { key: 'vitality', label: 'VIT', colorClass: 'text-orange-400' },
    { key: 'maxHealth', label: 'MAX HP', colorClass: 'text-red-500' },
    { key: 'maxMana', label: 'MAX MP', colorClass: 'text-blue-500' },
    { key: 'critChance', label: 'CRIT', colorClass: 'text-pink-400', isPercent: true },
    { key: 'critDamage', label: 'CRIT DMG', colorClass: 'text-pink-400', isPercent: true },
    { key: 'attackSpeed', label: 'ATK SPD', colorClass: 'text-yellow-400', isPercent: true },
    { key: 'castSpeed', label: 'CAST SPD', colorClass: 'text-pink-400', isPercent: true },
    { key: 'lifeRegeneration', label: 'HP REGEN', colorClass: 'text-red-400' },
    { key: 'manaRegeneration', label: 'MP REGEN', colorClass: 'text-blue-400' },
    { key: 'lifeLeechAttack', label: 'LEECH (ATK)', colorClass: 'text-red-500', isPercent: true },
    { key: 'lifeLeechSpell', label: 'LEECH (SPL)', colorClass: 'text-blue-500', isPercent: true },
    { key: 'fireResistance', label: 'FIRE RES', colorClass: 'text-orange-500' },
    { key: 'lightningResistance', label: 'LIGHTNING RES', colorClass: 'text-yellow-300' },
    { key: 'iceResistance', label: 'ICE RES', colorClass: 'text-cyan-400' },
    { key: 'poisonResistance', label: 'POISON RES', colorClass: 'text-green-500' },
    { key: 'blockChance', label: 'BLOCK CHANCE', colorClass: 'text-blue-500', isPercent: true },
    { key: 'evasion', label: 'EVASION', colorClass: 'text-cyan-500', isPercent: true }
  ];

  getItemSet(setId?: string) {
    if (!setId) return null;
    return ITEM_SETS[setId];
  }

  getEquippedSetPiecesCount(setId?: string): number {
    if (!setId) return 0;
    let count = 0;
    Object.values(this.equipped()).forEach(item => {
      if (item && item.setId === setId) {
        count++;
      }
    });
    return count;
  }

  getCompareItem(item: Item): Item | undefined {
    if (item.slot === ItemSlot.RING_1 || item.slot === ItemSlot.RING_2) {
      if (!this.equipped()[ItemSlot.RING_1]) return undefined;
      if (!this.equipped()[ItemSlot.RING_2]) return undefined;
      return this.equipped()[ItemSlot.RING_1];
    }
    return this.equipped()[item.slot];
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (this.gameState() !== 'playing') {
      if (event.key === 'Escape' && this.gameState() === 'settings') {
        this.closeSettings();
      }
      return;
    }

    if (event.key === 'Escape') {
      this.engine.saveGame();
      this.gameState.set('menu');
      return;
    }

    if (event.key.toLowerCase() === 'c') {
      this.showCharacter.update(v => !v);
    }
    if (event.key.toLowerCase() === 'i') {
      this.showInventory.update(v => !v);
    }
    if (event.key.toLowerCase() === 'p' && this.currentRegion() === 'dungeon') {
      this.returnToTown();
    }
    if (event.key.toLowerCase() === 'v' && this.isNearVendor()) {
      this.showVendor.update(v => !v);
    }
    if (event.key.toLowerCase() === 'g' && this.isNearGambler()) {
      this.showGambler.update(v => !v);
    }
    if (event.key.toLowerCase() === 'b' && this.isNearChest()) {
      this.showChest.update(v => !v);
    }
    if (event.key.toLowerCase() === 'o' && this.isNearCraftingBench()) {
      this.showCrafting.update(v => !v);
    }
    if (event.key.toLowerCase() === 't') {
      this.showSkillTree.update(v => !v);
    }
    if (event.key.toLowerCase() === 'k') {
      this.showSkills.update(v => !v);
    }

    // Potion hotkeys
    if (event.code === 'Digit1') this.usePotion(0);
    if (event.code === 'Digit2') this.usePotion(1);
    if (event.code === 'Digit3') this.usePotion(2);
    if (event.code === 'Digit4') this.usePotion(3);
  }

  buyItem(item: Item) {
    const cost = (item.goldValue || 10) * 2;
    if (this.gold() >= cost && this.inventory().length < 20) {
      this.engine.gold.update(g => g - cost);
      this.engine.inventory.update(inv => [...inv, item]);
      this.vendorItems.update(items => items.filter(i => i.id !== item.id));
    }
  }

  upgradeVendor() {
    const cost = this.vendorUpgradeCost();
    if (this.gold() >= cost) {
      this.engine.gold.update(g => g - cost);
      this.engine.vendorLevel.update(l => l + 1);
      this.refreshVendorItems();
    }
  }

  gambleItem(slot: ItemSlot) {
    const cost = this.gambleCost();
    if (this.gold() >= cost && this.inventory().length < 20) {
      this.engine.gold.update(g => g - cost);
      // Gambler generates items at player level + 1, with higher chance for good rarity
      const item = LootManager.generateItem(this.stats().level + 1, undefined, this.stats().level + 2, slot);
      this.engine.inventory.update(inv => [...inv, item]);
    }
  }

  sellItem(item: Item) {
    const value = item.goldValue || 10;
    this.engine.gold.update(g => g + value);
    this.engine.inventory.update(inv => inv.filter(i => i.id !== item.id));
  }

  sellAll() {
    let totalValue = 0;
    this.inventory().forEach(item => {
      totalValue += item.goldValue || 10;
    });
    this.engine.gold.update(g => g + totalValue);
    this.engine.inventory.set([]);
  }

  moveToChest(item: Item) {
    this.engine.inventory.update(inv => inv.filter(i => i.id !== item.id));
    this.engine.chest.update(c => [...c, item]);
  }

  moveToInventory(item: Item) {
    if (this.inventory().length >= 20) return; // Full
    this.engine.chest.update(c => c.filter(i => i.id !== item.id));
    this.engine.inventory.update(inv => [...inv, item]);
  }

  salvageItem(item: Item) {
    this.engine.salvageItem(item);
    if (this.selectedCraftingItem()?.id === item.id) {
      this.selectedCraftingItem.set(null);
    }
  }

  bulkSalvage(rarityStr: string) {
    const rarity = rarityStr as Rarity;
    this.engine.bulkSalvage(rarity);
    const currentSelected = this.selectedCraftingItem();
    if (currentSelected && currentSelected.rarity === rarity) {
      this.selectedCraftingItem.set(null);
    }
  }

  craftReroll(item: Item) {
    this.engine.craftRerollStats(item);
  }

  craftUpgrade(item: Item) {
    this.engine.craftUpgradeRarity(item);
  }

  craftAddSocket(item: Item) {
    this.engine.craftAddSocket(item);
  }

  craftImprint(item: Item) {
    this.engine.craftImprintStat(item);
  }

  // Passive Tree Logic
  public passiveNodes = Object.values(PASSIVE_TREE);
  public hoveredPassive = signal<PassiveNode | null>(null);
  public mouseX = signal<number>(0);
  public mouseY = signal<number>(0);

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent) {
    this.mouseX.set(event.clientX);
    this.mouseY.set(event.clientY);
  }

  getPassiveNode(id: string): PassiveNode | undefined {
    return PASSIVE_TREE[id];
  }

  returnToTown() {
    this.engine.returnToTown();
  }

  isConnectionActive(id1: string, id2: string): boolean {
    const allocated = this.stats().allocatedPassives || [];
    return allocated.includes(id1) && allocated.includes(id2);
  }

  canAllocate(nodeId: string): boolean {
    const stats = this.stats();
    const allocated = stats.allocatedPassives || [];
    if (allocated.includes(nodeId)) return false;
    if (stats.skillPoints <= 0) return false;
    
    const node = PASSIVE_TREE[nodeId];
    if (!node) return false;
    
    return node.connections.some(connId => allocated.includes(connId));
  }

  getNodeClass(node: PassiveNode): string {
    const allocated = this.stats().allocatedPassives || [];
    const isAllocated = allocated.includes(node.id);
    const isReachable = this.canAllocate(node.id);
    
    let baseClass = 'border-2 ';
    
    if (isAllocated) {
      if (node.isKeystone) return baseClass + 'bg-amber-500/20 border-amber-400 text-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.5)]';
      if (node.isNotable) return baseClass + 'bg-purple-500/20 border-purple-400 text-purple-400 shadow-[0_0_10px_rgba(192,132,252,0.5)]';
      return baseClass + 'bg-red-500/20 border-red-400 text-red-400 shadow-[0_0_10px_rgba(248,113,113,0.5)]';
    }
    
    if (isReachable) {
      if (node.isKeystone) return baseClass + 'bg-black/50 border-amber-400/50 text-amber-400/50 hover:bg-amber-500/10 hover:border-amber-400';
      if (node.isNotable) return baseClass + 'bg-black/50 border-purple-400/50 text-purple-400/50 hover:bg-purple-500/10 hover:border-purple-400';
      return baseClass + 'bg-black/50 border-red-400/50 text-red-400/50 hover:bg-red-500/10 hover:border-red-400';
    }
    
    // Unreachable
    return baseClass + 'bg-black/80 border-white/10 text-white/10';
  }

  allocatePassive(nodeId: string) {
    if (this.canAllocate(nodeId)) {
      this.engine.baseStats.update(s => ({
        ...s,
        skillPoints: s.skillPoints - 1,
        allocatedPassives: [...(s.allocatedPassives || []), nodeId]
      }));
    }
  }

  refundPassive(event: MouseEvent, nodeId: string) {
    event.preventDefault();
    if (nodeId === 'start') return;
    
    const stats = this.stats();
    const allocated = stats.allocatedPassives || [];
    if (allocated.includes(nodeId)) {
      this.engine.baseStats.update(s => ({
        ...s,
        skillPoints: s.skillPoints + 1,
        allocatedPassives: (s.allocatedPassives || []).filter(id => id !== nodeId)
      }));
    }
  }

  ngOnInit() {
    this.checkSave();
  }

  checkSave() {
    if (typeof localStorage !== 'undefined') {
      const save = localStorage.getItem('project_abyss_save');
      this.hasSave.set(!!save);
    }
  }

  refreshVendorItems() {
    const items = [];
    const vLevel = this.vendorLevel();
    // Vendor sells items around their level, up to player level + 2
    const itemLevel = Math.min(vLevel * 5, this.stats().level + 2);
    for (let i = 0; i < 8; i++) {
      items.push(LootManager.generateItem(itemLevel, undefined, vLevel));
    }
    this.vendorItems.set(items);
  }

  async ngAfterViewInit() {
    this.refreshVendorItems();

    // Define assets to load
    await this.assetService.loadAssets({
      models: {
        player: 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gltf/Soldier.glb'
      },
      textures: {
        floor: 'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/grid.png'
      }
    });

    this.engine.init(this.gameContainer);
  }

  getRarityColor(rarity: Rarity) {
    return RARITY_COLORS[rarity] || '#ffffff';
  }

  equip(item: Item) {
    if (item.slot === ItemSlot.CONSUMABLE) {
      // Find first empty potion slot
      const currentPotions = [...this.engine.potions()];
      const emptyIdx = currentPotions.findIndex(p => p === null);
      if (emptyIdx !== -1) {
        currentPotions[emptyIdx] = item;
        this.engine.potions.set(currentPotions);
        this.engine.inventory.update(inv => inv.filter(i => i.id !== item.id));
        this.hoveredItem.set(null); // Clear tooltip
      } else {
        this.engine.spawnDamageNumber(this.engine.playerPos3D(), 'POTION SLOTS FULL', '#ff0000');
      }
      return;
    }
    this.engine.equipItem(item);
  }

  usePotion(index: number) {
    const currentPotions = [...this.engine.potions()];
    const item = currentPotions[index];
    if (!item) return;

    if (item.consumableType === ConsumableType.HEALTH_POTION) {
      this.engine.playerHealth.update(h => Math.min(this.engine.derivedStats().maxHealth, h + 50));
      this.engine.spawnDamageNumber(this.engine.playerPos3D(), '+50 HP', '#00ff00');
    } else if (item.consumableType === ConsumableType.MANA_POTION) {
      this.engine.playerMana.update(m => Math.min(this.engine.derivedStats().intelligence * 10, m + 50));
      this.engine.spawnDamageNumber(this.engine.playerPos3D(), '+50 MP', '#0044ff');
    } else if (item.consumableType === ConsumableType.BLOCK_POTION) {
      this.engine.activeBuffs.update(b => ({ ...b, blockChance: 30, blockExpire: Date.now() + 10000 }));
      this.engine.spawnDamageNumber(this.engine.playerPos3D(), 'BLOCK UP!', '#3b82f6');
    } else if (item.consumableType === ConsumableType.EVADE_POTION) {
      this.engine.activeBuffs.update(b => ({ ...b, evadeChance: 30, evadeExpire: Date.now() + 10000 }));
      this.engine.spawnDamageNumber(this.engine.playerPos3D(), 'EVADE UP!', '#cccccc');
    }

    currentPotions[index] = null;
    this.engine.potions.set(currentPotions);
  }

  unequipPotion(index: number) {
    const currentPotions = [...this.engine.potions()];
    const item = currentPotions[index];
    if (item) {
      if (this.engine.inventory().length < 20) {
        this.engine.inventory.update(inv => [...inv, item]);
        currentPotions[index] = null;
        this.engine.potions.set(currentPotions);
      } else {
        this.engine.spawnDamageNumber(this.engine.playerPos3D(), 'INVENTORY FULL', '#ff0000');
      }
    }
  }

  unequip(slot: ItemSlot) {
    this.engine.unequipItem(slot);
  }

  newGame() {
    this.engine.newGame();
    this.checkSave();
  }

  continueGame() {
    this.loadGame();
  }

  respawn(location: 'town' | 'dungeon') {
    this.engine.respawn(location);
  }

  loadGame() {
    const success = this.engine.loadGame();
    if (!success) {
      alert("No save game found!");
    }
  }

  openSettings() {
    this.gameState.set('settings');
  }

  closeSettings() {
    // If we have a save or are playing, we could go back to playing, but for simplicity:
    // If we have health > 0 and level > 0, we might be playing.
    // Actually, we can just go back to menu, or if we were playing, go back to playing.
    // Let's just go back to menu for now, or playing if we were already playing.
    // We need to know where we came from. Let's just go back to menu.
    this.gameState.set('menu');
  }
}
