import {
  COLS, ROWS, T_WALK, T_HARD, T_SOFT, DIRS,
  PLAYER_BASE_SPEED, PLAYER_SPEED_STEP, PLAYER_MAX_SPEED_LEVELS,
  BOMB_FUSE, BOMB_FUSE_MIN, FLAME_DURATION, SPAWN_INVULN,
  SHIELD_DURATION, INVINCIBLE_DURATION, WALLPASS_DURATION, FREEZE_DURATION,
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
import { settings } from './storage'
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
  lastSuddenDetonation = 0 // time of the last sudden-death (owner -1) bomb detonation
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
      shieldUntil: 0, invincibleUntil: 0, wallpassUntil: 0,
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
    p.shieldUntil = 0; p.wallpassUntil = 0
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
    // sealed pocket: no AI entry (see sealedPocket / tileSolidFor)
    if (e.isAI !== undefined && this.sealedPocket(c, r)) return false
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
    // a stunned player can be hit, not strike: bomb/detonate are gated
    const stunned = p.frozenUntil > this.time
    if (bomb && !stunned) this.tryPlaceBomb(p)
    if (detonate && !stunned) {
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
      x: p.col, y: p.row, sliding: null,
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
    // a sealed pocket is solid for AI players even on its walkable centre
    // tile: the only entry is a brick (wallpass), and once the timed
    // wallpass expires the bot can never get out (see sealedPocket). Humans
    // keep the choice — it is their trap to spring
    if (e.isAI !== undefined && this.sealedPocket(c, r)) return true
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
        // a brick the entity is already standing in must not trap it: wallpass
        // can expire mid-tile (the box entered while bricks were passable),
        // and without this the box is wedged FOREVER — every candidate step
        // overlaps the now-solid brick, so all four canStep read false and the
        // bot stands pinned for the rest of the match. Entry is still blocked
        if (this.tile(c, r) === T_SOFT && c >= pc0 && c <= pc1 && r >= pr0 && r <= pr1) continue
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

  /** KICK is a permanent ability: bumping into a bomb sends it sliding
   *  across the stage until it hits a wall, brick, bomb, enemy or player. */
  private tryKickForward(p: PlayerState) {
    const [dc, dr] = dirVec(p.dir)
    // tile being pushed into: the one directly ahead of the player's centre
    // tile (the box stops ~0.06 short of the bomb tile, so probing from the
    // box edge can round back to the player's own tile)
    const tc = Math.round(p.x) + dc
    const tr = Math.round(p.y) + dr
    const b = this.bombAt(tc, tr)
    if (!b || b.sliding !== null) return
    b.sliding = p.dir
    b.x = b.col; b.y = b.row
    audio.play('kick')
    this.particles.text(tc * 48 + 24, tr * 48 + 12, 'KICK!', '#ffab91')
    this.particles.dust(tc * 48 + 24, tr * 48 + 24)
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
    p.shieldUntil = 0; p.wallpassUntil = 0
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
      // the sudden-death bomb is spliced out of `bombs` the same tick its flame
      // kills, so a time window (not a bomb scan) is the reliable check
      const suddenBomb = this.time - this.lastSuddenDetonation < 0.5
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
    if (this.bombAt(s.col, s.row)) return // spawn tile occupied by a live bomb — retry next tick
    p.alive = true
    p.col = s.col; p.row = s.row; p.x = s.col; p.y = s.row
    p.moving = false; p.movingDir = null; p.dir = 0
    p.invincibleUntil = this.time + SPAWN_INVULN / 1000
    p.shieldUntil = 0; p.wallpassUntil = 0
    p.frozenUntil = 0 // a stun must not survive death + respawn
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
    const reverse = (e.dir ^ 1) as Dir
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

  bfs(sc: number, sr: number, tc: number, tr: number, passSoft: boolean, avoid?: Set<number>, pocketFree?: boolean): { x: number; y: number }[] | null {
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
        // a sealed pocket is a one-way death trap for a timed-wallpass AI:
        // route AROUND it, never INTO it (see sealedPocket)
        if (pocketFree && this.sealedPocket(nx, ny)) continue
        if (this.bombAt(nx, ny)) continue
        const k = key(nx, ny)
        if (seen.has(k)) continue
        // never route through an imminent blast (flames / fuses about to run
        // out) — doing so is how the bot used to walk back into its own fire
        if (avoid && avoid.has(k)) continue
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

  /** pick a powerup kind using POWERUP_DEFS weights (bomb/flame common, life rare).
   *  Battle has no life system, so `life` is excluded there. */
  private weightedPowerupKind(excludeLife = false) {
    const kinds = excludeLife ? POWERUP_KINDS.filter(k => k !== 'life') : POWERUP_KINDS
    const total = kinds.reduce((s, k) => s + POWERUP_DEFS[k].weight, 0)
    let r = Math.random() * total
    for (const k of kinds) {
      r -= POWERUP_DEFS[k].weight
      if (r <= 0) return k
    }
    return kinds[kinds.length - 1]
  }

  // ---------------- bombs & flames ----------------

  updateBombs(dt: number) {
    this.updateBombSlides(dt)
    for (const b of this.bombs) b.fuse -= dt * 1000
    for (const b of this.bombs.filter(b => b.fuse <= 0)) this.detonate(b)
  }

  /** Kicked bombs slide until they collide with a wall, brick, bomb,
   *  enemy or player (classic Bomb Kick). */
  private updateBombSlides(dt: number) {
    const SPEED = 11 // tiles/second
    for (const b of this.bombs) {
      if (b.sliding === null) continue
      const [dc, dr] = dirVec(b.sliding)
      let step = SPEED * dt
      while (step > 1e-6) {
        const curC = Math.round(b.x), curR = Math.round(b.y)
        const aheadC = curC + dc, aheadR = curR + dr
        const t = this.tile(aheadC, aheadR)
        const blocked =
          t === T_HARD || t === T_SOFT ||
          this.bombAt(aheadC, aheadR) !== undefined ||
          this.enemyAt(aheadC, aheadR) !== undefined ||
          this.players.some(pl => pl.alive && Math.round(pl.x) === aheadC && Math.round(pl.y) === aheadR)
        if (blocked) {
          // stop flush against the obstacle: snap back to the current tile
          b.x = curC; b.y = curR
          b.col = curC; b.row = curR
          b.sliding = null
          break
        }
        const toNext = (aheadC - b.x) * dc + (aheadR - b.y) * dr
        const adv = Math.min(step, toNext)
        b.x += dc * adv; b.y += dr * adv
        step -= adv
        b.col = Math.round(b.x); b.row = Math.round(b.y)
      }
    }
  }

  detonate(b: BombState, chain = false) {
    const idx = this.bombs.indexOf(b)
    if (idx < 0) return // already chain-detonated this tick — no double blast
    this.bombs.splice(idx, 1)
    if (b.owner === -1) this.lastSuddenDetonation = this.time
    const { col, row, power } = b
    const cx = col * 48 + 24, cy = row * 48 + 24
    this.particles.explosion(cx, cy)
    this.shake(7, 0.3)
    audio.play(power >= 4 ? 'boomBig' : 'boom')
    haptic(power >= 4 ? 130 : 70, power >= 4 ? 1 : 0.7, 0.5)
    if (power >= 4) this.hitStop(0.45, 0.05) // big blasts land harder
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
    this.bombs.push({ id: this.bombId++, owner: -1, col: c, row: r, x: c, y: r, sliding: null, fuse: 1500, power: 2, born: this.time })
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
      p.shieldUntil = 0; p.wallpassUntil = 0
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
      // cap the *dropped* (revealed) items — the map's hidden items don't count,
      // a battle map can legitimately ship with more than MAX on field
      const dropped = this.powerups.filter(u => u.revealed).length
      if (this.battleNextItem <= 0 && this.state === 'playing' && dropped < MAX_POWERUPS_ON_FIELD) {
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
          this.powerups.push({ col: s.c, row: s.r, kind: this.weightedPowerupKind(true), born: this.time, revealed: true })
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
    if (!settings.shake) return { x: 0, y: 0 } // motion-sensitivity setting
    if (this.shakeT <= 0) return { x: 0, y: 0 }
    const m = this.shakeMag * (this.shakeT / this.shakeDur)
    return {
      x: (Math.random() * 2 - 1) * m,
      y: (Math.random() * 2 - 1) * m,
    }
  }

  // ---------------- AI (battle bot + attract) ----------------

  private aiState = new Map<number, { path: { x: number; y: number }[]; i: number; repath: number; tc: number; tr: number; noBricks: Set<number>; kind?: 'pursuit' | 'escape'; standoff?: boolean; detouring?: boolean; triedLineup?: Set<number>; detourBrick?: number }>()
  /** per-AI progress tracker for stall detection (see end of aiThinkImpl) */
  private aiStall = new Map<number, { x: number; y: number; ticks: number }>()

  aiThink(p: PlayerState): { dir: Dir | null; bomb: boolean; detonate: boolean } {
    return this.aiThinkImpl(p)
  }

  private aiThinkImpl(p: PlayerState): { dir: Dir | null; bomb: boolean; detonate: boolean } {
    const out = { dir: null as Dir | null, bomb: false, detonate: false }
    if (!p.alive) return out
    const enemy = this.players.find(q => q.id !== p.id && q.alive)
    // a temporary brick detour (detourBrick — set when the path head is a
    // brick we can't bomb because the slot is full) is only needed while we
    // are at the brick. Clear it once we've moved on (>2 tiles) or the brick
    // is gone; without this the bot would route around the brick for the rest
    // of the match. NOTE: it is deliberately NOT cleared when the bomb slot
    // frees — the detour is usually the cheaper option (a bomb costs 2.6s of
    // fuse; a 2-4 tile swing is ~1s and keeps the slot free for an attack),
    // and the next repath re-evaluates bomb-vs-detour from a fresh position
    {
      const stTop = this.aiState.get(p.id)
      if (stTop && stTop.detourBrick !== undefined) {
        const bc = stTop.detourBrick % COLS, br = Math.floor(stTop.detourBrick / COLS)
        const far = Math.abs(bc - p.col) + Math.abs(br - p.row) > 2
        const gone = this.tile(bc, br) !== T_SOFT
        if (far || gone) this.aiState.set(p.id, { ...stTop, detourBrick: undefined })
      }
    }
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
      const sdc = Math.sign(enemy.col - p.col), sdr = Math.sign(enemy.row - p.row)
      // clear lane: the blast is a cross, so a wall or brick between us
      // stops it short — a kill only lands if the lane is clear. A brick
      // within flame range is worth bombing: it opens the lane
      let los = false, laneBrick = false
      if (inLine && distEnemy >= 1) {
        los = true
        for (let i = 1; i < distEnemy; i++) {
          const t = this.tile(p.col + sdc * i, p.row + sdr * i)
          if (t !== T_WALK) {
            los = false
            if (t === T_SOFT && i <= p.flame) laneBrick = true
            break
          }
        }
      }
      const canBomb = !this.bombAt(p.col, p.row) && myBombs.length < p.bombs && this.canSurviveBomb(p)
      // 1. kill bomb: the blast reaches the enemy's tile right now. They
      //    have 2.6s to leave the cross; boxed in, they can't. (The old
      //    rules missed this outright — the jitter rule started at
      //    distance 2 and the trap rule demanded a dead end, so a lined-up
      //    bot in open space rarely bombed)
      if (inLine && los && distEnemy <= p.flame && canBomb) {
        out.bomb = true
      } else if (inLine && laneBrick && canBomb) {
        // 2. open the lane: blast the brick between us — next tick the
        //    kill bomb can land
        out.bomb = true
      } else if (inLine && distEnemy >= 1 && distEnemy <= p.flame - 1 && canBomb) {
        // 3. cut: blast a brick behind the opponent to shrink their escape routes
        if (this.tile(enemy.col + sdc, enemy.row + sdr) === T_SOFT) out.bomb = true
      } else if (distEnemy >= 2 && distEnemy <= p.flame + 1 && canBomb
        && Math.random() < 0.85) { // 4. map-break with reaction jitter: break perfect symmetry
        out.bomb = true
      }
      if (myBombs.length) {
        const b = myBombs.sort((a, b) => a.born - b.born)[0]
        // early-detonate only when it won't also kill us
        if (this.bombHits(b, enemy.col, enemy.row) && !this.bombHits(b, p.col, p.row)) out.detonate = true
      }
    } else if (nearest) {
      // campaign: bomb any enemy lined up within flame range
      if (!this.bombAt(p.col, p.row) && myBombs.length < p.bombs && this.canSurviveBomb(p)) {
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
    //    — box-aware. The imminent-blast set is shared with the pathfinder
    //    below so the pursuit path never routes through fire that is about
    //    to land, and the FULL blast set of every live bomb is shared too:
    //    routing through an un-detonated bomb's radius is what sent the bot
    //    straight back into the blast it had just escaped, oscillating on
    //    the edge
    const soon = this.imminentSet()
    const allBlasts = new Set<number>(soon)
    for (const b of this.bombs) {
      this.blastSet(b.col, b.row, b.power).forEach(k => allBlasts.add(k))
    }
    const threat = this.threatDir(p, out.bomb, soon, allBlasts)
    if (threat !== null) {
      return { ...out, dir: threat }
    }

    // 3. target selection (strategy — stable per repath)
    const st = this.aiState.get(p.id)
    // standoff state with HYSTERESIS on the free (floating) distance: enter
    // at ≤3 tiles, exit at ≥4.5. The derived-tile distance flips 3↔4 at the
    // 0.5-tile boundary while the bot stands on it, and a target that flips
    // with it (detour vs enemy) pins the bot exactly on the boundary,
    // flip-flopping the path — and the heading — every tick.
    // A standoff DETOUR carries the bot past the 4.5 exit threshold on the
    // way to the powerup — the detouring flag keeps the standoff through the
    // trip (it ends when the powerup is collected), so the bot doesn't
    // ping-pong enemy↔powerup in a 4.6s cycle
    let standoff = st?.standoff ?? false
    let detouring = st?.detouring ?? false
    if (enemy) {
      const ndFree = Math.abs(enemy.x - p.x) + Math.abs(enemy.y - p.y)
      if (ndFree <= 3) standoff = true
      if (ndFree >= 4.5 && !detouring) standoff = false
    }
    if (detouring && st && !this.powerups.some(u => u.col === st.tc && u.row === st.tr)) detouring = false
    let target: { c: number; r: number }
    if (enemy) {
      // battle: hunt the opponent
      target = { c: enemy.col, r: enemy.row }
      if (!out.bomb) {
        detouring = false
        if (nearestD <= 1) {
          // point-blank: back off — a bomb here is a mutual kill
          if (nearestD === 0) {
            // sharing a tile: step to the first open neighbour (fixed order —
            // a random pick here used to look like twitching)
            let o: [number, number] | null = null
            for (const q of [0, 1, 2, 3] as Dir[]) {
              if (!this.canStep(p, q)) continue
              const [dc, dr] = dirVec(q)
              o = [Math.round(p.x + dc), Math.round(p.y + dr)]
              break
            }
            target = o ? { c: o[0], r: o[1] } : { c: enemy.col, r: enemy.row }
          } else {
            // back off to a fixed standoff 3 tiles from the enemy along the
            // dominant axis. Anchored on the ENEMY (not our moving position)
            // so the target can't jump at tile boundaries — the old formula
            // recomputed from p.col swung 4↔7 at every boundary
            const dc = p.col - enemy.col, dr = p.row - enemy.row
            let c: number, r: number
            if (Math.abs(dc) >= Math.abs(dr)) {
              c = enemy.col + Math.sign(dc || 1) * 3; r = enemy.row
            } else {
              c = enemy.col; r = enemy.row + Math.sign(dr || 1) * 3
            }
            c = Math.max(1, Math.min(COLS - 2, c))
            r = Math.max(1, Math.min(ROWS - 2, r))
            // the anchor can land on a wall tile: an unreachable target
            // leaves the path empty and the bot pins at the wall edge —
            // fall back to hunting the enemy directly
            if (this.tile(c, r) === T_HARD || allBlasts.has(key(c, r))) {
              target = { c: enemy.col, r: enemy.row }
            } else {
              target = { c, r }
            }
          }
        } else if (standoff) {
          // standoff (hysteresis band, see above). A bomb only connects when
          // we are ON the enemy's row or column, so:
          //  - on line and in range: close in to deliver the kill
          //  - on line, out of range: hold (forward = mutual kill, away =
          //    gives up the line — the 3-tile ping-pong)
          //  - off line: walk to the nearest line-up tile (the only position
          //    a bomb can hit from); powerup detour is the fallback. Holding
          //    here froze the bot forever when no detour existed
          const inLine = enemy.col === p.col || enemy.row === p.row
          if (inLine && p.flame >= 2 && nearestD <= p.flame + 1) {
            detouring = false
            target = { c: enemy.col, r: enemy.row }
          } else if (inLine) {
            // on the line but out of flame reach: close to the nearest kill
            // position (flame tiles from the enemy, on our side of the line).
            // Holding here sat the bot at the end of the line forever — with
            // flame 1 the only kill is at distance 1, so it must walk in.
            // The target is anchored on the enemy, so it tracks the enemy
            // without flip-flopping at a tile boundary
            const dc = Math.sign(p.col - enemy.col), dr = Math.sign(p.row - enemy.row)
            const tc = enemy.col + dc * Math.min(p.flame, Math.abs(p.col - enemy.col))
            const tr = enemy.row + dr * Math.min(p.flame, Math.abs(p.row - enemy.row))
            // a wall or live blast on the kill position: hold the line
            // instead of pinning against an unreachable tile
            if (this.tile(tc, tr) === T_HARD || allBlasts.has(key(tc, tr))) {
              target = { c: p.col, r: p.row }
            } else {
              target = { c: tc, r: tr }
            }
          } else {
            const lu = this.lineupTarget(p, enemy, allBlasts, st?.noBricks, st?.triedLineup)
            const det = lu ?? this.detourTarget(p, st, allBlasts, 8, enemy)
            detouring = det !== null && lu === null
            target = det ?? { c: p.col, r: p.row }
          }
        } else if (nearestD > 6) {
          // far away: close in. Detour only for a powerup ON THE WAY to the
          // enemy (flame first — longer flame = kills); the old rule grabbed
          // any powerup within 8 tiles, so the bot looted the far side of
          // the map and never engaged
          const det = this.detourTarget(p, st, allBlasts, 8, enemy)
          if (det) target = det
        }
      }
    } else if (this.mode === 'campaign' && !nearest) {
      target = { c: this.exit.col, r: this.exit.row }
    } else {
      // priority: flame (can't kill with weak flame) > bomb > other powerup >
      // nearest enemy; engage a very close enemy over powerup hunting
      target = nearest ? { c: nearest.col, r: nearest.row } : { c: this.exit.col, r: this.exit.row }
      // same hysteresis as the battle detour (see detourTarget)
      const det = this.detourTarget(p, st, allBlasts, 12)
      if (det) target = det
      if (nearest && nearestD <= 4) target = { c: nearest.col, r: nearest.row }
    }

    // 4. path following: commit to the current path until the target drifts
    //    away, the timer expires, or the path breaks. Replanning on every tile
    //    change (the old behaviour) is what made the bot look twitchy —
    //    each fresh BFS to a moving target can start with a different step
    const drift = st ? Math.abs(target.c - st.tc) + Math.abs(target.r - st.tr) : 99
    // the player ended up well off the stored path (an escape landing, a
    // deflection): replan from where we actually are
    let offPath = false
    if (st && st.i < st.path.length) {
      const h = st.path[st.i]
      offPath = (h.x - p.x) ** 2 + (h.y - p.y) ** 2 > 2.25
    }
    // a brick we can't blow up (no safe escape from our blast) is a dead
    // end: BFS allows soft bricks on the theory that the bot bombs them when
    // it reaches them, but if it can't, the bot used to square-wave along
    // the brick's edge forever. Mark the brick impassable and re-plan
    let forceReplan = false
    if (st && st.i < st.path.length) {
      const h = st.path[st.i]
      if (this.tile(h.x, h.y) === T_SOFT
        && (h.x - p.x) ** 2 + (h.y - p.y) ** 2 < 2.25
        && !this.canSurviveBomb(p)) {
        const noBricks = new Set(st.noBricks)
        noBricks.add(key(h.x, h.y))
        this.aiState.set(p.id, { ...st, path: [], i: 0, noBricks })
        forceReplan = true
      }
    }
    // re-plan with everything lethal avoided: full blast of every live bomb
    // (routing through an un-detonated bomb's radius sent the bot straight
    // back into the blast it had just escaped, oscillating on the edge) plus
    // bricks it has proven it can't blow up
    const avoid = new Set(allBlasts)
    const st2 = this.aiState.get(p.id)
      ?? { path: [] as { x: number; y: number }[], i: 0, repath: 0, tc: -1, tr: -1, noBricks: new Set<number>(), kind: 'pursuit' as 'pursuit' | 'escape' }
    this.aiState.set(p.id, { ...st2, standoff, detouring })
    for (const k of st2.noBricks) {
      if (this.tile(k % COLS, Math.floor(k / COLS)) === T_SOFT) avoid.add(k)
    }
    // temporary brick detour: a brick we were parked at with a full bomb
    // slot — routed around until the slot frees (cleared at the top)
    if (st2.detourBrick !== undefined && this.tile(st2.detourBrick % COLS, Math.floor(st2.detourBrick / COLS)) === T_SOFT) {
      avoid.add(st2.detourBrick)
    }
    // Repath policy while a bomb of ours is live. The BFS below avoids the
    // FULL blast of every live bomb (avoid = allBlasts), so a pursuit path
    // routes AROUND our own flame — the bot keeps closing in on the player
    // through the 2.6s fuse instead of parking at the safe haven (the old
    // blanket suppression idled it ~79% of bomb-live time; the top
    // Pommerman agents all keep pressing after the bomb). The only remaining
    // suppression is the placement tick (out.bomb — the bomb is not in
    // this.bombs yet, so allBlasts is blind to its blast and the path would
    // route through it). Note: inOwnBlast used to suppress repaths while the
    // box overlapped our own blast ring, but the box is 0.6 wide, so ANY
    // tile adjacent to the ring counts — and the escape route always ends
    // on such a tile. That pinned the bot in its own blast for the whole
    // fuse with no repath and (via the standoff hold) no motion. The BFS
    // avoid-set already keeps paths out of the ring, and live fire is
    // handled by the threatDir early return above. In a sealed ring the BFS
    // simply finds no route and returns null: the bot wanders out
    if (!out.bomb && (forceReplan || !st || this.time > st2.repath || drift > 2 || offPath || !this.pathValid(st2, avoid))) {
      const path = this.bfs(p.col, p.row, target.c, target.r, true, avoid, true) ?? []
      // a standoff target BFS can't reach is a dead end: remember it so the
      // next pick falls to the next fallback (line-up → detour → hold)
      // instead of re-planning to the same unreachable tile every 0.9s
      let tried = st2.triedLineup
      if (!path.length && standoff && enemy
        && !(target.c === enemy.col && target.r === enemy.row)
        && (target.c !== p.col || target.r !== p.row)) {
        tried = new Set(tried)
        tried.add(key(target.c, target.r))
      }
      this.aiState.set(p.id, { path, i: 0, repath: this.time + 0.9, tc: target.c, tr: target.r, noBricks: st2.noBricks, kind: 'pursuit', standoff, detouring, triedLineup: tried, detourBrick: st2.detourBrick })
    }
    const s = this.aiState.get(p.id)!
    // skip waypoints already reached (or passed — free movement straddles
    // tile centres, so measure from the free position)
    while (s.i < s.path.length) {
      const h = s.path[s.i]
      const dh = (h.x - p.x) ** 2 + (h.y - p.y) ** 2
      const n = s.path[s.i + 1]
      const dn = n ? (n.x - p.x) ** 2 + (n.y - p.y) ** 2 : Infinity
      if (dh < 0.12) { s.i++; continue }        // arrived
      if (dn < dh) { s.i++; continue }          // head is behind us
      if (n && dh < 0.36) { s.i++; continue }   // approaching: face the next segment
      break
    }
    if (s.i < s.path.length) {
      const h = s.path[s.i]
      // keep the current heading while it makes progress toward the waypoint —
      // a pure "face the point" controller square-waves on the 45° diagonals
      // (right/down/right/down) and looks like the bot has ADHD. The heading
      // is only corrected when the path is no longer ahead (corner, detour,
      // escape landing)
      const ddx = h.x - p.x, ddy = h.y - p.y
      let nd: Dir | null = null
      if (p.movingDir !== null) {
        const [mc, mr] = dirVec(p.movingDir)
        const along = ddx * mc + ddy * mr
        const across = Math.abs(ddx * mr + ddy * mc)
        if (along > 0.2 && across < 1.1 && this.canStep(p, p.movingDir)) nd = p.movingDir
      }
      const dir = nd ?? this.steer(p, h.x, h.y)
      const isBrick = this.tile(h.x, h.y) === T_SOFT
      const canBombNow = !this.bombAt(p.col, p.row) && myBombs.length < p.bombs && this.canSurviveBomb(p)
      if (isBrick && s.kind === 'pursuit' && canBombNow) {
        // brick on a PURSUIT path: bomb it ONLY if it is the cheapest way
        // through. A bomb costs ~2.6s of fuse + escape ≈ 13 tile-steps and
        // burns the bomb slot; a short swing around (≤10 steps) gets the bot
        // to the player faster AND keeps the slot free for an attack bomb.
        // "Bomb every brick on the path" made the bot a brick-clearing
        // machine: 40+ bombs per match, 2% of them near the player, while
        // the player walked away
        const avoidBrick = new Set(avoid)
        avoidBrick.add(key(h.x, h.y))
        const swing = this.bfs(p.col, p.row, s.tc, s.tr, true, avoidBrick, true)
        if (swing && swing.length <= 10) {
          // walk around: adopt the swing as the path and keep the brick
          // blocked (detourBrick) so the next repath doesn't re-plan back
          // through it; the bomb-vs-detour call re-runs from the new
          // position at each repath
          this.aiState.set(p.id, { ...s, path: swing, i: 0, repath: this.time + 0.9, detourBrick: key(h.x, h.y) })
          out.dir = this.steer(p, swing[0].x, swing[0].y)
        } else {
          out.bomb = true
        }
      } else if (isBrick && !canBombNow && (h.x - p.x) ** 2 + (h.y - p.y) ** 2 < 1.2) {
        // brick right in front of us that we can't bomb RIGHT NOW. Two cases:
        // - bomb slot full: a TEMPORARY block. Parking here (the old
        //   behaviour) sat the bot in the player's line of fire for the whole
        //   2.6s fuse — it got shot. Set a temporary detour: the next repath
        //   routes around the brick, the bot keeps closing in, and when the
        //   slot frees the detour is cleared (top of aiThink) and the brick
        //   gets bombed from the path head
        // - no safe escape from our blast: a GENUINE block — hold (steering
        //   at the brick edge made the bot jiggle at 60Hz)
        if (myBombs.length >= p.bombs) {
          const db = key(h.x, h.y)
          if (s.detourBrick !== db) this.aiState.set(p.id, { ...s, detourBrick: db, path: [], i: 0 })
          out.dir = null
        } else {
          out.dir = null
        }
      } else {
        out.dir = dir
      }
    } else {
      // path exhausted (or target unreachable — e.g. the enemy is standing
      // in an imminent blast the path can't route through): keep momentum
      // while possible, else drift toward open space. Re-picking a direction
      // every tick oscillates on the "most open neighbour" tile boundary
      // sealed in with no path (a brick the replaner gave up on, a pocket
      // BFS can't route through): bomb the brick open once we've proven we
      // are pinned. The bomb decisions above only fire on a path HEAD —
      // with no path they never ran, and the bot sat at the brick edge
      // for minutes
      if (!s.path.length && !out.bomb && !this.bombAt(p.col, p.row)
        && myBombs.length < p.bombs && this.canBombThroughBrick(p)) {
        const ss0 = this.aiStall.get(p.id)
        if (ss0 && ss0.ticks > 20) out.bomb = true
      }
      // at the standoff with the enemy: hold position. Wandering from the
      // standoff walked the bot back toward the enemy, the dead band
      // re-planned it to the backoff point, and it ping-ponged a 3-tile
      // corridor forever. EXCEPTION: when the stored target is our OWN tile
      // — the kill position is blocked by a live blast, or we are standing
      // ON it and can't bomb (a mutual-kill position: the cross seals all
      // four neighbours) — holding freezes the bot in place: the path is
      // empty, every repath re-picks the same own-tile target, and the bot
      // just stares at the player for seconds while they walk away. Wander
      // (blast-avoiding) so the bot steps off and re-approaches from a
      // survivable angle
      if (enemy && standoff && !(s.tc === p.col && s.tr === p.row)) {
        out.dir = null
      } else {
        let dir: Dir | null = null
        if (!s.path.length && p.movingDir !== null) {
          const [mc, mr] = dirVec(p.movingDir)
          // keep momentum only while it stays out of danger — drifting back
          // across a blast edge was the last oscillation
          const ahead = this.boxTilesAt(p.x + mc * 0.5, p.y + mr * 0.5)
          if (this.canStep(p, p.movingDir) && ![...ahead].some(k => allBlasts.has(k))) dir = p.movingDir
        }
        out.dir = dir ?? (s.path.length ? null : this.wanderDir(p, allBlasts))
      }
      s.repath = Math.min(s.repath, enemy ? this.time + 0.2 : this.time + 0.4)
    }
    // if we're about to bomb, commit the time-aware escape route (the
    // Pommerman survivability path — it may cross blast tiles, the flame
    // lands 2.6s out and the bot is through long before). The old wall-based
    // escapeRoute pointed at the nearest NON-blast tile — in a 1-wide
    // corridor that was the enemy's own tile, and the bot walked into the
    // enemy, got pinned, and burned in its own blast
    if (out.bomb) {
      // after the bomb the escape route should ADVANCE toward the opponent,
      // not retreat to the nearest safe corner (which is often behind us) —
      // that ping-ponged the bot with no net progress. The haven is still
      // safe by construction (survivalRoute only picks non-burning tiles)
      const pref = enemy ? { c: enemy.col, r: enemy.row } : undefined
      const route = this.survivalRoute(p, true, pref) ?? this.escapeRoute(p, this.blastSet(p.col, p.row, p.flame))
      if (route) this.aiState.set(p.id, { path: route, i: 0, repath: this.time + 0.9, tc: route[route.length - 1].x, tr: route[route.length - 1].y, noBricks: this.aiState.get(p.id)?.noBricks ?? new Set(), kind: 'escape', standoff, detouring, triedLineup: this.aiState.get(p.id)?.triedLineup, detourBrick: this.aiState.get(p.id)?.detourBrick })
    }
    // stall detection: commanded a direction but made no progress for ~0.3s
    // → the stored path is stale (the world changed under it — a sealed
    // pocket, a new brick). Drop the path so the next tick re-plans from
    // where we actually are. Without this the bot stood pinned against a
    // wall following a route it could no longer walk, and burned in its own
    // bomb
    if (out.dir !== null) {
      const ss = this.aiStall.get(p.id)
      if (ss && ss.x === p.x && ss.y === p.y) {
        ss.ticks++
        if (ss.ticks > 20) {
          const st2 = this.aiState.get(p.id)
          if (st2) this.aiState.set(p.id, { ...st2, path: [], i: 0 })
          this.aiStall.set(p.id, { x: p.x, y: p.y, ticks: 0 })
        }
      } else {
        this.aiStall.set(p.id, { x: p.x, y: p.y, ticks: 0 })
      }
    } else {
      this.aiStall.set(p.id, { x: p.x, y: p.y, ticks: 0 })
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

  /** shortest route (tile list, start excluded) that gets the player's box
   *  out of `blast`. Multi-source from every tile the box overlaps — the
   *  centre tile can be clear while the box still grazes the blast. When one
   *  of the overlapped tiles is already safe the route is just that tile.
   *  Otherwise the route is pathed AROUND the ring (a straight step to the
   *  safe tile would plough through the flame and burn) */
  private escapeRoute(p: PlayerState, blast: Set<number>): { x: number; y: number }[] | null {
    const box = [...this.boxTiles(p)]
    if (!box.some(k => blast.has(k))) return null
    for (const k of box) if (!blast.has(k)) return [{ x: k % COLS, y: Math.floor(k / COLS) }]
    const q: number[] = box
    const seen = new Set<number>(box)
    let safeK = -1
    while (q.length && safeK < 0) {
      const k = q.shift()!
      const c = k % COLS, r = Math.floor(k / COLS)
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr
        const nk = key(nc, nr)
        if (seen.has(nk) || !this.canEnter(p, nc, nr)) continue
        seen.add(nk); q.push(nk)
        if (!blast.has(nk)) { safeK = nk; break }
      }
    }
    if (safeK < 0) return null
    const sc = safeK % COLS, sr = Math.floor(safeK / COLS)
    const path = this.bfs(p.col, p.row, sc, sr, true, blast, true)
    if (path) return path
    // sealed in by the blast: there is no safe route. Returning a fake
    // single-tile route here used to make blastEscape() claim the bot could
    // bomb and run — it bombed, and burned in its own sealed pocket
    return null
  }

  /** can a bomb on our OWN tile open a brick, with a walkable tile on the
   *  far side? blastEscape() says "no" in exactly this case (every blast
   *  neighbour is inside the blast set), but the bomb DESTROYS the brick
   *  neighbour — it becomes the exit, and the bot walks through long before
   *  the flame reaches it. This is the only way out of a brick-sealed
   *  pocket, and without it the bot pinned at the brick edge forever */
  private canBombThroughBrick(p: PlayerState): boolean {
    const blast = this.blastSet(p.col, p.row, p.flame)
    for (const k of blast) {
      const c = k % COLS, r = Math.floor(k / COLS)
      if (this.tile(c, r) !== T_SOFT) continue
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr
        if (blast.has(key(nc, nr))) continue
        if (this.tile(nc, nr) === T_WALK) return true
      }
    }
    return false
  }

  /** the tiles the player's box physically overlaps (1–4 of them). Danger
   *  checks must use this, not the derived centre tile: at a tile boundary
   *  the centre tile flips while the box is still half inside the danger,
   *  and the bot used to oscillate in and out of a blast edge every tick */
  private boxTiles(p: PlayerState): Set<number> {
    return this.boxTilesAt(p.x, p.y)
  }

  private boxTilesAt(x: number, y: number): Set<number> {
    const s = new Set<number>()
    const c0 = Math.floor(x - Game.HALF - 0.5 + 1e-9) + 1
    const c1 = Math.floor(x + Game.HALF + 0.5 - 1e-9)
    const r0 = Math.floor(y - Game.HALF - 0.5 + 1e-9) + 1
    const r1 = Math.floor(y + Game.HALF + 0.5 - 1e-9)
    for (let c = c0; c <= c1; c++)
      for (let r = r0; r <= r1; r++) s.add(key(c, r))
    return s
  }

  /** can the player's box physically step in direction d? A real box test,
   *  not a derived-tile test: at a tile boundary the derived tile flips
   *  while the box is still straddling it, which made per-tick heading
   *  checks flip-flop and the bot jiggle in place (the last ADHD symptom) */
  private canStep(p: PlayerState, d: Dir): boolean {
    const [c, r] = dirVec(d)
    return !this.boxHits(p.x + c * 0.2, p.y + r * 0.2, p)
  }

  /** tiles on fire now, or under a bomb whose fuse is about to run out
   *  (≤1.5s). The pathfinder treats these as walls so the bot never plans a
   *  route through fire that is about to land */
  private imminentSet(): Set<number> {
    const s = this.flameSet()
    for (const b of this.bombs) {
      if (b.fuse > 1500) continue
      this.blastSet(b.col, b.row, b.power).forEach(k => s.add(k))
    }
    return s
  }

  /** direction to head toward (tx, ty) from the free position — never
   *  commands a direction that is physically blocked (box test). Facing a
   *  wall was how the bot used to stall inside its own blast and burn with
   *  the bomb; the derived-tile test flipped at tile boundaries and made it
   *  jiggle between two directions at 60Hz */
  private steer(p: PlayerState, tx: number, ty: number): Dir {
    const dx = tx - p.x, dy = ty - p.y
    const d = (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 1) : (dy >= 0 ? 2 : 3)) as Dir
    if (this.canStep(p, d)) return d
    const alt = (Math.abs(dx) >= Math.abs(dy) ? (dy >= 0 ? 2 : 3) : (dx >= 0 ? 0 : 1)) as Dir
    if (this.canStep(p, alt)) return alt
    for (const q of [0, 1, 2, 3] as Dir[]) if (this.canStep(p, q)) return q
    return d
  }

  /** best powerup detour within `maxD` tiles: flame first (a short flame
   *  can't kill), then bomb, then anything. Hysteresis: if the stored
   *  target is still a valid powerup, keep it — re-picking the nearest one
   *  every tick made the bot flip-flop between two powerups at the distance
   *  midpoint, chasing them back and forth in a 4-second limit cycle.
   *  Powerups sitting on a noBricks brick are unchaseable (BFS avoids the
   *  brick, the target is inside the avoid set) — skipping them is what
   *  stops the bot pinning outside a brick it proved it can't bomb */
  /** nearest tile on the enemy's row or column from which a bomb can
   *  connect: ≥2 tiles out (at 1 a bomb is a mutual kill) and ≤ flame+1
   *  (the blast must reach), walkable, not in a live blast, not a proven
   *  unbombleable brick, and not already tried-and-unreachable. Off the
   *  line a bomb can never hit — walking to a line-up tile is what
   *  un-freezes the standoff when no powerup detour exists */
  private lineupTarget(p: PlayerState, enemy: PlayerState, allBlasts: Set<number>, noBricks?: Set<number>, tried?: Set<number>): { c: number; r: number } | null {
    let best = 99
    let found: { c: number; r: number } | null = null
    const consider = (c: number, r: number) => {
      const de = Math.abs(c - enemy.col) + Math.abs(r - enemy.row)
      if (de < 2 || de > p.flame + 1) return
      if (this.tile(c, r) === T_HARD) return
      if (this.sealedPocket(c, r)) return
      if (allBlasts.has(key(c, r))) return
      if (noBricks?.has(key(c, r))) return
      if (tried?.has(key(c, r))) return
      const d = Math.abs(c - p.col) + Math.abs(r - p.row)
      if (d < best) { best = d; found = { c, r } }
    }
    for (let c = 1; c < COLS - 1; c++) if (c !== enemy.col) consider(c, enemy.row)
    for (let r = 1; r < ROWS - 1; r++) if (r !== enemy.row) consider(enemy.col, r)
    return found
  }

  private detourTarget(p: PlayerState, st: { tc: number; tr: number; noBricks?: Set<number> } | undefined, allBlasts: Set<number>, maxD: number, onTheWayTo?: { col: number; row: number }): { c: number; r: number } | null {
    const nb = st?.noBricks
    // battle: a detour is only worth it if the powerup is roughly ON THE WAY
    // to the enemy — otherwise the bot loots the far side of the map and
    // never engages (measured: 9+ tiles from the player for 10s at a time,
    // closing in on 0% of ticks). The slack (+2) tolerates a short swing
    const onWay = (c: number, r: number) => !onTheWayTo
      || Math.abs(c - onTheWayTo.col) + Math.abs(r - onTheWayTo.row)
        <= Math.abs(p.col - onTheWayTo.col) + Math.abs(p.row - onTheWayTo.row) + 2
    if (st && this.powerups.some(u => u.col === st.tc && u.row === st.tr)
      && this.tile(st.tc, st.tr) !== T_HARD && !allBlasts.has(key(st.tc, st.tr))
      && !this.sealedPocket(st.tc, st.tr)
      && !nb?.has(key(st.tc, st.tr)) && onWay(st.tc, st.tr)) {
      return { c: st.tc, r: st.tr }
    }
    let best = 99, bestPrio = 9
    let found: { c: number; r: number } | null = null
    for (const u of this.powerups) {
      const d = Math.abs(u.col - p.col) + Math.abs(u.row - p.row)
      if (d >= maxD) continue
      // a powerup sitting in a live blast is a death trap, not a detour:
      // chasing it with no valid path made the bot drift back and forth
      // across the blast edge forever
      if (allBlasts.has(key(u.col, u.row))) continue
      // a powerup inside a sealed pocket is uncollectable (see sealedPocket)
      if (this.sealedPocket(u.col, u.row)) continue
      if (nb?.has(key(u.col, u.row))) continue
      if (!onWay(u.col, u.row)) continue
      const prio = (u.kind === 'flame' && p.flame < 3) ? 0
        : (u.kind === 'bomb' && p.bombs < 2) ? 1 : 2
      if (prio < bestPrio || (prio === bestPrio && d < best)) {
        bestPrio = prio; best = d; found = { c: u.col, r: u.row }
      }
    }
    return found
  }

  private threatDir(p: PlayerState, justBombed: boolean, soon: Set<number>, all: Set<number>): Dir | null {
    // hard danger: live flames + bombs that will go off within 1.5s (passed
    // in — also used by the pathfinder to route around fire).
    // soft danger (all): the full blast of every live bomb — passed in so
    // the pathfinder avoids the same tiles the threat check reacts to.
    // Reacting only at 1.5s let the bot walk into a freshly-planted bomb's
    // radius and burn
    const box = [...this.boxTiles(p)]
    const inSoon = box.some(k => soon.has(k))
    const inAll = box.some(k => all.has(k))
    const safe = (q: Dir): boolean => {
      if (!this.canStep(p, q)) return false
      const [c2, r2] = dirVec(q)
      // danger judged by the box AFTER the step, not the derived centre tile
      const st = this.boxTilesAt(p.x + c2 * 0.5, p.y + r2 * 0.5)
      return ![...st].some(k => all.has(k))
        && !this.enemies.some(e => e.alive && st.has(key(e.col, e.row)))
    }
    const follow = (route: { x: number; y: number }[]): Dir | null => {
      this.aiState.set(p.id, {
        path: route, i: 0, repath: this.time + 0.9,
        tc: route[route.length - 1].x, tr: route[route.length - 1].y,
        noBricks: this.aiState.get(p.id)?.noBricks ?? new Set(),
        kind: 'escape',
        standoff: this.aiState.get(p.id)?.standoff,
        detouring: this.aiState.get(p.id)?.detouring,
        triedLineup: this.aiState.get(p.id)?.triedLineup,
        detourBrick: this.aiState.get(p.id)?.detourBrick,
      })
      return this.steer(p, route[0].x, route[0].y)
    }
    // a committed escape route is kept until it breaks. Recomputing the
    // route from the box every tick made the first waypoint (and the
    // heading) flip every tick while the box straddled the blast edge —
    // the bot pinned itself in place and burned in its own bomb
    const followCommitted = (set: Set<number>): Dir | null => {
      const cs = this.aiState.get(p.id)
      // only committed ESCAPE routes count. Treating a pursuit path as an
      // escape made the bot "follow" its own pursuit route back into the
      // blast it was fleeing — the path flipped pursuit↔escape every tick
      // and the bot square-waved on the blast edge
      if (!cs || cs.kind !== 'escape') return null
      // advance past reached waypoints (same rule as pursuit)
      while (cs.i < cs.path.length) {
        const w = cs.path[cs.i]
        const dw = (w.x - p.x) ** 2 + (w.y - p.y) ** 2
        const nw = cs.path[cs.i + 1]
        const dnw = nw ? (nw.x - p.x) ** 2 + (nw.y - p.y) ** 2 : Infinity
        if (dw < 0.12 || dnw < dw) { cs.i++; continue }
        break
      }
      if (cs.i >= cs.path.length) return null
      const h = cs.path[cs.i]
      // the first step may pass through the blast ring (it's the only way
      // out) — only a destination that turned dangerous, or an impassable
      // head, breaks the commitment
      if (set.has(key(cs.tc, cs.tr))) return null
      if (this.tile(h.x, h.y) === T_HARD || this.bombAt(h.x, h.y)) return null
      if (!this.canEnter(p, h.x, h.y)) return null
      const dx = h.x - p.x, dy = h.y - p.y
      let nd: Dir | null = null
      if (p.movingDir !== null) {
        const [mc, mr] = dirVec(p.movingDir)
        const along = dx * mc + dy * mr
        const across = Math.abs(dx * mr + dy * mc)
        if (along > 0.2 && across < 1.1 && this.canStep(p, p.movingDir)) nd = p.movingDir
      }
      return nd ?? this.steer(p, h.x, h.y)
    }
    // on fire / about to be on fire: plan the shortest route to a tile
    // outside the blast and follow it — a greedy one-tile flee can loop
    // inside the blast (every neighbour also ablaze) and burn with it
    if (inSoon) {
      const kept = followCommitted(soon)
      if (kept !== null) return kept
      // time-aware first (it threads a blast before the flame lands and
      // knows the enemy's tile is not an exit), wall-based as last resort
      const route = this.survivalRoute(p) ?? this.escapeRoute(p, soon)
      if (route) return follow(route)
      // only the forward tile is threatened: back off
      const back = (p.dir ^ 1) as Dir
      const [bc, br] = dirVec(back)
      if (this.canStep(p, back)
        && ![...this.boxTilesAt(p.x + bc * 0.5, p.y + br * 0.5)].some(k => soon.has(k))) return back
    }
    // inside any bomb's blast radius (not imminent yet): move to the nearest
    // safe tile while the fuse is still on our side
    if (inAll) {
      const kept = followCommitted(all)
      if (kept !== null) return kept
      const route = this.survivalRoute(p) ?? this.escapeRoute(p, all)
      if (route) return follow(route)
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
    return null
  }

  /** the current path is usable: the next waypoint (not the final target,
   *  which may be occupied by the enemy) is walkable and unblocked. Bricks
   *  are allowed — the bot bombs them when it reaches them */
  private pathValid(s: { path: { x: number; y: number }[]; i: number }, soon: Set<number>): boolean {
    if (s.i >= s.path.length - 1) return true
    const h = s.path[s.i]
    // a blast went up (or is about to) on the stored route: re-plan around
    // it instead of following a path that leads straight into the fire
    if (soon.has(key(h.x, h.y))) return false
    if (this.tile(h.x, h.y) === T_HARD) return false
    if (this.bombAt(h.x, h.y)) return false
    if (this.enemyAt(h.x, h.y)) return false
    return true
  }

  /** no path to the target: head for the most open reachable neighbour
   *  (deterministic tie-break) instead of a random direction each tick.
   *  Box-tested, and it avoids stepping into live blasts — drifting into a
   *  blast with no path was how the bot used to ping-pong on the blast edge.
   *  In a 1-tile corridor every one-tile score ties, so also look TWO tiles
   *  ahead (that is what picks the corridor exit over the dead end) and
   *  never reverse the current heading — reversing every tick IS the
   *  micro-jiggle */
  private wanderDir(p: PlayerState, danger: Set<number>): Dir {
    let best: Dir | null = null, bestOpen = -1
    for (const q of [0, 1, 2, 3] as Dir[]) {
      if (!this.canStep(p, q)) continue
      const [c, r] = dirVec(q)
      const nc = Math.round(p.x + c), nr = Math.round(p.y + r)
      const ahead = this.boxTilesAt(p.x + c * 0.5, p.y + r * 0.5)
      const inDanger = [...ahead].some(k => danger.has(k))
      const fc = nc + c, fr = nr + r
      const open = (this.tile(nc, nr) === T_WALK ? 4 : 0)
        + this.openNeighbors(nc, nr) * 2 + this.openNeighbors(fc, fr)
        - (inDanger ? 8 : 0)
        - (p.movingDir !== null && q === (p.movingDir ^ 1) ? 4 : 0)
      if (open > bestOpen) { bestOpen = open; best = q }
    }
    return best ?? ((p.dir ^ 1) as Dir)
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

  /** time-aware survivability (the Pommerman "is_survivable" idea): after
   *  placing a bomb on p's tile, the route by which p reaches a tile that
   *  no flame will ever cover, given the fuses of every live bomb — or
   *  null. The old gate (blastEscape) treated every blast as a permanent
   *  wall — in a 1-wide corridor a flame-1 blast covers the whole corridor
   *  segment, so the bot could NEVER bomb there and only ever evaded. In
   *  reality the fuse is 2.6s (≈11 tiles at 4.2 t/s) and the flame lasts
   *  only 0.48s (≈2 steps): walk through before it lands, or after it dies.
   *  Assumption (as in the literature): opponents place no new bombs
   *  during the horizon. The route may cross blast tiles — that is the
   *  whole point (the flame is scheduled, not a wall). `placing` marks the
   *  placement-tick call (canSurviveBomb / the bomb hook), where a bomb is
   *  about to appear on p's tile: it is scheduled as a phantom. Re-evaluation
   *  calls (threatDir, after the bot has moved) must NOT add the phantom —
   *  the real bomb is already in this.bombs with its true fuse, and a
   *  phantom at p's CURRENT tile made that tile unstandable, so every
   *  re-plan from a straddling box picked the opposite neighbour and the
   *  bot ping-ponged across the blast ring until the flame landed */
  private survivalRoute(p: PlayerState, placing: boolean = false, preferTarget?: { c: number; r: number }): { x: number; y: number }[] | null {
    const STEP = 240 // ms per tile at PLAYER_BASE_SPEED
    const HORIZON = 14
    // which tiles are on fire at each step: current flames (from now until
    // their ttl) plus every live bomb's blast during [E, E+1], where
    // E = ceil(fuse/STEP)
    const fireAt: Set<number>[] = []
    for (let s = 0; s <= HORIZON; s++) fireAt.push(new Set<number>())
    const addFire = (k: number, s0: number, s1: number) => {
      for (let s = Math.max(0, s0); s <= Math.min(HORIZON, s1); s++) fireAt[s].add(k)
    }
    for (const f of this.flames) {
      addFire(key(f.col, f.row), 0, Math.ceil((f.ttl * 1000) / STEP))
    }
    const scheduleBlast = (c: number, r: number, pow: number, fuseMs: number) => {
      const E = Math.ceil(fuseMs / STEP)
      if (E > HORIZON) return
      for (const k of this.blastSet(c, r, pow)) addFire(k, E, E + 1)
    }
    for (const b of this.bombs) scheduleBlast(b.col, b.row, b.power, b.fuse)
    // the hypothetical bomb — placement tick only (see the method doc)
    if (placing && !this.bombAt(p.col, p.row)) scheduleBlast(p.col, p.row, p.flame, BOMB_FUSE)
    // a tile is a safe haven if nothing ever burns it in the horizon and
    // no bomb sits on it (a bomb's blast would)
    const everFire = new Set<number>()
    for (const s of fireAt) for (const k of s) everFire.add(k)
    const bombTiles = new Set<number>(this.bombs.map(b => key(b.col, b.row)))
    if (placing && !this.bombAt(p.col, p.row)) bombTiles.add(key(p.col, p.row))
    // the enemy stands in the way: players block each other, and an escape
    // route that threads through the enemy's tile is no route at all (the
    // death that taught us: bomb in a 1-wide corridor, enemy parked above,
    // the bot fled into the enemy and burned in its own blast)
    const foe = this.players.find(q => q.id !== p.id && q.alive)
    const walk = (c: number, r: number): boolean =>
      c >= 1 && r >= 1 && c < COLS - 1 && r < ROWS - 1
      && this.tile(c, r) !== T_HARD
      && (this.tile(c, r) !== T_SOFT || (p.wallpassUntil ?? 0) > this.time)
      && !(foe && foe.col === c && foe.row === r)
    const safe = (k: number): boolean =>
      !everFire.has(k) && !bombTiles.has(k)
      && walk(k % COLS, Math.floor(k / COLS))
    // BFS over (tile, step); the box may straddle two tiles, so start from
    // every tile it overlaps. The start tile is the bomb tile — on fire at
    // step E — so it is never a haven; the bot must leave by then
    const seen = new Set<number>()
    const prev = new Map<number, number>()
    const q: number[] = []
    for (const k of this.boxTiles(p)) {
      if (fireAt[0].has(k)) continue // already burning: the threat override owns this
      seen.add(k * 100)
      q.push(k * 100)
    }
    let qi = 0
    // collect EVERY reachable safe haven, not just the first: the nearest
    // one is often BEHIND the bot, so "bomb → retreat to it → re-approach →
    // bomb" ping-ponged with no net progress. With a preferTarget we pick
    // the haven that advances toward the player instead
    const safeStates: number[] = []
    while (qi < q.length) {
      const st = q[qi++]
      const s = st % 100, k = Math.floor(st / 100)
      if (s >= HORIZON) continue
      const c = k % COLS, r = Math.floor(k / COLS), ns = s + 1
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]]) {
        const nc = c + dc, nr = r + dr
        if (!walk(nc, nr)) continue
        const nk = key(nc, nr)
        if (fireAt[ns].has(nk)) continue
        if (ns >= 1 && bombTiles.has(nk)) continue // can't stand on a bomb
        const st2 = nk * 100 + ns
        if (seen.has(st2)) continue
        seen.add(st2)
        prev.set(st2, st)
        if (safe(nk)) safeStates.push(st2)
        q.push(st2)
      }
    }
    if (!safeStates.length) return null
    // default / fallback: the shallowest safe haven
    let found = safeStates[0]
    for (const st of safeStates) if (st % 100 < found % 100) found = st
    if (preferTarget) {
      // advance toward the fight, but do NOT walk into the enemy's blast
      // zone. The haven must be CLOSER to the enemy than we are now (net
      // progress — the old nearest-haven retreated behind us with no
      // progress) yet at least 2 tiles out (a bomb at 1-2 tiles is a mutual
      // kill; the un-constrained "closest haven to the enemy" glued the bot
      // to a corner opponent and it burned in its own follow-up bomb)
      const botD = Math.abs(p.col - preferTarget.c) + Math.abs(p.row - preferTarget.r)
      let best = Infinity
      for (const st of safeStates) {
        const k = Math.floor(st / 100)
        const dT = Math.abs(k % COLS - preferTarget.c) + Math.abs(Math.floor(k / COLS) - preferTarget.r)
        if (dT < 2 || dT >= botD) continue
        const score = dT * 10 + (st % 100)
        if (score < best) { best = score; found = st }
      }
    }
    // reconstruct the spatial path (drop consecutive repeats from waits,
    // and the start tile)
    const path: { x: number; y: number }[] = []
    let st = found
    const tiles: number[] = []
    while (st >= 0) {
      tiles.push(Math.floor(st / 100))
      st = prev.get(st) ?? -1
    }
    tiles.reverse()
    for (let i = 1; i < tiles.length; i++) {
      if (tiles[i] === tiles[i - 1]) continue
      path.push({ x: tiles[i] % COLS, y: Math.floor(tiles[i] / COLS) })
    }
    return path.length ? path : null
  }

   /** true if, after placing a bomb on p's tile, p can survive every live
   *  fuse (see survivalRoute) */
  private canSurviveBomb(p: PlayerState): boolean {
    return this.survivalRoute(p, true) !== null
  }

  /** a walkable tile fully enclosed by bricks / hard walls. The only way in
   *  is through a brick (wallpass), and the only way out is through a brick.
   *  For an AI with a TIMED wallpass this is a death trap: when the powerup
   *  expires the bot is sealed in — no walkable exit, and no survivable bomb
   *  either (the blast reaches the brick exits on the same step the bricks
   *  break, so canSurviveBomb is false and the stall-bomb never fires). The
   *  bot just parks in there until the player wanders by with a bomb.
   *  Humans keep the choice; enemies have permanent wallpass and can leave */
  private sealedPocket(c: number, r: number): boolean {
    if (this.tile(c, r) !== T_WALK) return false
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = this.tile(c + dc, r + dr)
      if (t !== T_HARD && t !== T_SOFT) return false
    }
    return true
  }
}
