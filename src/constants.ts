// Core tuning constants for BOMBER GO

export const COLS = 15
export const ROWS = 13
export const TILE = 48

export const CANVAS_W = COLS * TILE // 720
export const CANVAS_H = ROWS * TILE // 624

// Movement (tiles per second)
export const PLAYER_BASE_SPEED = 4.2
export const PLAYER_SPEED_STEP = 0.9
export const PLAYER_MAX_SPEED_LEVELS = 4

export const BOMB_FUSE = 2600 // ms
export const BOMB_FUSE_MIN = 1700
export const FLAME_DURATION = 480 // ms
export const SPAWN_INVULN = 1600 // ms
export const SHIELD_DURATION = 10_000
export const INVINCIBLE_DURATION = 8_000
export const WALLPASS_DURATION = 10_000
export const FREEZE_DURATION = 5_000
export const KICK_DURATION = 8_000

export const MAX_BOMBS = 8
export const MAX_FLAME = 8

export const START_LIVES = 3
export const LEVEL_TIME = 180 // seconds
export const BATTLE_TIME = 120

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
  'shield', 'invincible', 'wallpass', 'freeze', 'kick', 'life',
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
  kick:       { kind: 'kick',       color: '#ffab91', glyph: 'K', label: 'KICK',           weight: 4 },
  life:       { kind: 'life',       color: '#fff176', glyph: '♥', label: 'EXTRA LIFE',     weight: 2 },
}
