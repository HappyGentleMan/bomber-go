import type { Game } from './game'
import { Particles } from './particles'
import { COLS, ROWS } from './constants'
import type { Dir, PowerupKind } from './constants'

/**
 * Online battle: host-authoritative snapshots.
 * Host serializes the live Game ~20Hz; the client applies it to a plain
 * "remote game" object that the Renderer can draw (no simulation on client).
 */

// ---------- host side ----------

export function serializeGame(g: Game): any {
  return {
    grid: g.grid.map(row => row.map(c => c.t)),
    players: g.players.map(p => [
      +p.x.toFixed(3), +p.y.toFixed(3), p.dir, p.moving ? 1 : 0, p.alive ? 1 : 0,
      p.bombs, p.flame, +p.speed.toFixed(2),
      +p.shieldUntil.toFixed(2), +p.invincibleUntil.toFixed(2),
      +p.wallpassUntil.toFixed(2), +p.kickUntil.toFixed(2), +p.frozenUntil.toFixed(2),
      p.kills, p.respawnIn,
    ]),
    bombs: g.bombs.map(b => [b.col, b.row, Math.round(b.fuse), b.power, b.owner]),
    flames: g.flames.map(f => [f.col, f.row, f.dir, +f.ttl.toFixed(3), f.seed]),
    powerups: g.powerups.map(u => [u.col, u.row, u.kind, u.revealed ? 1 : 0]),
    enemies: g.enemies.map(e => [
      e.type, +e.x.toFixed(3), +e.y.toFixed(3), e.dir, e.alive ? 1 : 0,
      e.frozen ? 1 : 0, +e.born.toFixed(2), e.seed,
    ]),
    exit: [g.exit.col, g.exit.row, g.exit.revealed ? 1 : 0],
    state: g.state,
    time: +g.time.toFixed(2),
    level: g.level,
    levelTime: g.levelTime,
    score: g.score,
    round: g.round,
    roundWins: g.roundWins,
    winner: g.winner,
    suddenDeath: g.suddenDeath,
    freezeUntil: +g.freezeUntil.toFixed(2),
    flash: [g.flashColor, +g.getFlashAlpha().toFixed(3)],
    shake: g.getShakeOffset(),
    particles: g.particles.list.map(p => [
      +p.x.toFixed(1), +p.y.toFixed(1), +p.vx.toFixed(1), +p.vy.toFixed(1),
      +p.life.toFixed(3), +p.maxLife.toFixed(3), +p.size.toFixed(1),
      p.color, p.kind, p.grav, p.text ?? '',
    ]),
  }
}

// ---------- client side ----------

/**
 * Plain object shaped like the fields the Renderer reads from a Game.
 * Updated from snapshots; never simulated.
 */
export class RemoteGame {
  mode = 'battle' as const
  grid: { t: number }[][] = []
  players: any[] = []
  enemies: any[] = []
  bombs: any[] = []
  flames: any[] = []
  powerups: any[] = []
  exit = { col: -1, row: -1, revealed: false }
  state: 'playing' | 'levelclear' | 'over' | 'battleover' = 'playing'
  time = 0
  level = 1
  levelTime = 180
  score = 0
  lives = 0
  round = 1
  roundWins: [number, number] = [0, 0]
  winner = -1
  suddenDeath = false
  freezeUntil = 0
  flashColor = '255,255,255'
  flashAlpha = 0
  particles = new Particles()

  private shakeOff = { x: 0, y: 0 }

  getShakeOffset() { return this.shakeOff }
  getFlashAlpha() { return this.flashAlpha }

  apply(s: any) {
    if (!s) return
    this.grid = (s.grid as number[][]).map(row => row.map(t => ({ t })))
    this.state = s.state
    this.time = s.time
    this.level = s.level
    this.levelTime = s.levelTime
    this.score = s.score
    this.round = s.round
    this.roundWins = s.roundWins
    this.winner = s.winner
    this.suddenDeath = s.suddenDeath
    this.freezeUntil = s.freezeUntil
    this.flashColor = s.flash[0]
    this.flashAlpha = s.flash[1]
    this.shakeOff = s.shake
    this.exit = { col: s.exit[0], row: s.exit[1], revealed: !!s.exit[2] }
    this.players = s.players.map((p: any[], i: number) => ({
      id: i,
      x: p[0], y: p[1], col: Math.round(p[0]), row: Math.round(p[1]),
      dir: p[2] as Dir, moving: !!p[3], alive: !!p[4],
      speed: p[7],
      bombs: p[5], flame: p[6],
      shieldUntil: p[8], invincibleUntil: p[9],
      wallpassUntil: p[10], kickUntil: p[11], frozenUntil: p[12],
      kills: p[13], respawnIn: p[14],
      movingDir: null, stepTimer: 0,
      color: i === 0 ? '#00e5ff' : '#ff2e88',
    }))
    this.bombs = s.bombs.map((b: any[]) => ({ col: b[0], row: b[1], fuse: b[2], power: b[3], owner: b[4] }))
    this.flames = s.flames.map((f: any[]) => ({ col: f[0], row: f[1], dir: f[2], ttl: f[3], seed: f[4] }))
    this.powerups = s.powerups.map((u: any[]) => ({ col: u[0], row: u[1], kind: u[2] as PowerupKind, born: 0, revealed: !!u[3] }))
    this.enemies = s.enemies.map((e: any[]) => ({
      type: e[0], x: e[1], y: e[2], dir: e[3], alive: !!e[4],
      frozen: !!e[5], born: e[6], seed: e[7],
      col: Math.round(e[1]), row: Math.round(e[2]),
      moving: false, movingDir: null, aiTimer: 0, moveTimer: 0, hp: 1, deadAt: 0,
    }))
    // particles: inject (renderer draws them; local update advances)
    this.particles.list = s.particles.map((p: any[]) => ({
      x: p[0], y: p[1], vx: p[2], vy: p[3],
      life: p[4], maxLife: p[5], size: p[6],
      color: p[7], kind: p[8], grav: p[9], text: p[10] || undefined,
    }))
  }
}

/** audio/haptics events detected by diffing consecutive snapshots (client side) */
export interface NetEvents {
  boom: boolean
  playerHit: boolean
  powerup: boolean
  bombPlaced: boolean
  roundWin: number   // -1 none, 0/1 winner, 2 draw
  battleOver: boolean
  suddenDeath: boolean
}

export function diffSnapshots(prev: any, cur: any): NetEvents {
  const ev: NetEvents = { boom: false, playerHit: false, powerup: false, bombPlaced: false, roundWin: -1, battleOver: false, suddenDeath: false }
  if (!prev) return ev
  // flames appearing = explosion
  if (cur.flames.length > prev.flames.length) ev.boom = true
  // player died
  for (let i = 0; i < cur.players.length; i++) {
    if (prev.players[i] && prev.players[i][4] === 1 && cur.players[i][4] === 0) ev.playerHit = true
  }
  // powerup picked up (count drops)
  if (cur.powerups.length < prev.powerups.length) ev.powerup = true
  // new bomb
  if (cur.bombs.length > prev.bombs.length) ev.bombPlaced = true
  if (cur.suddenDeath && !prev.suddenDeath) ev.suddenDeath = true
  if (cur.state === 'battleover' && prev.state !== 'battleover') {
    ev.battleOver = true
    ev.roundWin = cur.winner
  } else if (cur.state === 'playing' && prev.state === 'playing' && cur.round !== prev.round) {
    // round just restarted
    ev.roundWin = -1
  }
  return ev
}

export { COLS, ROWS }
