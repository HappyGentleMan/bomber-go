// Core tuning constants for BOMBER GO

export const COLS = 15
export const ROWS = 13
export const TILE = 48

export const CANVAS_W = COLS * TILE // 720
export const CANVAS_H = ROWS * TILE // 624

// Per-level visual themes (cycle)
export interface Theme {
  floor: string
  floorAlt: string
  grid: string
  hardFill: string
  hardEdge: string
  brickFill: string
  brickEdge: string
  brickLight: string
}

export const THEMES: Theme[] = [
  { floor: '#0d1322', floorAlt: 'rgba(255,255,255,0.02)', grid: 'rgba(0,229,255,0.04)', hardFill: '#1a2440', hardEdge: 'rgba(0,229,255,0.25)', brickFill: '#3d2b1f', brickEdge: 'rgba(255,120,60,0.5)', brickLight: 'rgba(255,180,120,0.12)' },
  { floor: '#12101f', floorAlt: 'rgba(255,255,255,0.02)', grid: 'rgba(186,104,200,0.05)', hardFill: '#241a3d', hardEdge: 'rgba(186,104,200,0.3)', brickFill: '#2e2438', brickEdge: 'rgba(200,120,255,0.5)', brickLight: 'rgba(220,160,255,0.10)' },
  { floor: '#0e1512', floorAlt: 'rgba(255,255,255,0.02)', grid: 'rgba(105,240,174,0.04)', hardFill: '#16281f', hardEdge: 'rgba(105,240,174,0.28)', brickFill: '#2a3320', brickEdge: 'rgba(140,220,120,0.5)', brickLight: 'rgba(180,255,150,0.10)' },
  { floor: '#151011', floorAlt: 'rgba(255,255,255,0.02)', grid: 'rgba(255,82,82,0.045)', hardFill: '#2d1a20', hardEdge: 'rgba(255,82,82,0.3)', brickFill: '#3a2620', brickEdge: 'rgba(255,120,90,0.5)', brickLight: 'rgba(255,160,120,0.10)' },
  { floor: '#101418', floorAlt: 'rgba(255,255,255,0.02)', grid: 'rgba(128,222,234,0.05)', hardFill: '#1c2b36', hardEdge: 'rgba(128,222,234,0.3)', brickFill: '#2b3a44', brickEdge: 'rgba(140,210,230,0.5)', brickLight: 'rgba(180,235,255,0.10)' },
]

export function themeForLevel(level: number): Theme {
  return THEMES[(level - 1) % THEMES.length]
}

// Movement (tiles per second)
export const PLAYER_BASE_SPEED = 4.2
export const PLAYER_SPEED_STEP = 0.9
export const PLAYER_MAX_SPEED_LEVELS = 4

export const BOMB_FUSE = 2600 // ms
export const BOMB_FUSE_MIN = 1700
export const FLAME_DURATION = 480 // ms

/** player color palette (all pop on the dark bg) */
export const PLAYER_COLORS = ['#00e5ff', '#ff2e88', '#ffd54a', '#7dff5e', '#b388ff', '#ff9840', '#4aa8ff', '#5effd0']
export const SPAWN_INVULN = 1600 // ms
export const SHIELD_DURATION = 10_000
export const INVINCIBLE_DURATION = 8_000
export const WALLPASS_DURATION = 10_000
export const FREEZE_DURATION = 5_000

export const MAX_BOMBS = 8
export const MAX_FLAME = 8

// Powerup drops: chance per enemy kill (final enemy of a level always drops one)
export const POWERUP_DROP_CHANCE = 0.4
export const MAX_POWERUPS_ON_FIELD = 5

// Enemy speed multiplier (player glides at ~4.2 tiles/s; keep enemies clearly
// slower so they feel avoidable, not punishing)
export const ENEMY_SPEED_SCALE = 0.65

export const START_LIVES = 3
export const LEVEL_TIME = 180 // seconds
export const BATTLE_TIME = 120
export const BATTLE_ROUND_TARGET = 2 // first to N rounds wins the match

export const ENEMY_MAX = 10

// Grid tile types
export const T_WALK = 0
export const T_HARD = 1
export const T_SOFT = 2

export const DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
] as const

export type Dir = 0 | 1 | 2 | 3 // right, left, down, up

export const POWERUP_KINDS = [
  'bomb', 'flame', 'speed', 'shrink', 'shrinkf',
  'shield', 'invincible', 'wallpass', 'freeze', 'life',
] as const
export type PowerupKind = (typeof POWERUP_KINDS)[number]

export interface PowerupDef {
  kind: PowerupKind
  color: string
  glyph: string
  label: string
  weight: number // spawn weight
}

export const POWERUP_DEFS: Record<PowerupKind, PowerupDef> = {
  bomb:       { kind: 'bomb',       color: '#ff5252', glyph: 'B', label: 'BOMB +1',        weight: 16 },
  flame:      { kind: 'flame',      color: '#ff9800', glyph: 'F', label: 'FLAME +1',       weight: 16 },
  speed:      { kind: 'speed',      color: '#4dd0e1', glyph: 'S', label: 'SPEED +1',       weight: 10 },
  shrink:     { kind: 'shrink',     color: '#9575cd', glyph: '−B', label: 'BOMB −1',       weight: 6 },
  shrinkf:    { kind: 'shrinkf',    color: '#7986cb', glyph: '−F', label: 'FLAME −1',      weight: 5 },
  shield:     { kind: 'shield',     color: '#69f0ae', glyph: '◆', label: 'SHIELD',         weight: 9 },
  invincible: { kind: 'invincible', color: '#ffd54a', glyph: '★', label: 'INVINCIBLE',     weight: 7 },
  wallpass:   { kind: 'wallpass',   color: '#f48fb1', glyph: '⊘', label: 'WALL PASS',      weight: 6 },
  freeze:     { kind: 'freeze',     color: '#80deea', glyph: '❄', label: 'FREEZE',         weight: 5 },
  life:       { kind: 'life',       color: '#fff176', glyph: '♥', label: 'EXTRA LIFE',     weight: 2 },
}
