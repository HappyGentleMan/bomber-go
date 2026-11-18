import { TILE, COLS, ROWS, T_HARD, T_SOFT, POWERUP_DEFS, CANVAS_W, CANVAS_H, themeForLevel, type Theme } from './constants'
import type { Game } from './game'
import type { PlayerState, EnemyState, BombState } from './types'
import { ENEMY_DEFS } from './enemies'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export class Renderer {
  ctx: CanvasRenderingContext2D
  canvas: HTMLCanvasElement
  /** static floor pre-rendered per theme (big perf win vs per-frame fillRects) */
  private floorCache = new Map<string, HTMLCanvasElement>()
  /** pre-rendered flame sprites (gradients are expensive per-frame) */
  private flameSprite: HTMLCanvasElement | null = null
  private flameArmSprite: HTMLCanvasElement | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    this.ctx = canvas.getContext('2d')!
    this.ctx.scale(dpr, dpr)
    this.ctx.imageSmoothingEnabled = false
  }

  draw(game: Game, t: number) {
    const ctx = this.ctx
    ctx.save()
    const sh = game.getShakeOffset()
    ctx.translate(sh.x, sh.y)

    const th = themeForLevel(game.level)
    this.drawFloor(ctx, th)
    this.drawExit(ctx, game, t)
    this.drawWalls(ctx, game, th)
    this.drawPowerups(ctx, game, t)
    game.particles.draw(ctx, 'smoke')
    this.drawFlames(ctx, game, t)
    for (const b of game.bombs) this.drawBomb(ctx, b, t)
    for (const e of game.enemies) if (e.alive) this.drawEnemy(ctx, e, t, game.time)
    for (const p of game.players) if (p.alive) this.drawPlayer(ctx, p, t, game)
    game.particles.draw(ctx)

    // freeze overlay
    if (game.freezeUntil > game.time) {
      ctx.fillStyle = 'rgba(128, 222, 234, 0.08)'
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    }
    // sudden death vignette
    if (game.suddenDeath) {
      const pulse = 0.25 + 0.15 * Math.sin(t * 6)
      const g = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.35, CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.75)
      g.addColorStop(0, 'rgba(255,0,0,0)')
      g.addColorStop(1, `rgba(255,30,30,${pulse})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    }
    ctx.restore()
  }

  private getFloor(th: Theme): HTMLCanvasElement {
    let cv = this.floorCache.get(th.floor)
    if (cv) return cv
    cv = document.createElement('canvas')
    cv.width = CANVAS_W
    cv.height = CANVAS_H
    const c = cv.getContext('2d')!
    c.fillStyle = th.floor
    c.fillRect(0, 0, CANVAS_W, CANVAS_H)
    for (let r = 0; r < ROWS; r++)
      for (let cc = 0; cc < COLS; cc++) {
        if ((cc + r) % 2 === 0) {
          c.fillStyle = th.floorAlt
          c.fillRect(cc * TILE, r * TILE, TILE, TILE)
        }
      }
    // grid lines
    c.strokeStyle = th.grid
    c.lineWidth = 1
    c.beginPath()
    for (let cc = 0; cc <= COLS; cc++) { c.moveTo(cc * TILE + 0.5, 0); c.lineTo(cc * TILE + 0.5, CANVAS_H) }
    for (let r = 0; r <= ROWS; r++) { c.moveTo(0, r * TILE + 0.5); c.lineTo(CANVAS_W, r * TILE + 0.5) }
    c.stroke()
    this.floorCache.set(th.floor, cv)
    return cv
  }

  private drawFloor(ctx: CanvasRenderingContext2D, th: Theme) {
    ctx.drawImage(this.getFloor(th), 0, 0)
  }

  /** wall sprites pre-rendered per theme (no per-frame gradients) */
  private wallCache = new Map<string, { hard: HTMLCanvasElement; soft: HTMLCanvasElement }>()

  private getWallSprites(th: Theme) {
    let s = this.wallCache.get(th.floor + th.brickFill)
    if (s) return s
    const make = () => {
      const cv = document.createElement('canvas')
      cv.width = TILE; cv.height = TILE
      return cv
    }
    const hard = make(), soft = make()
    const h = hard.getContext('2d')!, b = soft.getContext('2d')!
    const T = TILE
    // hard wall
    h.fillStyle = th.hardFill
    roundRect(h, 1, 1, T - 2, T - 2, 8); h.fill()
    h.strokeStyle = th.hardEdge
    h.lineWidth = 1.5
    roundRect(h, 2, 2, T - 4, T - 4, 7); h.stroke()
    h.fillStyle = 'rgba(255,255,255,0.04)'
    roundRect(h, 9, 9, T - 18, T - 18, 4); h.fill()
    // soft brick
    b.fillStyle = th.brickFill
    roundRect(b, 1, 1, T - 2, T - 2, 6); b.fill()
    b.strokeStyle = 'rgba(0,0,0,0.35)'
    b.lineWidth = 1
    b.beginPath()
    b.moveTo(2, T / 2); b.lineTo(T - 2, T / 2)
    b.moveTo(T / 2, 2); b.lineTo(T / 2, T / 2)
    b.moveTo(T / 4, T / 2); b.lineTo(T / 4, T - 2)
    b.moveTo(T * 3 / 4, T / 2); b.lineTo(T * 3 / 4, T - 2)
    b.stroke()
    b.strokeStyle = th.brickEdge
    b.lineWidth = 1.5
    roundRect(b, 2, 2, T - 4, T - 4, 5); b.stroke()
    const g = b.createLinearGradient(0, 0, 0, T)
    g.addColorStop(0, th.brickLight)
    g.addColorStop(0.5, 'rgba(0,0,0,0)')
    b.fillStyle = g
    roundRect(b, 2, 2, T - 4, T - 4, 5); b.fill()
    s = { hard, soft }
    this.wallCache.set(th.floor + th.brickFill, s)
    return s
  }

  private drawWalls(ctx: CanvasRenderingContext2D, game: Game, th: Theme) {
    const s = this.getWallSprites(th)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const tile = game.grid[r][c].t
        if (tile === T_HARD) ctx.drawImage(s.hard, c * TILE, r * TILE)
        else if (tile === T_SOFT) ctx.drawImage(s.soft, c * TILE, r * TILE)
      }
  }

  private drawExit(ctx: CanvasRenderingContext2D, game: Game, t: number) {
    if (!game.exit.revealed) return
    const x = game.exit.col * TILE + TILE / 2
    const y = game.exit.row * TILE + TILE / 2
    const active = game.enemies.every(e => !e.alive)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(t * (active ? 2 : 0.6))
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 0
        ? (active ? `rgba(0,229,255,${0.9})` : 'rgba(0,229,255,0.35)')
        : i === 1 ? 'rgba(255,46,136,0.5)' : 'rgba(255,213,74,0.4)'
      ctx.lineWidth = 3 - i * 0.7
      ctx.beginPath()
      ctx.arc(0, 0, 14 - i * 4, i * 2.1, i * 2.1 + Math.PI * 1.4)
      ctx.stroke()
    }
    if (active) {
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 20)
      g.addColorStop(0, 'rgba(0,229,255,0.5)')
      g.addColorStop(1, 'rgba(0,229,255,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()
  }

  private drawPowerups(ctx: CanvasRenderingContext2D, game: Game, t: number) {
    for (const u of game.powerups) {
      const def = POWERUP_DEFS[u.kind]
      const x = u.col * TILE + TILE / 2
      const y = u.row * TILE + TILE / 2 + Math.sin(t * 3 + u.col) * 2
      ctx.save()
      ctx.translate(x, y)
      // glow
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 20)
      g.addColorStop(0, def.color + 'aa')
      g.addColorStop(1, def.color + '00')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill()
      // capsule
      ctx.fillStyle = '#0d1322'
      roundRect(ctx, -13, -13, 26, 26, 8)
      ctx.fill()
      ctx.strokeStyle = def.color
      ctx.lineWidth = 2
      roundRect(ctx, -13, -13, 26, 26, 8)
      ctx.stroke()
      ctx.fillStyle = def.color
      ctx.font = '900 13px "Avenir Next", system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(def.glyph, 0, 1)
      ctx.restore()
    }
  }

  private drawBomb(ctx: CanvasRenderingContext2D, b: BombState, t: number) {
    const x = b.col * TILE + TILE / 2
    const y = b.row * TILE + TILE / 2
    const pulse = 1 + 0.08 * Math.sin(t * (10 + (1 - b.fuse / 2600) * 20))
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(pulse, pulse)
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath(); ctx.ellipse(0, 12, 14, 5, 0, 0, Math.PI * 2); ctx.fill()
    // body
    const g = ctx.createRadialGradient(-4, -5, 2, 0, 0, 15)
    g.addColorStop(0, '#4a5568')
    g.addColorStop(0.5, '#1a202c')
    g.addColorStop(1, '#0a0d14')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill()
    // owner ring
    if (b.owner === 0) ctx.strokeStyle = 'rgba(0,229,255,0.8)'
    else if (b.owner === 1) ctx.strokeStyle = 'rgba(255,46,136,0.8)'
    else ctx.strokeStyle = 'rgba(255,80,80,0.9)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke()
    // highlight
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.beginPath(); ctx.arc(-4, -5, 4, 0, Math.PI * 2); ctx.fill()
    // fuse spark
    const spark = Math.random()
    if (spark > 0.5) {
      ctx.fillStyle = spark > 0.85 ? '#ffd54a' : '#ff9800'
      ctx.beginPath()
      ctx.arc(2 + (Math.random() - 0.5) * 6, -14 - Math.random() * 4, 1.5 + Math.random() * 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  private getFlameSprite(): HTMLCanvasElement {
    if (this.flameSprite) return this.flameSprite
    const cv = document.createElement('canvas')
    cv.width = 128; cv.height = 128
    const c = cv.getContext('2d')!
    const g = c.createRadialGradient(64, 64, 1, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,230,0.98)')
    g.addColorStop(0.4, 'rgba(255,190,60,0.92)')
    g.addColorStop(0.8, 'rgba(255,90,30,0.7)')
    g.addColorStop(1, 'rgba(255,40,20,0)')
    c.fillStyle = g
    c.beginPath(); c.arc(64, 64, 64, 0, Math.PI * 2); c.fill()
    c.fillStyle = 'rgba(255,255,240,0.9)'
    c.beginPath(); c.arc(64, 64, 22, 0, Math.PI * 2); c.fill()
    this.flameSprite = cv
    return cv
  }

  private getFlameArmSprite(): HTMLCanvasElement {
    if (this.flameArmSprite) return this.flameArmSprite
    const cv = document.createElement('canvas')
    cv.width = 128; cv.height = 128
    const c = cv.getContext('2d')!
    // arm starts at centre (64,64), points +x
    const g = c.createLinearGradient(64, 0, 157, 0)
    g.addColorStop(0, 'rgba(255,200,90,0.9)')
    g.addColorStop(1, 'rgba(255,90,30,0.25)')
    c.fillStyle = g
    roundRect(c, 64, 64 - 35, 93, 70, 35)
    c.fill()
    this.flameArmSprite = cv
    return cv
  }

  private drawFlames(ctx: CanvasRenderingContext2D, game: Game, t: number) {
    const seen = new Set<string>()
    const angles = [0, Math.PI, Math.PI / 2, -Math.PI / 2]
    const blob = this.getFlameSprite()
    const arm = this.getFlameArmSprite()
    for (const f of game.flames) {
      const id = `${f.col},${f.row},${f.dir}`
      if (seen.has(id)) continue
      seen.add(id)
      const x = f.col * TILE + TILE / 2
      const y = f.row * TILE + TILE / 2
      const life = f.ttl / (0.48)
      const flick = 0.85 + 0.15 * Math.sin(t * 30 + f.seed * 40)
      const size = (TILE / 2 - 2) * Math.min(1, life * 3) * flick
      const k = size / 64 // sprite scale (sprite radius = 64)
      ctx.save()
      ctx.translate(x, y)
      ctx.globalAlpha = Math.min(1, life)
      // continuous arm bar toward the blast direction
      if (f.dir >= 0) {
        ctx.save()
        ctx.rotate(angles[f.dir])
        ctx.drawImage(arm, -64 * k, -64 * k, 128 * k, 128 * k)
        ctx.restore()
      }
      // flame blob (wobble approximated as scale jitter)
      const wob = 0.94 + 0.06 * Math.sin(t * 25 + f.seed * 20)
      ctx.drawImage(blob, -64 * k * wob, -64 * k * wob, 128 * k * wob, 128 * k * wob)
      ctx.restore()
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, p: PlayerState, t: number, game: Game) {
    const x = p.x * TILE + TILE / 2
    const y = p.y * TILE + TILE / 2
    // spawn blink
    if (p.invincibleUntil > game.time && Math.sin(t * 20) > 0) return
    ctx.save()
    ctx.translate(x, y)
    const bob = p.moving ? Math.sin(t * 14) * 2 : Math.sin(t * 3) * 1
    ctx.translate(0, bob)

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath(); ctx.ellipse(0, 14 - bob, 12, 4.5, 0, 0, Math.PI * 2); ctx.fill()

    // shield ring
    if (p.shieldUntil > game.time) {
      ctx.strokeStyle = `rgba(105,240,174,${0.6 + 0.3 * Math.sin(t * 6)})`
      ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke()
    }
    // invincible aura
    if (p.invincibleUntil > game.time) {
      const g = ctx.createRadialGradient(0, 0, 6, 0, 0, 22)
      g.addColorStop(0, 'rgba(255,213,74,0)')
      g.addColorStop(0.8, `rgba(255,213,74,${0.35 + 0.15 * Math.sin(t * 8)})`)
      g.addColorStop(1, 'rgba(255,213,74,0)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill()
    }
    // wallpass ghost
    if (p.wallpassUntil > game.time) ctx.globalAlpha = 0.65

    const bodyC = p.color
    // body
    ctx.fillStyle = bodyC
    roundRect(ctx, -13, -12, 26, 26, 9)
    ctx.fill()
    // helmet top
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    roundRect(ctx, -13, -14, 26, 14, 9)
    ctx.fill()
    ctx.fillStyle = bodyC
    ctx.fillRect(-13, -4, 26, 4)
    // eyes
    const [dc, dr] = [[1, 0], [-1, 0], [0, 1], [0, -1]][p.dir]
    const ex = dc * 3, ey = dr * 2
    ctx.fillStyle = '#0d1322'
    ctx.beginPath(); ctx.arc(-5 + ex, 1 + ey, 3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(5 + ex, 1 + ey, 3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(-4 + ex, 0 + ey, 1, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(6 + ex, 0 + ey, 1, 0, Math.PI * 2); ctx.fill()
    // feet
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    const step = p.moving ? Math.sin(t * 16) * 3 : 0
    ctx.fillRect(-9, 13 + step * 0.4, 6, 3)
    ctx.fillRect(3, 13 - step * 0.4, 6, 3)

    ctx.restore()
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: EnemyState, t: number, gt: number) {
    const def = ENEMY_DEFS[e.type]
    const x = e.x * TILE + TILE / 2
    const y = e.y * TILE + TILE / 2
    ctx.save()
    ctx.translate(x, y)
    // spawn pop-in
    const age = gt - e.born
    if (age < 0.3) ctx.scale(0.2 + 0.8 * Math.min(1, age / 0.3), 0.2 + 0.8 * Math.min(1, age / 0.3))
    const bob = e.moving ? Math.sin(t * 12 + e.seed * 10) * 2.5 : Math.sin(t * 2.5 + e.seed * 10) * 1.5
    ctx.translate(0, bob)
    if (e.frozen) ctx.globalAlpha = 0.8

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.beginPath(); ctx.ellipse(0, 15 - bob, 11, 4, 0, 0, Math.PI * 2); ctx.fill()

    const c = def.color
    switch (e.type) {
      case 'balloom': {
        ctx.fillStyle = c
        ctx.beginPath(); ctx.arc(0, -2, 13, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.beginPath(); ctx.arc(-4, -6, 4, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = c
        ctx.beginPath(); ctx.moveTo(-3, 10); ctx.lineTo(3, 10); ctx.lineTo(0, 15); ctx.closePath(); ctx.fill()
        break
      }
      case 'oneal': {
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.moveTo(0, -16)
        ctx.bezierCurveTo(12, -8, 13, 6, 0, 13)
        ctx.bezierCurveTo(-13, 6, -12, -8, 0, -16)
        ctx.fill()
        ctx.strokeStyle = c
        ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(0, -16); ctx.quadraticCurveTo(4, -20, 7, -19); ctx.stroke()
        break
      }
      case 'doll': {
        ctx.fillStyle = c
        roundRect(ctx, -12, -13, 24, 26, 6)
        ctx.fill()
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(-12, -3, 24, 3)
        ctx.fillRect(-12, 7, 24, 3)
        break
      }
      case 'minvo': {
        ctx.fillStyle = c
        ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill()
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + t * 2
          ctx.beginPath()
          ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10)
          ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16)
          ctx.lineTo(Math.cos(a + 0.35) * 10, Math.sin(a + 0.35) * 10)
          ctx.closePath()
          ctx.fill()
        }
        break
      }
      case 'kondoria': {
        ctx.globalAlpha *= 0.85
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.arc(0, -2, 13, Math.PI, 0)
        ctx.lineTo(13, 12)
        for (let i = 3; i >= 0; i--) {
          ctx.quadraticCurveTo(13 - i * 6.5 - 3, 16 + Math.sin(t * 6 + i) * 2, 13 - (i + 1) * 6.5, 12)
        }
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'ovapi': {
        ctx.fillStyle = c
        ctx.beginPath()
        ctx.moveTo(0, -15)
        ctx.bezierCurveTo(14, -10, 15, 8, 0, 13)
        ctx.bezierCurveTo(-15, 8, -14, -10, 0, -15)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.3)'
        ctx.beginPath(); ctx.arc(-4, -5, 4, 0, Math.PI * 2); ctx.fill()
        break
      }
      case 'pass': {
        ctx.fillStyle = c
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = '#ff8f00'
        ctx.lineWidth = 3
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath()
          ctx.moveTo(i * 6 - 3, -12)
          ctx.quadraticCurveTo(i * 6 + 2, 0, i * 6 - 3, 12)
          ctx.stroke()
        }
        break
      }
      case 'pontan': {
        ctx.rotate(t * 4)
        ctx.fillStyle = c
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = c
        ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill()
        ctx.rotate(-t * 4)
        break
      }
    }
    // eyes
    ctx.fillStyle = def.eyes
    ctx.beginPath(); ctx.arc(-4, -3, 3.4, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(4, -3, 3.4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#111'
    const [dc, dr] = [[1, 0], [-1, 0], [0, 1], [0, -1]][e.dir]
    ctx.beginPath(); ctx.arc(-4 + dc * 1.5, -3 + dr * 1.5, 1.6, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(4 + dc * 1.5, -3 + dr * 1.5, 1.6, 0, Math.PI * 2); ctx.fill()
    // hp > 1 indicator: small dot
    if (def.hp > 1) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath(); ctx.arc(0, -17, 2, 0, Math.PI * 2); ctx.fill()
    }
    // frozen overlay
    if (e.frozen) {
      ctx.fillStyle = 'rgba(128,222,234,0.45)'
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#e0f7fa'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        ctx.moveTo(0, 0)
        ctx.lineTo(Math.cos(a) * 14, Math.sin(a) * 14)
      }
      ctx.stroke()
    }
    ctx.restore()
  }
}
