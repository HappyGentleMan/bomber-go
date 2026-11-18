import type { EnemyDef } from './types'

// The classic roster, re-skinned
export const ENEMY_DEFS: Record<string, EnemyDef> = {
  balloom:  { type: 'balloom',  name: 'BALLOM',  color: '#ff8a65', eyes: '#fff', speed: 2.4, points: 100,  wallpass: false, ai: 'wander', hp: 1 },
  oneal:    { type: 'oneal',    name: "O'NEAL",  color: '#64b5f6', eyes: '#fff', speed: 3.2, points: 200,  wallpass: false, ai: 'chaseY', hp: 1 },
  doll:     { type: 'doll',     name: 'DALL',    color: '#ef5350', eyes: '#fff', speed: 3.2, points: 400,  wallpass: false, ai: 'chaseX', hp: 1 },
  minvo:    { type: 'minvo',    name: 'MINVO',   color: '#ffb74d', eyes: '#4a2c00', speed: 4.0, points: 800,  wallpass: false, ai: 'chase', hp: 1 },
  kondoria: { type: 'kondoria', name: 'KONDOR',  color: '#4fc3f7', eyes: '#013', speed: 2.0, points: 1000, wallpass: true,  ai: 'wander', hp: 2 },
  ovapi:    { type: 'ovapi',    name: 'OVAPI',   color: '#ba68c8', eyes: '#fff', speed: 2.6, points: 2000, wallpass: true,  ai: 'flee', hp: 1 },
  pass:     { type: 'pass',     name: 'PARSE',   color: '#fff176', eyes: '#333', speed: 4.2, points: 4000, wallpass: false, ai: 'bfs', hp: 2 },
  pontan:   { type: 'pontan',   name: 'PONTAN',  color: '#ff7043', eyes: '#fff', speed: 4.4, points: 8000, wallpass: true,  ai: 'bfs', hp: 2 },
}
