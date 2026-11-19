import {
  COLS, ROWS, T_WALK, T_HARD, T_SOFT, DIRS,
  PLAYER_BASE_SPEED, PLAYER_SPEED_STEP, PLAYER_MAX_SPEED_LEVELS,
  BOMB_FUSE, BOMB_FUSE_MIN, FLAME_DURATION, SPAWN_INVULN,
  SHIELD_DURATION, INVINCIBLE_DURATION, WALLPASS_DURATION, FREEZE_DURATION, KICK_DURATION,
  MAX_BOMBS, MAX_FLAME, START_LIVES, LEVEL_TIME, BATTLE_TIME, BATTLE_ROUND_TARGET,
  POWERUP_DEFS, POWERUP_KINDS, POWERUP_DROP_CHANCE, MAX_POWERUPS_ON_FIELD,
  ENEMY_SPEED_SCALE,
} from './constants'
import type { Dir } from './constants'
import type {
  PlayerState, BombState, FlameState, PowerupState, EnemyState,
} from './types'
import { generateLevel, generateBattleMap, levelEnemies, type Grid, type LevelDef } from './level'
import { Particles } from './particles'
import { audio } from './audio'
import { ENEMY_DEFS } from './enemies'
import type { EnemyDef } from './types'

const dirVec = (d: Dir): [number, number] => [DIRS[d].x, DIRS[d].y]
const key = (c: number, r: number) => c + r * COLS

let idCounter = 1
const nid = () => idCounter++

/** haptic feedback: mobile vibration + gamepad rumble (feature-detected, never throws) */
export function haptic(ms: number, strong = 0.8, weak = 0.5) {
  try {
    if (typeof navigator === 'undefined') return
    if ('vibrate' in navigator) (navigator as Navigator & { vibrate(p: number | number[]): boolean }).vibrate(ms)
    if (navigator.getGamepads) {
      for (const p of navigator.getGamepads()) {
        const act = (p as Gamepad & { vibrationActuator?: { playEffect?(t: string, o: object): Promise<boolean> } })?.vibrationActuator
        if (act?.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {})
      }
    }
  } catch { /* haptics unavailable — ignore */ }
}

export class Game {
  mode: 'campaign' | 'battle' = 'campaign'
  state: 'playing' | 'levelclear' | 'over' | 'battleover' = 'playing'
  attract = false

  level = 1
  grid: Grid
  def: LevelDef
  players: PlayerState[] = []
  enemies: EnemyState[] = []
  bombs: BombState[] = []
  flames: FlameState[] = []
  powerups: PowerupState[] = []
  exit = { col: -1, row: -1, revealed: false }
  lives = START_LIVES
  score = 0
  time = 0            // elapsed seconds in level
  levelTime = LEVEL_TIME
  freezeUntil = 0     // global enemy freeze
  suddenDeath = false
  suddenTick = 0
  battleNextItem = 12   // battle: seconds until next item drop
  killChain = 0
  clearTimer = 0
  overTimer = 0
  lastKiller: number = -1
  winner: number = -1 // battle
  round = 1                     // battle: current round
  roundWins: [number, number] = [0, 0] // battle: rounds won per player
  bombId = 1
  exitTimer = 0
  particles = new Particles()
  shakeMag = 0
  shakeDur = 0
  shakeT = 0
  // full-screen flash (big combos, level clear, sudden death)
  flashColor = '255,255,255'
  flashMag = 0
  flashDur = 0
  flashT = 0
  // hit-stop: brief slow-mo on big moments
  timeScale = 1
  timeScaleT = 0
  timeScaleDur = 0

  onEvent: ((ev: string, data?: any) => void) | null = null

  constructor(mode: 'campaign' | 'battle', opts: { aiPlayer2?: boolean; attract?: boolean } = {}) {
    this.mode = mode
    this.attract = opts.attract ?? false
    this.levelTime = mode === 'campaign' ? LEVEL_TIME : BATTLE_TIME
    this.def = mode === 'campaign' ? generateLevel(1) : generateBattleMap()
    this.grid = this.def.grid
    this.powerups = this.def.powerups.map(u => ({ ...u, born: 0, revealed: false }))
    this.spawnPlayers(opts.aiPlayer2 ?? false)
    if (mode === 'battle') this.exit = { col: -1, row: -1, revealed: false }
    else { this.exit = { col: this.def.exitCol, row: this.def.exitRow, revealed: false }; this.spawnEnemies() }
  }

  shake(mag: number, dur: number) {
    this.shakeMag = Math.max(this.shakeMag, mag)
    this.shakeDur = Math.max(this.shakeDur, dur)
    this.shakeT = Math.max(this.shakeT, dur)
  }

  flash(rgb: string, mag: number, dur: number) {
    this.flashColor = rgb
    this.flashMag = Math.max(this.flashMag, mag)
    this.flashDur = Math.max(this.flashDur, dur)
    this.flashT = Math.max(this.flashT, dur)
  }

  getFlashAlpha(): number {
    if (this.flashT <= 0) return 0
    return this.flashMag * (this.flashT / this.flashDur)
  }

  hitStop(scale: number, dur: number) {
    this.timeScale = Math.min(this.timeScale, scale)
    this.timeScaleT = Math.max(this.timeScaleT, dur)
    this.timeScaleDur = Math.max(this.timeScaleDur, dur)
  }

  emit(ev: string, data?: any) {
    this.onEvent?.(ev, data)
  }

  // ---------------- setup ----------------

  makePlayer(id: number, col: number, row: number, isAI: boolean): PlayerState {
    return {
      id, isAI,
      col, row,
      x: col, y: row,
      prevX: col, prevY: row,
      dir: 0, moving: false, movingDir: null,
      speed: PLAYER_BASE_SPEED,
      bombs: 1, flame: 1,
      shieldUntil: 0, invincibleUntil: 0, wallpassUntil: 0, kickUntil: 0,
      frozenUntil: 0,
      alive: true, respawnIn: 0, stepTimer: 0,
      score: 0, kills: 0,
      color: id === 0 ? '#00e5ff' : '#ff2e88',
    }
  }

  spawnPlayers(aiP2: boolean) {
    const spawns = this.def.playerSpawns
    this.players = [
      this.makePlayer(0, spawns[0].col, spawns[0].row, this.attract),
      this.mode === 'battle' ? this.makePlayer(1, spawns[1].col, spawns[1].row, this.attract ? true : aiP2) : null,
    ].filter((p): p is PlayerState => p !== null)
  }

  spawnEnemies() {
    const roster = levelEnemies(this.level)
    this.enemies = []
    for (let i = 0; i < Math.min(roster.length, this.def.enemySpawns.length); i++) {
      const def = ENEMY_DEFS[roster[i]]
      const s = this.def.enemySpawns[i]
      this.enemies.push({
        id: nid(), type: def.type,
        col: s.col, row: s.row, x: s.col, y: s.row,
        prevX: s.col, prevY: s.row,
        dir: Math.floor(Math.random() * 4) as Dir,
        moving: false, movingDir: null,
        tx: s.col, ty: s.row,
        moveTimer: 0, aiTimer: Math.random() * 2,
        hp: def.hp, alive: true, frozen: false, deadAt: 0,
        born: this.time,
        seed: Math.random(),
      })
    }
  }

  nextLevel() {
    this.level++
    this.def = generateLevel(this.level)
    this.grid = this.def.grid
    this.bombs = []
    this.flames = []
    this.powerups = this.def.powerups.map(u => ({ ...u, born: 0, revealed: false }))
    this.exit = { col: this.def.exitCol, row: this.def.exitRow, revealed: false }
    this.exitTimer = 0
    this.time = 0
    this.suddenDeath = false
    this.suddenTick = 0
    this.killChain = 0
    this.spawnEnemies()
    const p = this.players[0]
    p.alive = true
    p.col = 1; p.row = 1; p.x = 1; p.y = 1
    p.moving = false; p.movingDir = null
    p.invincibleUntil = this.time + SPAWN_INVULN / 1000
    p.shieldUntil = 0; p.wallpassUntil = 0; p.kickUntil = 0
    p.frozenUntil = 0
    this.state = 'playing'
    this.particles.clear()
  }

  // ---------------- queries ----------------

  tile(c: number, r: number): number {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return T_HARD
    return this.grid[r][c].t
  }

  bombAt(c: number, r: number): BombState | undefined {
    return this.bombs.find(b => b.col === c && b.row === r)
  }

  flameSet(): Set<number> {
    const s = new Set<number>()
    for (const f of this.flames) s.add(key(f.col, f.row))
    return s
  }

  private enemyAt(c: number, r: number): EnemyState | undefined {
    return this.enemies.find(e => e.alive && e.col === c && e.row === r)
  }

  private playerAt(c: number, r: number, exclude?: number): PlayerState | undefined {
    return this.players.find(p => p.alive && p.id !== exclude && p.col === c && p.row === r)
  }

  canEnter(e: { col: number; row: number; isAI?: boolean; wallpassUntil?: number; type?: string }, c: number, r: number): boolean {
    if (c < 1 || r < 1 || c >= COLS - 1 || r >= ROWS - 1) return false
    const t = this.tile(c, r)
    if (t === T_HARD) return false
    if (t === T_SOFT) {
      if (e.isAI !== undefined) return (e.wallpassUntil ?? 0) > this.time
      return ENEMY_DEFS[e.type!].wallpass
    }
    if (this.bombAt(c, r)) return false
    if (this.enemyAt(c, r)) return e.isAI === undefined // enemy may enter player tile (kills); player can't enter enemy tile
    if (e.isAI !== undefined && this.mode === 'battle') {
      if (this.playerAt(c, r, (e as PlayerState).id)) return false
    }
    return true
  }

  // ---------------- player ----------------

  playerInput(pid: number, dir: Dir | null, bomb: boolean, detonate: boolean) {
    const p = this.players.find(pl => pl.id === pid)
    if (!p || !p.alive || this.state !== 'playing') return
    if (dir !== null) p.movingDir = dir
    if (bomb) this.tryPlaceBomb(p)
    if (detonate) {
      const oldest = this.bombs.filter(b => b.owner === pid).sort((a, b) => a.born - b.born)[0]
      if (oldest) this.detonate(oldest)
    }
  }

  tryPlaceBomb(p: PlayerState) {
    const active = this.bombs.filter(b => b.owner === p.id).length
    if (active >= p.bombs) return
    if (this.bombAt(p.col, p.row)) return
    if (this.tile(p.col, p.row) === T_SOFT) return
    const fuse = Math.max(BOMB_FUSE_MIN, BOMB_FUSE - (this.level - 1) * 60)
    this.bombs.push({
      id: this.bombId++, owner: p.id,
      col: p.col, row: p.row,
      fuse, power: p.flame, born: this.time,
    })
    const c = this.particles.tileCenter(p.col, p.row)
    this.particles.dust(c.x, c.y)
    audio.play('bomb')
  }

  updatePlayers(dt: number, inputs: { dir: Dir | null; bomb: boolean; detonate: boolean }[]) {
    for (const p of this.players) {
      if (!p.alive) {
        p.respawnIn -= dt
        if (p.respawnIn <= 0 && this.state === 'playing') this.respawnPlayer(p)
        continue
      }
      const inp = inputs[p.id] ?? { dir: null, bomb: false, detonate: false }
      // Live held direction (null when no key is down). moveEntity uses it to
      // glide seamlessly into the next tile: a tap stops at the next tile
      // boundary, a hold keeps gliding with no per-tile hitch (choppy feel).
      p.movingDir = inp.dir
      if (inp.bomb) this.tryPlaceBomb(p)
      if (inp.detonate) {
        const oldest = this.bombs.filter(b => b.owner === p.id).sort((a, b) => a.born - b.born)[0]
        if (oldest) this.detonate(oldest)
      }
      if (p.frozenUntil > this.time) { p.moving = false; p.movingDir = null; this.pickupPowerups(p); continue }
      this.moveEntity(p, dt)
      // derive the tile the player occupies (grid logic, pickup, AI, exit)
      p.col = Math.round(p.x); p.row = Math.round(p.y)
      if (p.moving) {
        p.stepTimer -= dt
        if (p.stepTimer <= 0) {
          p.stepTimer = 0.22
          const c = this.particles.tileCenter(p.col, p.row)
          this.particles.dust(c.x, c.y + 12)
        }
      }
      this.pickupPowerups(p)
    }
    // overlap deaths (enemies)
    const flame = this.flameSet()
    for (const p of this.players) {
      if (!p.alive) continue
      if (flame.has(key(p.col, p.row)) && p.shieldUntil < this.time && p.invincibleUntil < this.time) {
        this.killPlayer(p, 'flame')
        continue
      }
      for (const e of this.enemies) {
        if (!e.alive) continue
        if (Math.abs(e.x - p.x) < 0.55 && Math.abs(e.y - p.y) < 0.55) {
          if (p.invincibleUntil > this.time) {
            // smash through invincible
            this.killEnemy(e, p, true)
          } else {
            this.killPlayer(p, 'enemy')
            break
          }
        }
      }
    }
  }

  // ---------------- continuous free movement (DeepSeek-style) ----------------
  // Entities float freely: an AABB (half = 0.3 tile) in open space. While a
  // direction is held, the axis perpendicular to it eases back to the
  // row/column centre, so you can turn and stop anywhere — not just on
  // tile boundaries. `col/row` stay derived (rounded) for grid logic.

  private static readonly HALF = 0.3

  tileSolidFor(e: { isAI?: boolean; wallpassUntil?: number; type?: string }, c: number, r: number): boolean {
    if (c < 1 || r < 1 || c >= COLS - 1 || r >= ROWS - 1) return true
    const t = this.tile(c, r)
    if (t === T_HARD) return true
    if (t === T_SOFT) {
      // solid UNLESS the entity can pass walls (player wallpass powerup)
      if (e.isAI !== undefined) return (e.wallpassUntil ?? 0) <= this.time
      return !ENEMY_DEFS[e.type!].wallpass
    }
    if (this.bombAt(c, r)) return true
    return false
  }

  private boxHits(x: number, y: number, e: { x: number; y: number; isAI?: boolean; wallpassUntil?: number; type?: string }): boolean {
    const h = Game.HALF
    const c0 = Math.floor(x - h + 0.5), c1 = Math.floor(x + h + 0.5 - 1e-4)
    const r0 = Math.floor(y - h + 0.5), r1 = Math.floor(y + h + 0.5 - 1e-4)
    // tiles the entity's current box already overlaps (bomb exit tolerance)
    const pc0 = Math.floor(e.x - h + 0.5), pc1 = Math.floor(e.x + h + 0.5 - 1e-4)
    const pr0 = Math.floor(e.y - h + 0.5), pr1 = Math.floor(e.y + h + 0.5 - 1e-4)
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (!this.tileSolidFor(e, c, r)) continue
        // a bomb the entity is already standing in doesn't block the way out
        // (entry is still blocked; this only lets a mid-tile bomb drop phase out)
        if (this.bombAt(c, r) && c >= pc0 && c <= pc1 && r >= pr0 && r <= pr1) continue
        return true
      }
    return false
  }

  /** Attempt a free-space move; returns false (no move) if blocked. */
  tryMove(ent: { x: number; y: number; isAI?: boolean }, dx: number, dy: number): boolean {
    if (dx === 0 && dy === 0) return false
    const nx = ent.x + dx, ny = ent.y + dy
    if (this.boxHits(nx, ny, ent)) return false
    if (ent.isAI !== undefined) {
      // players block each other (AABB overlap)
      for (const other of this.players) {
        if (other === ent || !other.alive) continue
        if (Math.abs(nx - other.x) < 0.55 && Math.abs(ny - other.y) < 0.55) return false
      }
    }
    ent.x = nx; ent.y = ny
    return true
  }

  moveEntity(e: { x: number; y: number; dir: Dir; moving: boolean; movingDir: Dir | null; speed: number; isAI?: boolean }, dt: number) {
    const d = e.movingDir
    if (d === null) { e.moving = false; return }
    e.dir = d
    const [vx, vy] = dirVec(d)
    const step = e.speed * dt
    const p = e.isAI !== undefined ? (e as PlayerState) : null
    let blocked = true
    if (vx !== 0) {
      // ease y back to the row centre first, then slide along it.
      // Sequential (not combined): a pure snap self-resolves around brick
      // corners that a diagonal move would wedge against.
      let s = Math.round(e.y) - e.y
      if (Math.abs(s) > step) s = Math.sign(s) * step
      if (Math.abs(s) > 0.001) this.tryMove(e, 0, s)
      blocked = !this.tryMove(e, vx * step, 0)
    } else {
      let s = Math.round(e.x) - e.x
      if (Math.abs(s) > step) s = Math.sign(s) * step
      if (Math.abs(s) > 0.001) this.tryMove(e, s, 0)
      blocked = !this.tryMove(e, 0, vy * step)
    }
    if (blocked && p) this.tryKickForward(p)
    e.moving = !blocked
  }

  /** KICK powerup: bumping into a bomb sends it sliding one tile further. */
  private tryKickForward(p: PlayerState) {
    if (p.kickUntil <= this.time) return
    const [dc, dr] = dirVec(p.dir)
    // tile the player is pushing into (front of the box, not rounded centre)
    const tc = Math.round(p.x + dc * 0.35)
    const tr = Math.round(p.y + dr * 0.35)
    const b = this.bombAt(tc, tr)
    if (!b) return
    const kc = tc + dc, kr = tr + dr
    if (this.tile(kc, kr) === T_WALK && !this.bombAt(kc, kr) && !this.enemyAt(kc, kr)) {
      b.col = kc; b.row = kr
      audio.play('kick')
      this.particles.text(kc * 48 + 24, kr * 48 + 12, 'KICK!', '#ffab91')
      this.particles.dust(kc * 48 + 24, kr * 48 + 24)
    }
  }

  levelClear() {
    if (this.state !== 'playing') return
    this.state = 'levelclear'
    this.clearTimer = 2.2
    const bonus = Math.floor(this.levelTime - this.time) * 10
    this.score += bonus
    if (this.level % 4 === 0) this.lives++
    this.flash('120,255,200', 0.35, 0.5)
    audio.play('levelClear')
    this.emit('levelclear', { level: this.level, bonus, score: this.score, lives: this.lives })
  }

  killPlayer(p: PlayerState, cause: 'flame' | 'enemy') {
    if (p.invincibleUntil > this.time && cause === 'enemy') return
    p.alive = false
    // lose timed powerups on death
    p.shieldUntil = 0; p.wallpassUntil = 0; p.kickUntil = 0
    const cx = p.x * 48 + 24, cy = p.y * 48 + 24
    this.particles.burst(cx, cy, p.color, 26, 220)
    this.particles.burst(cx, cy, '#ffffff', 12, 140)
    this.shake(10, 0.4)
    audio.play('hurt')
    haptic(90, 0.6, 0.9) // sharp double-thump feel for taking a hit
    if (this.mode === 'battle') {
      p.respawnIn = 2.5
      this.lastKiller = -1
      // credit kill to opponent (unless sudden-death bomb or mutual kill)
      const opp = this.players.find(q => q.id !== p.id)
      const suddenBomb = this.bombs.some(b => b.owner === -1)
      if (opp && opp.alive && !suddenBomb) {
        opp.kills++
        this.score += 1000
        this.particles.text(cx, cy - 24, 'KILL!', opp.color)
        this.flash('255,46,136', 0.08, 0.15)
      }
      this.emit('pdeath', { id: p.id })
    } else {
      this.lives--
      if (this.lives <= 0) {
        this.state = 'over'
        this.overTimer = 1.2
        audio.play('gameOver')
        this.emit('gameover', { score: this.score, level: this.level })
      } else {
        // respawn in place after delay
        this.emit('pdeath', { id: p.id })
        p.respawnIn = 1.8
      }
    }
  }

  respawnPlayer(p: PlayerState) {
    const s = this.def.playerSpawns[p.id] ?? { col: 1, row: 1 }
    p.alive = true
    p.col = s.col; p.row = s.row; p.x = s.col; p.y = s.row
    p.moving = false; p.movingDir = null; p.dir = 0
    p.invincibleUntil = this.time + SPAWN_INVULN / 1000
    p.shieldUntil = 0; p.wallpassUntil = 0; p.kickUntil = 0
    audio.play('spawn')
  }

  pickupPowerups(p: PlayerState) {
    const i = this.powerups.findIndex(u => u.col === p.col && u.row === p.row)
    if (i < 0) return
    const u = this.powerups[i]
    this.powerups.splice(i, 1)
    audio.play('powerup')
    this.score += 100
    const cx = p.x * 48 + 24, cy = p.y * 48 + 16
    this.particles.burst(cx, cy, POWERUP_DEFS[u.kind].color, 16, 140)
    switch (u.kind) {
      case 'bomb': p.bombs = Math.min(MAX_BOMBS, p.bombs + 1); this.particles.text(cx, cy, 'BOMB +1', '#ff5252'); break
      case 'flame': p.flame = Math.min(MAX_FLAME, p.flame + 1); this.particles.text(cx, cy, 'FLAME +1', '#ff9800'); break
      case 'speed':
        if (p.speed < PLAYER_BASE_SPEED + PLAYER_SPEED_STEP * PLAYER_MAX_SPEED_LEVELS) {
          p.speed += PLAYER_SPEED_STEP
          this.particles.text(cx, cy, 'SPEED +1', '#4dd0e1')
        } else { this.score += 500; this.particles.text(cx, cy, '+500', '#4dd0e1') }
        break
      case 'shrink': p.bombs = Math.max(1, p.bombs - 1); this.particles.text(cx, cy, 'BOMB -1', '#9575cd'); break
      case 'shrinkf': p.flame = Math.max(1, p.flame - 1); this.particles.text(cx, cy, 'FLAME -1', '#7986cb'); break
      case 'shield': p.shieldUntil = this.time + SHIELD_DURATION / 1000; this.particles.text(cx, cy, 'SHIELD', '#69f0ae'); audio.play('shield'); break
      case 'invincible': p.invincibleUntil = this.time + INVINCIBLE_DURATION / 1000; this.particles.text(cx, cy, 'INVINCIBLE', '#ffd54a'); break
      case 'wallpass': p.wallpassUntil = this.time + WALLPASS_DURATION / 1000; this.particles.text(cx, cy, 'WALL PASS', '#f48fb1'); break
      case 'freeze':
        if (this.mode === 'battle') {
          const opp = this.players.find(q => q.id !== p.id)
          if (opp) {
            opp.frozenUntil = this.time + 3
            this.particles.text(opp.x * 48 + 24, opp.y * 48 + 16, 'STUNNED!', '#80deea')
          }
        } else {
          this.freezeUntil = this.time + FREEZE_DURATION / 1000
        }
        this.particles.text(cx, cy, 'FREEZE!', '#80deea')
        audio.play('freeze')
        break
      case 'kick': p.kickUntil = this.time + KICK_DURATION / 1000; this.particles.text(cx, cy, 'KICK', '#ffab91'); break
      case 'life': this.lives++; this.particles.text(cx, cy, 'EXTRA LIFE!', '#fff176'); break
    }
    this.emit('powerup', { kind: u.kind, player: p.id })
  }

  // ---------------- enemies ----------------

  updateEnemies(dt: number) {
    const frozen = this.freezeUntil > this.time
    const speedMul = (this.suddenDeath ? 1.3 : 1) * (1 + (this.level - 1) * 0.02)
    const target = this.mode === 'campaign' ? this.players[0] : undefined
    for (const e of this.enemies) {
      if (!e.alive) continue
      if (frozen) { e.frozen = true; continue }
      e.frozen = false
      const def = ENEMY_DEFS[e.type]
      e.aiTimer -= dt
      // decide direction on tile arrival (moveTimer used as decision cadence)
      const speed = def.speed * ENEMY_SPEED_SCALE * speedMul * (e.frozen ? 0 : 1)
      this.moveEnemy(e, dt, speed, def, target)
      // derive the tile the enemy occupies (flame check, AI, rendering)
      e.col = Math.round(e.x); e.row = Math.round(e.y)
    }
    // flame deaths
    const flame = this.flameSet()
    for (const e of this.enemies) {
      if (e.alive && flame.has(key(e.col, e.row))) {
        this.killEnemy(e, null, false)
      }
    }
  }

  moveEnemy(e: EnemyState, dt: number, speed: number, def: EnemyDef, target: PlayerState | undefined) {
    // not moving: (re)choose a target tile (wanderers pause between tiles)
    if (!e.moving) {
      if (e.aiTimer <= 0) {
        e.dir = this.enemyDecide(e, def, target)
        const [dc, dr] = dirVec(e.dir)
        if (this.canEnter(e, e.col + dc, e.row + dr)) {
          e.tx = e.col + dc; e.ty = e.row + dr
          e.moving = true
        } else {
          e.aiTimer = 0.15 // blocked: redecide shortly
        }
      }
      return
    }
    // slide toward the target tile centre (free space, collision-checked)
    const step = speed * dt
    const ddx = e.tx - e.x, ddy = e.ty - e.y
    const adx = Math.abs(ddx), ady = Math.abs(ddy)
    const dx = adx >= ady ? Math.sign(ddx) * Math.min(adx, step) : 0
    const dy = ady > adx ? Math.sign(ddy) * Math.min(ady, step) : 0
    if (!this.tryMove(e, dx, dy) && adx + ady > 1e-4) {
      // something new is in the way — stall and redecide from current tile
      e.moving = false
      e.aiTimer = 0
      return
    }
    if (Math.abs(e.tx - e.x) < 0.02 && Math.abs(e.ty - e.y) < 0.02) {
      e.x = e.tx; e.y = e.ty
      if (def.ai === 'wander') {
        // wanderers pause between tiles (deliberate loping gait)
        e.moving = false
        e.aiTimer = 0.8 + e.seed * 1.8
        return
      }
      // chasers: pick the next tile and continue — no per-tile stop
      e.dir = this.enemyDecide(e, def, target)
      const [dc, dr] = dirVec(e.dir)
      if (this.canEnter(e, e.col + dc, e.row + dr)) {
        e.tx = e.col + dc; e.ty = e.row + dr
      } else {
        e.moving = false
        e.aiTimer = 0
      }
    }
  }

  enemyDecide(e: EnemyState, def: EnemyDef, target: PlayerState | undefined): Dir {
    const dirs: Dir[] = [0, 1, 2, 3]
    const options = dirs.filter(d => {
      const [dc, dr] = dirVec(d)
      return this.canEnter(e, e.col + dc, e.row + dr)
    })
    if (options.length === 0) return e.dir
    // prefer non-reverse
    const reverse = ((e.dir + 2) % 4) as Dir
    const pref = options.filter(d => d !== reverse)
    const pool = pref.length ? pref : options

    if (!target || !target.alive) {
      return pool[Math.floor(Math.random() * pool.length)]
    }
    const dx = target.col - e.col
    const dy = target.row - e.row

    switch (def.ai) {
      case 'wander':
        return pool[Math.floor(Math.random() * pool.length)]
      case 'chaseY':
        if (dy !== 0 && Math.abs(dy) < 6) {
          const d = (dy > 0 ? 2 : 3) as Dir
          if (pool.includes(d)) return d
        }
        return pool[Math.floor(Math.random() * pool.length)]
      case 'chaseX':
        if (dx !== 0 && Math.abs(dx) < 6) {
          const d = (dx > 0 ? 0 : 1) as Dir
          if (pool.includes(d)) return d
        }
        return pool[Math.floor(Math.random() * pool.length)]
      case 'chase':
        if (dx !== 0 && dy === 0) {
          const d = (dx > 0 ? 0 : 1) as Dir
          if (pool.includes(d)) return d
        } else if (dy !== 0 && dx === 0) {
          const d = (dy > 0 ? 2 : 3) as Dir
          if (pool.includes(d)) return d
        }
        return pool[Math.floor(Math.random() * pool.length)]
      case 'flee':
        // half chase, half flee
        if (Math.random() < 0.5) {
          return this.enemyBfsStep(e, target) ?? pool[Math.floor(Math.random() * pool.length)]
        }
        let bestD = pool[0], bestScore = -1e9
        for (const d of pool) {
          const [dc, dr] = dirVec(d)
          const s = Math.abs(e.col + dc - target.col) + Math.abs(e.row + dr - target.row)
          if (s > bestScore) { bestScore = s; bestD = d }
        }
        return bestD
      case 'bfs':
        return this.enemyBfsStep(e, target) ?? pool[Math.floor(Math.random() * pool.length)]
    }
    return e.dir
  }

  enemyBfsStep(e: EnemyState, target: PlayerState): Dir | null {
    const path = this.bfs(e.col, e.row, target.col, target.row, ENEMY_DEFS[e.type].wallpass)
    if (!path || path.length === 0) return null
    const [dc, dr] = [path[0].x - e.col, path[0].y - e.row]
    if (dc === 1) return 0
    if (dc === -1) return 1
    if (dr === 1) return 2
    if (dr === -1) return 3
    return null
  }

  bfs(sc: number, sr: number, tc: number, tr: number, passSoft: boolean): { x: number; y: number }[] | null {
    if (sc === tc && sr === tr) return []
    const prev = new Map<number, number>()
    const q: number[] = [key(sc, sr)]
    const seen = new Set<number>(q)
    const MAX = 200
    let found = false
    while (q.length && q.length < MAX * 4) {
      const cur = q.shift()!
      const cx = cur % COLS, cy = Math.floor(cur / COLS)
      if (cx === tc && cy === tr) { found = true; break }
      for (const dv of DIRS) {
        const nx = cx + dv.x, ny = cy + dv.y
        if (nx < 1 || ny < 1 || nx >= COLS - 1 || ny >= ROWS - 1) continue
        const t = this.tile(nx, ny)
        if (t === T_HARD) continue
        if (t === T_SOFT && !passSoft) continue
        if (this.bombAt(nx, ny)) continue
        const k = key(nx, ny)
        if (seen.has(k)) continue
        seen.add(k)
        prev.set(k, cur)
        q.push(k)
      }
    }
    if (!found) return null
    const path: { x: number; y: number }[] = []
    let cur = key(tc, tr)
    while (cur !== key(sc, sr)) {
      path.push({ x: cur % COLS, y: Math.floor(cur / COLS) })
      const p = prev.get(cur)
      if (p === undefined) return null
      cur = p
    }
    path.reverse()
    return path
  }

  killEnemy(e: EnemyState, killer: PlayerState | null, smash: boolean) {
    if (!e.alive) return
    e.alive = false
    e.deadAt = this.time
    const def = ENEMY_DEFS[e.type]
    this.killChain++
    const pts = Math.min(10000, def.points * Math.pow(2, this.killChain - 1))
    this.score += pts
    if (killer) killer.kills++
    const cx = e.x * 48 + 24, cy = e.y * 48 + 24
    this.particles.burst(cx, cy, def.color, 20, 200)
    this.particles.burst(cx, cy, '#ffffff', 8, 120)
    this.particles.text(cx, cy - 10, `+${pts}`, '#ffd54a')
    if (this.killChain === 2) this.particles.text(360, 150, 'DOUBLE KILL!', '#ff2e88')
    else if (this.killChain === 3) this.particles.text(360, 150, 'TRIPLE KILL!', '#ffd54a')
    else if (this.killChain >= 4) this.particles.text(360, 150, `MEGA BLAST ×${this.killChain}!`, '#ff5252')
    if (this.killChain >= 2) audio.play('combo')
    audio.play('boom')
    if (smash) this.shake(6, 0.25)
    // screen flash escalates with the combo
    if (this.killChain === 2) this.flash('255,46,136', 0.10, 0.18)
    else if (this.killChain === 3) { this.flash('255,213,74', 0.16, 0.22); this.hitStop(0.15, 0.16) }
    else if (this.killChain >= 4) { this.flash('255,82,82', 0.24, 0.3); this.hitStop(0.1, 0.22) }
    // powerup drop: weighted by def.weight; guaranteed on the level's final enemy
    const enemiesLeft = this.enemies.filter(x => x.alive).length
    const chance = enemiesLeft === 0 ? 1 : POWERUP_DROP_CHANCE
    if (
      Math.random() < chance &&
      this.powerups.length < MAX_POWERUPS_ON_FIELD &&
      !this.powerups.some(u => u.col === e.col && u.row === e.row)
    ) {
      this.powerups.push({ col: e.col, row: e.row, kind: this.weightedPowerupKind(), born: this.time, revealed: true })
      this.particles.text(cx, cy - 26, 'ITEM!', '#fff176')
    }
  }

  /** pick a powerup kind using POWERUP_DEFS weights (bomb/flame common, life rare) */
  private weightedPowerupKind() {
    const total = POWERUP_KINDS.reduce((s, k) => s + POWERUP_DEFS[k].weight, 0)
    let r = Math.random() * total
    for (const k of POWERUP_KINDS) {
      r -= POWERUP_DEFS[k].weight
      if (r <= 0) return k
    }
    return POWERUP_KINDS[POWERUP_KINDS.length - 1]
  }

  // ---------------- bombs & flames ----------------

  updateBombs(dt: number) {
    for (const b of this.bombs) b.fuse -= dt * 1000
    for (const b of this.bombs.filter(b => b.fuse <= 0)) this.detonate(b)
  }

  detonate(b: BombState, chain = false) {
    const idx = this.bombs.indexOf(b)
    if (idx >= 0) this.bombs.splice(idx, 1)
    const { col, row, power } = b
    const cx = col * 48 + 24, cy = row * 48 + 24
    this.particles.explosion(cx, cy)
    this.shake(7, 0.3)
    audio.play(power >= 4 ? 'boomBig' : 'boom')
    haptic(power >= 4 ? 130 : 70, power >= 4 ? 1 : 0.7, 0.5)
    if (!chain) this.killChain = 0
    const queue: BombState[] = []
    // core
    this.flames.push({ col, row, dir: -1, ttl: FLAME_DURATION / 1000, seed: Math.random() })
    for (let d = 0; d < 4; d++) {
      const [dc, dr] = dirVec(d as Dir)
      for (let i = 1; i <= power; i++) {
        const c = col + dc * i, r = row + dr * i
        const t = this.tile(c, r)
        if (t === T_HARD) break
        if (t === T_SOFT) { this.destroyBrick(c, r); break }
        const hit = this.bombAt(c, r)
        if (hit && !queue.includes(hit)) {
          queue.push(hit)
          this.flames.push({ col: c, row: r, dir: d, ttl: FLAME_DURATION / 1000, seed: Math.random() })
          break
        }
        this.flames.push({ col: c, row: r, dir: d, ttl: FLAME_DURATION / 1000, seed: Math.random() })
      }
    }
    // powerups in flame path are destroyed
    const flameKeys = new Set(this.flames.map(f => key(f.col, f.row)))
    this.powerups = this.powerups.filter(u => {
      if (flameKeys.has(key(u.col, u.row))) {
        const { x, y } = { x: u.col * 48 + 24, y: u.row * 48 + 24 }
        this.particles.burst(x, y, '#888', 8, 80)
        return false
      }
      return true
    })
    // chain
    for (const qb of queue) this.detonate(qb, true)
  }

  destroyBrick(c: number, r: number) {
    this.grid[r][c].t = T_WALK
    this.score += 10
    const cx = c * 48 + 24, cy = r * 48 + 24
    this.particles.burst(cx, cy, '#b08050', 12, 150)
    // powerup hidden in this brick? reveal it
    const pi = this.powerups.findIndex(u => u.col === c && u.row === r)
    if (pi >= 0) {
      this.powerups[pi].revealed = true
      this.particles.burst(cx, cy, POWERUP_DEFS[this.powerups[pi].kind].color, 14, 140)
      this.particles.text(cx, cy - 16, 'ITEM!', POWERUP_DEFS[this.powerups[pi].kind].color)
    }
    // exit?
    if (this.exit.col === c && this.exit.row === r) {
      this.exit.revealed = true
      this.particles.burst(cx, cy, '#00e5ff', 20, 180)
      this.particles.text(cx, cy - 14, this.enemies.length === 0 ? 'EXIT!' : 'EXIT FOUND', '#00e5ff')
    }
  }

  updateFlames(dt: number) {
    for (let i = this.flames.length - 1; i >= 0; i--) {
      this.flames[i].ttl -= dt
      if (this.flames[i].ttl <= 0) this.flames.splice(i, 1)
    }
  }

  // ---------------- battle rules ----------------

  checkBattleOver() {
    if (this.mode !== 'battle' || this.state !== 'playing') return
    if (this.time > this.levelTime) return // sudden death handles it
    // no instant end (respawns), except sudden death win
  }

  battleSuddenDeath() {
    if (this.mode !== 'battle' || this.state !== 'playing') return
    // Target one player: drop the bomb on an open tile adjacent to them, so the
    // round resolves to a single kill rather than a double-kill draw (which
    // replays the whole round and drags matches out). Falls back to a random
    // open tile if no adjacent spot is free.
    const alive = this.players.filter(p => p.alive)
    if (!alive.length) return
    const p = alive[Math.floor(Math.random() * alive.length)]
    const free = (c: number, r: number) =>
      this.tile(c, r) === T_WALK && !this.bombAt(c, r) &&
      !this.players.some(pl => pl.alive && pl.col === c && pl.row === r)
    // shuffle the 4 neighbours of the target and take the first free one
    const neighbours = [0, 1, 2, 3].map(d => ({ c: p.col + DIRS[d].x, r: p.row + DIRS[d].y }))
    for (let i = neighbours.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[neighbours[i], neighbours[j]] = [neighbours[j], neighbours[i]]
    }
    let c = -1, r = -1
    for (const n of neighbours) if (free(n.c, n.r)) { c = n.c; r = n.r; break }
    if (c < 0) {
      for (let tries = 0; tries < 8; tries++) {
        c = 1 + Math.floor(Math.random() * (COLS - 2))
        r = 1 + Math.floor(Math.random() * (ROWS - 2))
        if (free(c, r)) break
      }
    }
    if (c < 0) return
    this.bombs.push({ id: this.bombId++, owner: -1, col: c, row: r, fuse: 1500, power: 2, born: this.time })
    audio.play('bomb')
  }

  endBattle(winner: number | -1) {
    if (this.mode !== 'battle') return
    // award the round (a draw replays the round)
    if (winner >= 0) this.roundWins[winner]++
    const done = winner >= 0 && this.roundWins[winner] >= BATTLE_ROUND_TARGET
    if (!done) {
      this.emit('roundwin', { winner, round: this.round, roundWins: [...this.roundWins] })
      this.startRound()
      return
    }
    this.state = 'battleover'
    this.winner = winner
    this.emit('battleover', { winner, roundWins: [...this.roundWins] })
    if (winner >= 0) audio.play('levelClear')
    else audio.play('gameOver')
  }

  /** battle: start the next round (fresh map, stats persist) */
  startRound() {
    this.round++
    this.def = generateBattleMap()
    this.grid = this.def.grid
    this.bombs = []
    this.flames = []
    this.powerups = this.def.powerups.map(u => ({ ...u, born: 0, revealed: false }))
    this.enemies = []
    this.time = 0
    this.suddenDeath = false
    this.suddenTick = 0
    this.battleNextItem = 12
    this.killChain = 0
    this.aiState.clear()
    for (const p of this.players) {
      const s = this.def.playerSpawns[p.id] ?? { col: 1, row: 1 }
      p.alive = true
      p.col = s.col; p.row = s.row; p.x = s.col; p.y = s.row
      p.moving = false; p.movingDir = null; p.dir = 0
      p.invincibleUntil = this.time + SPAWN_INVULN / 1000
      p.shieldUntil = 0; p.wallpassUntil = 0; p.kickUntil = 0
      p.frozenUntil = 0
      p.respawnIn = 0
    }
    this.state = 'playing'
    this.particles.clear()
    this.emit('roundstart', { round: this.round, roundWins: [...this.roundWins] })
  }

  // ---------------- main update ----------------

  update(dt: number, inputs: { p1: { dir: Dir | null; bomb: boolean; detonate: boolean }; p2: { dir: Dir | null; bomb: boolean; detonate: boolean } }) {
    if (this.state === 'levelclear') {
      this.clearTimer -= dt
      this.updateFlames(dt)
      this.particles.update(dt)
      if (this.clearTimer <= 0) {
        this.emit('nextlevel', { level: this.level + 1 })
        this.nextLevel()
      }
      this.updateShake(dt)
      return
    }
    if (this.state === 'over' || this.state === 'battleover') {
      this.overTimer -= dt
      this.updateFlames(dt)
      this.updateBombs(dt)
      this.particles.update(dt)
      this.updateShake(dt)
      return
    }

    // hit-stop: scale the simulation clock (particles/shake stay real-time)
    const gdt = dt * this.timeScale
    this.time += gdt

    // level timer
    const remaining = this.levelTime - this.time
    if (this.mode === 'campaign') {
      if (remaining <= 30 && !this.suddenDeath) {
        this.suddenDeath = true
        this.emit('suddendeath')
      }
      if (this.suddenDeath) {
        this.suddenTick -= gdt
        if (this.suddenTick <= 0) {
          this.suddenTick = 3.5
          // remove a random soft brick
          const softs: { c: number; r: number }[] = []
          for (let r = 1; r < ROWS - 1; r++)
            for (let c = 1; c < COLS - 1; c++)
              if (this.grid[r][c].t === T_SOFT) softs.push({ c, r })
          if (softs.length) {
            const s = softs[Math.floor(Math.random() * softs.length)]
            this.destroyBrick(s.c, s.r)
          }
        }
      }
    } else {
      if (remaining <= 0 && !this.suddenDeath) {
        this.suddenDeath = true
        this.emit('suddendeath')
      }
      if (this.suddenDeath) {
        this.suddenTick -= gdt
        if (this.suddenTick <= 0) {
          this.suddenTick = 2
          this.battleSuddenDeath()
        }
      }
      // battle: periodic item drops on open tiles (no enemies to kill, so
      // campaign's kill-drops never happen here; AI already hunts these)
      this.battleNextItem -= gdt
      if (this.battleNextItem <= 0 && this.state === 'playing') {
        this.battleNextItem = 16 + Math.random() * 8
        const spots: { c: number; r: number }[] = []
        for (let r = 1; r < ROWS - 1; r++)
          for (let c = 1; c < COLS - 1; c++) {
            if (this.tile(c, r) !== T_WALK) continue
            if (this.bombAt(c, r)) continue
            if (this.players.some(p => p.alive && p.col === c && p.row === r)) continue
            if (this.powerups.some(u => u.col === c && u.row === r)) continue
            spots.push({ c, r })
          }
        if (spots.length) {
          const s = spots[Math.floor(Math.random() * spots.length)]
          this.powerups.push({ col: s.c, row: s.r, kind: this.weightedPowerupKind(), born: this.time, revealed: true })
        }
      }
    }

    // input for players
    const ins = this.players.map(p =>
      p.isAI ? this.aiThink(p) : (p.id === 0 ? inputs.p1 : inputs.p2))
    // snapshot positions for render interpolation (renderer lerps prev→cur)
    for (const p of this.players) { p.prevX = p.x; p.prevY = p.y }
    for (const e of this.enemies) { e.prevX = e.x; e.prevY = e.y }
    this.updatePlayers(gdt, ins)

    this.updateEnemies(gdt)
    this.updateBombs(gdt)
    this.updateFlames(gdt)
    this.particles.update(dt)
    this.updateShake(dt)

    // exit progress
    const p0 = this.players[0]
    if (this.mode === 'campaign' && this.state === 'playing' && this.exit.revealed
      && this.enemies.every(e => !e.alive) && p0.alive
      && p0.col === this.exit.col && p0.row === this.exit.row) {
      this.exitTimer += gdt
      if (this.exitTimer > 0.6) this.levelClear()
    } else this.exitTimer = 0

    // battle sudden death end check
    if (this.mode === 'battle' && this.suddenDeath) {
      const alive = this.players.filter(p => p.alive)
      if (alive.length === 1 && this.bombs.length === 0) {
        this.endBattle(alive[0].id)
      }
      if (alive.length === 0) this.endBattle(-1)
    }
  }

  updateShake(dt: number) {
    if (this.shakeT > 0) {
      this.shakeT -= dt
      if (this.shakeT <= 0) { this.shakeMag = 0; this.shakeDur = 0 }
    }
    if (this.flashT > 0) {
      this.flashT -= dt
      if (this.flashT <= 0) { this.flashMag = 0; this.flashDur = 0 }
    }
    // recover hit-stop toward normal speed
    if (this.timeScale < 1) {
      this.timeScaleT -= dt
      if (this.timeScaleT <= 0) this.timeScale = 1
    }
  }

  getShakeOffset(): { x: number; y: number } {
    if (this.shakeT <= 0) return { x: 0, y: 0 }
    const m = this.shakeMag * (this.shakeT / this.shakeDur)
    return {
      x: (Math.random() * 2 - 1) * m,
      y: (Math.random() * 2 - 1) * m,
    }
  }

  // ---------------- AI (battle bot + attract) ----------------

  private aiState = new Map<number, { path: { x: number; y: number }[]; repath: number; sx: number; sy: number }>()

  aiThink(p: PlayerState): { dir: Dir | null; bomb: boolean; detonate: boolean } {
    const out = { dir: null as Dir | null, bomb: false, detonate: false }
    if (!p.alive) return out
    const enemy = this.players.find(q => q.id !== p.id && q.alive)
    // nearest living enemy (campaign)
    let nearest: { col: number; row: number } | null = null
    let nearestD = 999
    if (enemy) {
      nearest = { col: enemy.col, row: enemy.row }
      nearestD = Math.abs(enemy.col - p.col) + Math.abs(enemy.row - p.row)
    } else if (this.mode === 'campaign') {
      for (const e of this.enemies) if (e.alive) {
        const d = Math.abs(e.col - p.col) + Math.abs(e.row - p.row)
        if (d < nearestD) { nearestD = d; nearest = { col: e.col, row: e.row } }
      }
    }
    if (!enemy && !nearest && this.mode !== 'campaign') return out

    // 1. bomb decisions (before the threat override, which flees the blast)
    const myBombs = this.bombs.filter(b => b.owner === p.id)
    if (enemy) {
      const distEnemy = Math.abs(enemy.col - p.col) + Math.abs(enemy.row - p.row)
      const inLine = enemy.col === p.col || enemy.row === p.row
      const canBomb = !this.bombAt(p.col, p.row) && myBombs.length < p.bombs && this.blastEscape(p)
      // trap: opponent hemmed into a dead-end on our line — bomb to cut the exit
      if (inLine && distEnemy >= 1 && distEnemy <= p.flame
        && this.openNeighbors(enemy.col, enemy.row) <= 1 && canBomb) {
        out.bomb = true
      } else if (distEnemy >= 2 && distEnemy <= p.flame + 1 && canBomb
        && Math.random() < 0.85) { // reaction jitter: break perfect symmetry
        out.bomb = true
      } else if (inLine && distEnemy >= 1 && distEnemy <= p.flame - 1 && canBomb) {
        // cut: blast a brick behind the opponent to shrink their escape routes
        const sdc = Math.sign(enemy.col - p.col), sdr = Math.sign(enemy.row - p.row)
        if (this.tile(enemy.col + sdc, enemy.row + sdr) === T_SOFT) out.bomb = true
      }
      if (myBombs.length) {
        const b = myBombs.sort((a, b) => a.born - b.born)[0]
        // early-detonate only when it won't also kill us
        if (this.bombHits(b, enemy.col, enemy.row) && !this.bombHits(b, p.col, p.row)) out.detonate = true
      }
    } else if (nearest) {
      // campaign: bomb any enemy lined up within flame range
      if (!this.bombAt(p.col, p.row) && myBombs.length < p.bombs && this.blastEscape(p)) {
        for (const e of this.enemies) {
          if (!e.alive) continue
          const dc = e.col - p.col, dr = e.row - p.row
          if (!((dc !== 0 && dr === 0) || (dc === 0 && dr !== 0))) continue
          const steps = Math.abs(dc) + Math.abs(dr)
          if (steps > p.flame) continue
          let clear = true
          const sdc = Math.sign(dc), sdr = Math.sign(dr)
          for (let i = 1; i <= steps - 1; i++)
            if (this.tile(p.col + sdc * i, p.row + sdr * i) !== T_WALK) { clear = false; break }
          if (clear) { out.bomb = true; break }
        }
      }
    }

    // 2. immediate danger override (may also plant an escape route in aiState)
    const threat = this.threatDir(p, out.bomb)
    if (threat !== null) {
      return { ...out, dir: threat }
    }

    // 3. path following (replan periodically — and whenever the player's
    // derived tile changes, so the path is always anchored ahead of the
    // free-moving position)
    let st = this.aiState.get(p.id)
    // while inside our own bomb's blast, keep the escape route (a repath to
    // the pursuit target would lead straight back into the flame)
    const inOwnBlast = this.bombs.some(b => b.owner === p.id
      && this.blastSet(b.col, b.row, b.power).has(key(p.col, p.row)))
    if (!st || this.time > st.repath || ((st.sx !== p.col || st.sy !== p.row) && !inOwnBlast)) {
      let target: { c: number; r: number }
      if (enemy) {
        // battle: hunt the opponent
        target = { c: enemy.col, r: enemy.row }
        if (!out.bomb && nearestD < 2) {
          // point-blank: back off — a bomb here is a mutual kill
          if (nearestD === 0) {
            // sharing a tile: step to a random open neighbour
            const opts: [number, number][] = []
            for (const [dc, dr] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
              const cc = p.col + dc, rr = p.row + dr
              if (this.canEnter(p, cc, rr)) opts.push([cc, rr])
            }
            const o = opts[Math.floor(Math.random() * opts.length)]
            target = o ? { c: o[0], r: o[1] } : { c: enemy.col, r: enemy.row }
          } else {
            target = {
              c: Math.max(1, Math.min(COLS - 2, p.col + (p.col - enemy.col) * 2)),
              r: Math.max(1, Math.min(ROWS - 2, p.row + (p.row - enemy.row) * 2)),
            }
          }
        } else if (nearestD > 6) {
          // far away: detour for a nearby powerup (flame first — longer flame = kills)
          let best = 99, bestPrio = 9
          for (const u of this.powerups) {
            const d = Math.abs(u.col - p.col) + Math.abs(u.row - p.row)
            if (d >= 8) continue
            const prio = (u.kind === 'flame' && p.flame < 3) ? 0 : 1
            if (prio < bestPrio || (prio === bestPrio && d < best)) {
              bestPrio = prio; best = d; target = { c: u.col, r: u.row }
            }
          }
        }
      } else if (this.mode === 'campaign' && !nearest) {
        target = { c: this.exit.col, r: this.exit.row }
      } else {
        // priority: flame (can't kill with weak flame) > bomb > other powerup >
        // nearest enemy; engage a very close enemy over powerup hunting
        target = nearest ? { c: nearest.col, r: nearest.row } : { c: this.exit.col, r: this.exit.row }
        let best = 99, bestPrio = 9
        const wantFlame = p.flame < 3
        const wantBomb = p.bombs < 2
        for (const u of this.powerups) {
          const d = Math.abs(u.col - p.col) + Math.abs(u.row - p.row)
          if (d >= 12) continue
          const prio = (u.kind === 'flame' && wantFlame) ? 0
            : (u.kind === 'bomb' && wantBomb) ? 1 : 2
          if (prio < bestPrio || (prio === bestPrio && d < best)) {
            bestPrio = prio; best = d; target = { c: u.col, r: u.row }
          }
        }
        if (nearest && nearestD <= 4) target = { c: nearest.col, r: nearest.row }
      }
      const path = this.bfs(p.col, p.row, target.c, target.r, true) ?? []
      st = { path, repath: this.time + 0.5, sx: p.col, sy: p.row }
      this.aiState.set(p.id, st)
    }
    // path starts at the player's own tile — skip it; also skip any waypoint
    // the player has already passed (free movement straddles tile centres)
    while (st.path.length && st.path[0].x === p.col && st.path[0].y === p.row) st.path.shift()
    while (st.path.length) {
      const h = st.path[0], n = st.path[1]
      const dh = (h.x - p.x) ** 2 + (h.y - p.y) ** 2
      if (dh < 0.12) { st.path.shift(); continue } // arrived
      if (n) {
        const dn = (n.x - p.x) ** 2 + (n.y - p.y) ** 2
        if (dn < dh) { st.path.shift(); continue } // head is behind us
      }
      break
    }
    if (st.path.length) {
      // face the waypoint from the actual (free) position, dominant axis first
      const dx = st.path[0].x - p.x, dy = st.path[0].y - p.y
      const nd = (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 1) : (dy > 0 ? 2 : 3)) as Dir
      const [mc, mr] = dirVec(nd)
      const nc = p.col + mc, nrr = p.row + mr
      // brick on the path: bomb it (own-tile bomb burns adjacent bricks)
      if (this.tile(nc, nrr) === T_SOFT && !this.bombAt(p.col, p.row) && myBombs.length < p.bombs && this.blastEscape(p)) {
        out.bomb = true
      } else {
        out.dir = nd
      }
    } else {
      // no usable path (target unreachable): wander until the next repath
      out.dir = Math.floor(Math.random() * 4) as Dir
      st.repath = Math.max(st.repath, this.time + 0.3)
    }
    // if we're about to bomb, pre-plan the way out of the blast so the
    // pursuit path can't lead us back into our own flame
    if (out.bomb) {
      const route = this.escapeRoute(p, this.blastSet(p.col, p.row, p.flame))
      if (route) this.aiState.set(p.id, { path: route, repath: this.time + 0.5, sx: p.col, sy: p.row })
    }
    return out
  }

  /** tiles covered if a bomb of power `pow` detonates at (c, r) */
  private blastSet(c: number, r: number, pow: number): Set<number> {
    const s = new Set<number>([key(c, r)])
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let i = 1; i <= pow; i++) {
        const cc = c + dc * i, rr = r + dr * i
        const t = this.tile(cc, rr)
        if (t === T_HARD) break
        if (t === T_SOFT) { s.add(key(cc, rr)); break }
        s.add(key(cc, rr))
      }
    }
    return s
  }

  /** shortest route (tile list, start excluded) from p's tile to a tile
   *  outside `blast`; null if p is already clear or no route exists */
  private escapeRoute(p: PlayerState, blast: Set<number>): { x: number; y: number }[] | null {
    const startK = key(p.col, p.row)
    if (!blast.has(startK)) return null
    const q: number[] = [startK]
    const came = new Map<number, number>()
    const seen = new Set<number>([startK])
    let safeK = -1
    while (q.length && safeK < 0) {
      const k = q.shift()!
      if (!blast.has(k)) { safeK = k; break }
      const c = k % COLS, r = Math.floor(k / COLS)
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr
        const nk = key(nc, nr)
        if (seen.has(nk) || !this.canEnter(p, nc, nr)) continue
        seen.add(nk); came.set(nk, k); q.push(nk)
      }
    }
    if (safeK < 0) return null
    const route: { x: number; y: number }[] = []
    let k = safeK
    while (k !== startK) {
      route.unshift({ x: k % COLS, y: Math.floor(k / COLS) })
      k = came.get(k)!
    }
    return route
  }

  private threatDir(p: PlayerState, justBombed: boolean): Dir | null {
    // imminent danger = live flames + tiles soon-to-be bombs will cover
    const soon = this.flameSet()
    for (const b of this.bombs) {
      if (b.fuse > 1500) continue
      soon.add(key(b.col, b.row))
      for (const [dc2, dr2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let i = 1; i <= b.power; i++) {
          const c = b.col + dc2 * i, r = b.row + dr2 * i
          const t = this.tile(c, r)
          if (t === T_HARD) break
          if (t === T_SOFT) { soon.add(key(c, r)); break }
          soon.add(key(c, r))
        }
      }
    }
    const [dc, dr] = dirVec(p.dir)
    const safe = (q: Dir): boolean => {
      const [c2, r2] = dirVec(q)
      const nc = p.col + c2, nr = p.row + r2
      return this.canEnter(p, nc, nr) && !soon.has(key(nc, nr))
        && !this.enemies.some(e => e.alive && e.col === nc && e.row === nr)
    }
    // nearby enemy: flee only from uncontrolled approaches. An enemy in a
    // straight line is controllable (bomb it, or back off along the line), so
    // we don't panic-flee those — we only flee diagonal/close threats.
    const near = this.enemies.find(e => e.alive && Math.abs(e.col - p.col) + Math.abs(e.row - p.row) <= 3)
    if (near) {
      const d = Math.abs(near.col - p.col) + Math.abs(near.row - p.row)
      const inLine = near.col === p.col || near.row === p.row
      const bombable = justBombed && inLine && d <= p.flame
      const mustFlee = (d <= 1 && !(inLine && d <= p.flame)) || (d === 2 && !inLine)
      if (!bombable && mustFlee) {
        let best: Dir | null = null, bestScore = -Infinity
        for (const q of [0, 1, 2, 3] as Dir[]) {
          if (!safe(q)) continue
          const [c2, r2] = dirVec(q)
          const nc = p.col + c2, nr = p.row + r2
          const dist = Math.abs(nc - near.col) + Math.abs(nr - near.row)
          const score = dist * 3 + this.openNeighbors(nc, nr)
          if (score > bestScore) { bestScore = score; best = q }
        }
        if (!best) for (const q of [2, 3, 0, 1] as Dir[]) if (safe(q)) { best = q; break }
        if (best) { this.aiState.delete(p.id); return best }
      }
    }
    // on fire / about to be on fire: plan the shortest route to a tile
    // outside the blast and follow it — a greedy one-tile flee can loop
    // inside the blast (every neighbour also ablaze) and burn with it
    if (soon.has(key(p.col, p.row)) || soon.has(key(p.col + dc, p.row + dr))) {
      const route = this.escapeRoute(p, soon)
      if (route) {
        this.aiState.set(p.id, { path: route, repath: this.time + 0.5, sx: p.col, sy: p.row })
        const h = route[0]
        const dx = h.x - p.x, dy = h.y - p.y
        return (Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 1) : (dy > 0 ? 2 : 3)) as Dir
      }
      // only the forward tile is threatened: back off
      const back = ((p.dir + 2) % 4) as Dir
      const [bc, br] = dirVec(back)
      if (this.canEnter(p, p.col + bc, p.row + br) && !soon.has(key(p.col + bc, p.row + br))) return back
    }
    return null
  }

  private bombHits(b: BombState, c: number, r: number): boolean {
    if (b.col === c && b.row === r) return true
    if (b.col !== c && b.row !== r) return false
    const dc = Math.sign(c - b.col), dr = Math.sign(r - b.row)
    const steps = Math.abs(c - b.col) + Math.abs(r - b.row)
    for (let i = 1; i <= steps; i++) {
      const cc = b.col + dc * i, rr = b.row + dr * i
      const t = this.tile(cc, rr)
      if (t === T_HARD || t === T_SOFT) return false
      if (this.bombAt(cc, rr)) return false
    }
    return steps <= b.power
  }

  /** count walkable, unoccupied neighbour tiles (0-4) — used to avoid corners */
  private openNeighbors(c: number, r: number): number {
    let n = 0
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr
      if (cc < 1 || rr < 1 || cc >= COLS - 1 || rr >= ROWS - 1) continue
      const t = this.tile(cc, rr)
      if (t === T_HARD || t === T_SOFT) continue
      if (this.bombAt(cc, rr)) continue
      if (this.enemies.some(e => e.alive && e.col === cc && e.row === rr)) continue
      n++
    }
    return n
  }

  /** true if, after placing a bomb on p's tile, p can physically get out:
   *  a route to a tile outside the blast of at most 3 tiles (the AI follows
   *  the escape route immediately — longer routes lose the race to the fuse
   *  when the pursuit path pulls back into the blast) */
  private blastEscape(p: PlayerState): boolean {
    const route = this.escapeRoute(p, this.blastSet(p.col, p.row, p.flame))
    return route !== null && route.length <= 3
  }
}
