import {
  COLS, ROWS, T_WALK, T_HARD, T_SOFT, DIRS,
  PLAYER_BASE_SPEED, PLAYER_SPEED_STEP, PLAYER_MAX_SPEED_LEVELS,
  BOMB_FUSE, BOMB_FUSE_MIN, FLAME_DURATION, SPAWN_INVULN,
  SHIELD_DURATION, INVINCIBLE_DURATION, WALLPASS_DURATION, FREEZE_DURATION, KICK_DURATION,
  MAX_BOMBS, MAX_FLAME, START_LIVES, LEVEL_TIME, BATTLE_TIME,
  POWERUP_DEFS,
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
  killChain = 0
  clearTimer = 0
  overTimer = 0
  lastKiller: number = -1
  winner: number = -1 // battle
  bombId = 1
  exitTimer = 0
  particles = new Particles()
  shakeMag = 0
  shakeDur = 0
  shakeT = 0

  onEvent: ((ev: string, data?: any) => void) | null = null

  constructor(mode: 'campaign' | 'battle', opts: { aiPlayer2?: boolean; attract?: boolean } = {}) {
    this.mode = mode
    this.attract = opts.attract ?? false
    this.levelTime = mode === 'campaign' ? LEVEL_TIME : BATTLE_TIME
    this.def = mode === 'campaign' ? generateLevel(1) : generateBattleMap()
    this.grid = this.def.grid
    this.spawnPlayers(opts.aiPlayer2 ?? false)
    if (mode === 'battle') this.exit = { col: -1, row: -1, revealed: false }
    else { this.exit = { col: this.def.exitCol, row: this.def.exitRow, revealed: false }; this.spawnEnemies() }
  }

  shake(mag: number, dur: number) {
    this.shakeMag = Math.max(this.shakeMag, mag)
    this.shakeDur = Math.max(this.shakeDur, dur)
    this.shakeT = Math.max(this.shakeT, dur)
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
      dir: 0, moving: false, movingDir: null,
      speed: PLAYER_BASE_SPEED,
      bombs: 1, flame: 1,
      shieldUntil: 0, invincibleUntil: 0, wallpassUntil: 0, kickUntil: 0,
      frozenUntil: 0,
      alive: true, respawnIn: 0,
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
        dir: Math.floor(Math.random() * 4) as Dir,
        moving: false, movingDir: null,
        moveTimer: 0, aiTimer: Math.random() * 2,
        hp: def.hp, alive: true, frozen: false, deadAt: 0,
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
    this.powerups = []
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
    const fuse = Math.max(BOMB_FUSE_MIN, BOMB_FUSE - (this.level - 1) * 60)
    this.bombs.push({
      id: this.bombId++, owner: p.id,
      col: p.col, row: p.row,
      fuse, power: p.flame, born: this.time,
    })
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
      if (inp.dir !== null) p.movingDir = inp.dir
      if (inp.bomb) this.tryPlaceBomb(p)
      if (inp.detonate) {
        const oldest = this.bombs.filter(b => b.owner === p.id).sort((a, b) => a.born - b.born)[0]
        if (oldest) this.detonate(oldest)
      }
      if (p.frozenUntil > this.time) { p.moving = false; p.movingDir = null; this.pickupPowerups(p); continue }
      this.moveEntity(p, dt)
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

  moveEntity(e: { col: number; row: number; x: number; y: number; dir: Dir; moving: boolean; movingDir: Dir | null; speed: number }, dt: number) {
    if (!e.moving) {
      const d = e.movingDir
      if (d !== null) {
        const [dc, dr] = dirVec(d)
        if (this.canEnter(e, e.col + dc, e.row + dr)) {
          e.dir = d
          e.moving = true
          e.movingDir = null
          if (Math.random() < 0.5) audio.play('step')
        } else {
          e.movingDir = null
        }
      }
      return
    }
    const [dc, dr] = dirVec(e.dir)
    e.x += dc * e.speed * dt
    e.y += dr * e.speed * dt
    const nc = e.col + dc, nr = e.row + dr
    const arrived = dc !== 0
      ? (dc > 0 ? e.x >= nc : e.x <= nc)
      : (dr > 0 ? e.y >= nr : e.y <= nr)
    if (arrived) {
      e.col = nc; e.row = nr
      e.x = nc; e.y = nr
      e.moving = false
      this.onEntityArrive(e)
    }
  }

  onEntityArrive(e: { col: number; row: number; isAI?: boolean }) {
    if ('isAI' in e && e.isAI) {
      const p = e as unknown as PlayerState
      // kick bombs
      if (p.kickUntil > this.time) {
        const [dc, dr] = dirVec(p.dir)
        const tc = p.col + dc, tr = p.row + dr
        const b = this.bombAt(tc, tr)
        if (b) {
          const kc = tc + dc, kr = tr + dr
          if (this.tile(kc, kr) === T_WALK && !this.bombAt(kc, kr) && !this.enemyAt(kc, kr)) {
            b.col = kc; b.row = kr
            audio.play('kick')
            this.particles.text(kc * 48 + 24, kr * 48 + 12, 'KICK!', '#ffab91')
          }
        }
      }
    }
  }

  levelClear() {
    if (this.state !== 'playing') return
    this.state = 'levelclear'
    this.clearTimer = 2.2
    const bonus = Math.floor(this.levelTime - this.time) * 10
    this.score += bonus
    if (this.level % 4 === 0) this.lives++
    audio.play('levelClear')
    this.emit('levelclear', { level: this.level, bonus, score: this.score, lives: this.lives })
  }

  killPlayer(p: PlayerState, cause: 'flame' | 'enemy') {
    if (p.invincibleUntil > this.time && cause === 'enemy') return
    p.alive = false
    // drop temp powerups
    p.shieldUntil = 0; p.wallpassUntil = 0; p.kickUntil = 0
    const cx = p.x * 48 + 24, cy = p.y * 48 + 24
    this.particles.burst(cx, cy, p.color, 26, 220)
    this.particles.burst(cx, cy, '#ffffff', 12, 140)
    this.shake(10, 0.4)
    audio.play('hurt')
    if (this.mode === 'battle') {
      p.respawnIn = 2.5
      this.lastKiller = -1
      // credit kill to opponent (unless sudden-death bomb or mutual kill)
      const opp = this.players.find(q => q.id !== p.id)
      const suddenBomb = this.bombs.some(b => b.owner === -1)
      if (opp && opp.alive && !suddenBomb) opp.kills++
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
      const speed = def.speed * speedMul * (e.frozen ? 0 : 1)
      this.moveEnemy(e, dt, speed, def, target)
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
    if (!e.moving) {
      if (e.aiTimer <= 0) {
        e.dir = this.enemyDecide(e, def, target)
        e.aiTimer = def.ai === 'wander' ? 1.2 + e.seed * 1.5 : 0
      }
      const [dc, dr] = dirVec(e.dir)
      if (this.canEnter(e, e.col + dc, e.row + dr)) {
        e.moving = true
        e.movingDir = null
      } else {
        e.aiTimer = 0 // blocked: redecide immediately next frame
        e.dir = this.enemyDecide(e, def, target)
        const [dc2, dr2] = dirVec(e.dir)
        if (this.canEnter(e, e.col + dc2, e.row + dr2)) { e.moving = true; e.movingDir = null }
      }
      return
    }
    e.x += dirVec(e.dir)[0] * speed * dt
    e.y += dirVec(e.dir)[1] * speed * dt
    const [dc, dr] = dirVec(e.dir)
    const nc = e.col + dc, nr = e.row + dr
    const arrived = dc !== 0 ? (dc > 0 ? e.x >= nc : e.x <= nc) : (dr > 0 ? e.y >= nr : e.y <= nr)
    if (arrived) {
      e.col = nc; e.row = nr; e.x = nc; e.y = nr
      e.moving = false
      e.aiTimer = def.ai === 'wander' ? 0.8 + e.seed * 1.8 : 0
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
    audio.play('boom')
    if (smash) this.shake(6, 0.25)
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
    // powerup?
    const pi = this.powerups.findIndex(u => u.col === c && u.row === r)
    if (pi >= 0) this.powerups[pi] // revealed (stays in list, drawn now)
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
    // drop a random bomb near a random alive player
    const alive = this.players.filter(p => p.alive)
    if (!alive.length) return
    const p = alive[Math.floor(Math.random() * alive.length)]
    let c = p.col, r = p.row
    for (let tries = 0; tries < 8; tries++) {
      c = 1 + Math.floor(Math.random() * (COLS - 2))
      r = 1 + Math.floor(Math.random() * (ROWS - 2))
      if (this.tile(c, r) === T_WALK && !this.bombAt(c, r) &&
        !this.players.some(pl => pl.alive && pl.col === c && pl.row === r)) break
    }
    this.bombs.push({ id: this.bombId++, owner: -1, col: c, row: r, fuse: 1500, power: 2, born: this.time })
    audio.play('bomb')
  }

  endBattle(winner: number | -1) {
    this.state = 'battleover'
    this.winner = winner
    this.emit('battleover', { winner })
    if (winner >= 0) audio.play('levelClear')
    else audio.play('gameOver')
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

    this.time += dt

    // level timer
    const remaining = this.levelTime - this.time
    if (this.mode === 'campaign') {
      if (remaining <= 30 && !this.suddenDeath) {
        this.suddenDeath = true
        this.emit('suddendeath')
      }
      if (this.suddenDeath) {
        this.suddenTick -= dt
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
        this.suddenTick -= dt
        if (this.suddenTick <= 0) {
          this.suddenTick = 2
          this.battleSuddenDeath()
        }
      }
    }

    // input for players
    const ins = this.players.map(p =>
      p.isAI ? this.aiThink(p) : (p.id === 0 ? inputs.p1 : inputs.p2))
    this.updatePlayers(dt, ins)

    this.updateEnemies(dt)
    this.updateBombs(dt)
    this.updateFlames(dt)
    this.particles.update(dt)
    this.updateShake(dt)

    // exit progress
    const p0 = this.players[0]
    if (this.mode === 'campaign' && this.state === 'playing' && this.exit.revealed
      && this.enemies.every(e => !e.alive) && p0.alive
      && p0.col === this.exit.col && p0.row === this.exit.row) {
      this.exitTimer += dt
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

  private aiState = new Map<number, { path: { x: number; y: number }[]; repath: number }>()

  aiThink(p: PlayerState): { dir: Dir | null; bomb: boolean; detonate: boolean } {
    const out = { dir: null as Dir | null, bomb: false, detonate: false }
    if (!p.alive) return out
    const enemy = this.players.find(q => q.id !== p.id && q.alive)
    const enemyE = !enemy && this.mode === 'campaign' ? this.enemies.find(e => e.alive) : undefined
    if (!enemy && !enemyE) return out
    const tc = enemy ? enemy.col : enemyE!.col
    const tr = enemy ? enemy.row : enemyE!.row

    // 1. immediate danger override
    const threat = this.threatDir(p)
    if (threat !== null) {
      this.aiState.delete(p.id)
      return { ...out, dir: threat }
    }

    // 2. path following (replan periodically)
    let st = this.aiState.get(p.id)
    if (!st || this.time > st.repath) {
      let target = { c: tc, r: tr }
      let best = 99
      for (const u of this.powerups) {
        const d = Math.abs(u.col - p.col) + Math.abs(u.row - p.row)
        if (d < best && d < 12) { best = d; target = { c: u.col, r: u.row } }
      }
      const path = this.bfs(p.col, p.row, target.c, target.r, false) ?? []
      st = { path, repath: this.time + 0.5 }
      this.aiState.set(p.id, st)
    }
    while (st.path.length && st.path[0].x === p.col && st.path[0].y === p.row) st.path.shift()
    if (st.path.length) {
      const dc = st.path[0].x - p.col, dr = st.path[0].y - p.row
      out.dir = dc === 1 ? 0 : dc === -1 ? 1 : dr === 1 ? 2 : 3
    } else if (this.time > st.repath) {
      out.dir = Math.floor(Math.random() * 4) as Dir
      st.repath = this.time + 0.3
    }

    // 3. bomb when close, detonate when it will hit
    const myBombs = this.bombs.filter(b => b.owner === p.id)
    if (enemy) {
      const distEnemy = Math.abs(enemy.col - p.col) + Math.abs(enemy.row - p.row)
      if (distEnemy <= p.flame + 1 && !this.bombAt(p.col, p.row)
        && myBombs.length < p.bombs && this.hasEscape(p)) {
        out.bomb = true
      }
      if (myBombs.length) {
        const b = myBombs.sort((a, b) => a.born - b.born)[0]
        if (this.bombHits(b, enemy.col, enemy.row)) out.detonate = true
      }
    } else if (enemyE) {
      // campaign: bomb when a straight flame line reaches the enemy
      const sameRow = enemyE.row === p.row && Math.abs(enemyE.col - p.col) <= p.flame
      const sameCol = enemyE.col === p.col && Math.abs(enemyE.row - p.row) <= p.flame
      if ((sameRow || sameCol) && !this.bombAt(p.col, p.row) && myBombs.length < p.bombs) {
        // check clear line
        let clear = true
        const dc = Math.sign(enemyE.col - p.col), dr = Math.sign(enemyE.row - p.row)
        for (let i = 1; i <= Math.abs(enemyE.col - p.col) + Math.abs(enemyE.row - p.row) - 1; i++) {
          const t = this.tile(p.col + dc * i, p.row + dr * i)
          if (t !== T_WALK) { clear = false; break }
        }
        if (clear) out.bomb = true
      }
    }
    return out
  }

  private threatDir(p: PlayerState): Dir | null {
    const flame = this.flameSet()
    const [dc, dr] = dirVec(p.dir)
    if (flame.has(key(p.col + dc, p.row + dr)) || flame.has(key(p.col, p.row))) {
      // pick a safe perpendicular / any safe tile
      let best: Dir | null = null, bestScore = -1
      for (const q of [2, 3, 0, 1] as Dir[]) {
        const [c2, r2] = dirVec(q)
        const nc = p.col + c2, nr = p.row + r2
        if (this.canEnter(p, nc, nr) && !flame.has(key(nc, nr))) {
          const s = (nc === p.col + dc && nr === p.row + dr) ? 0 : 1
          if (s > bestScore) { bestScore = s; best = q }
        }
      }
      if (best) return best
    }
    // bombs about to explode nearby: run to the farthest safe tile
    for (const b of this.bombs) {
      const d = Math.abs(b.col - p.col) + Math.abs(b.row - p.row)
      if (d <= 2 && b.fuse < 900) {
        let best: Dir | null = null, bestD = 1
        for (const q of [0, 1, 2, 3] as Dir[]) {
          const [c2, r2] = dirVec(q)
          const nc = p.col + c2, nr = p.row + r2
          if (this.canEnter(p, nc, nr) && !flame.has(key(nc, nr))) {
            const dist = Math.abs(nc - b.col) + Math.abs(nr - b.row)
            if (dist > bestD) { bestD = dist; best = q }
          }
        }
        if (best) return best
      }
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

  private hasEscape(p: PlayerState): boolean {
    for (const d of DIRS) {
      const c = p.col + d.x, r = p.row + d.y
      if (this.tile(c, r) === T_WALK && !this.bombAt(c, r) && !this.enemyAt(c, r)) return true
    }
    return false
  }
}
