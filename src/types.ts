import type { Dir, PowerupKind } from './constants'
export type { PowerupKind }

export interface Vec { x: number; y: number }

export type EnemyType =
  | 'balloom' | 'oneal' | 'doll' | 'minvo'
  | 'kondoria' | 'ovapi' | 'pass' | 'pontan'

export interface EnemyDef {
  type: EnemyType
  name: string
  color: string
  eyes: string
  speed: number        // tiles/sec
  points: number
  wallpass: boolean
  ai: 'wander' | 'chaseY' | 'chaseX' | 'chase' | 'bfs' | 'flee'
  hp: number
}

export interface PlayerState {
  id: number
  isAI: boolean
  col: number; row: number
  x: number; y: number       // pixel centre
  dir: Dir
  moving: boolean
  movingDir: Dir | null      // buffered direction
  speed: number              // tiles/sec
  bombs: number              // max simultaneous
  flame: number              // blast range
  shieldUntil: number
  invincibleUntil: number
  wallpassUntil: number
  kickUntil: number
  frozenUntil: number
  alive: boolean
  respawnIn: number
  stepTimer: number
  score: number
  kills: number
  color: string
}

export interface BombState {
  id: number
  owner: number
  col: number; row: number
  fuse: number
  power: number
  born: number
}

export interface FlameState {
  col: number; row: number
  dir: number // 0 right 1 left 2 down 3 up (-1 = core)
  ttl: number
  seed: number
}

export interface PowerupState {
  col: number; row: number
  kind: PowerupKind
  born: number
}

export interface EnemyState {
  id: number
  type: EnemyType
  col: number; row: number
  x: number; y: number
  dir: Dir
  moving: boolean
  movingDir: Dir | null
  moveTimer: number
  aiTimer: number
  hp: number
  alive: boolean
  frozen: boolean
  deadAt: number
  born: number
  seed: number
}

export type GameStateName =
  | 'title' | 'campaign' | 'battle' | 'paused'
  | 'levelclear' | 'gameover' | 'battleover'
