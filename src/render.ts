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
    for (const e of game.enemies) if (e.alive) this.drawEnemy(ctx, e, t)
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

  private drawFloor(ctx: CanvasRenderingContext2D, th: Theme) {
    ctx.fillStyle = th.floor
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if ((c + r) % 2 === 0) {
          ctx.fillStyle = th.floorAlt
          ctx.fillRect(c * TILE, r * TILE, TILE, TILE)
        }
      }
    // grid lines
    ctx.strokeStyle = th.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let c = 0; c <= COLS; c++) { ctx.moveTo(c * TILE + 0.5, 0); ctx.lineTo(c * TILE + 0.5, CANVAS_H) }
    for (let r = 0; r <= ROWS; r++) { ctx.moveTo(0, r * TILE + 0.5); ctx.lineTo(CANVAS_W, r * TILE + 0.5) }
    ctx.stroke()
  }

  private drawWalls(ctx: CanvasRenderingContext2D, game: Game, th: Theme) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const tile = game.grid[r][c].t
        if (tile === T_HARD) this.drawHardWall(ctx, c, r, th)
        else if (tile === T_SOFT) this.drawSoftWall(ctx, c, r, th)
      }
  }

  private drawHardWall(ctx: CanvasRenderingContext2D, c: number, r: number, th: Theme) {
    const x = c * TILE, y = r * TILE
    ctx.fillStyle = th.hardFill
    roundRect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 8)
    ctx.fill()
    ctx.strokeStyle = th.hardEdge
    ctx.lineWidth = 1.5
    roundRect(ctx, x + 2, y + 2, TILE - 4, TILE - 4, 7)
    ctx.stroke()
    // inner panel
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    roundRect(ctx, x + 9, y + 9, TILE - 18, TILE - 18, 4)
    ctx.fill()
  }

  private drawSoftWall(ctx: CanvasRenderingContext2D, c: number, r: number, th: Theme) {
    const x = c * TILE, y = r * TILE
    ctx.fillStyle = th.brickFill
    roundRect(ctx, x + 1, y + 1, TILE - 2, TILE - 2, 6)
    ctx.fill()
    // brick lines
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x + 2, y + TILE / 2)
    ctx.lineTo(x + TILE - 2, y + TILE / 2)
    ctx.moveTo(x + TILE / 2, y + 2)
    ctx.lineTo(x + TILE / 2, y + TILE / 2)
    ctx.moveTo(x + TILE / 4, y + TILE / 2)
    ctx.lineTo(x + TILE / 4, y + TILE - 2)
    ctx.moveTo(x + TILE * 3 / 4, y + TILE / 2)
    ctx.lineTo(x + TILE * 3 / 4, y + TILE - 2)
    ctx.stroke()
    // neon edge
    ctx.strokeStyle = th.brickEdge
    ctx.lineWidth = 1.5
    roundRect(ctx, x + 2, y + 2, TILE - 4, TILE - 4, 5)
    ctx.stroke()
    // subtle top light
    const g = ctx.createLinearGradient(x, y, x, y + TILE)
    g.addColorStop(0, th.brickLight)
    g.addColorStop(0.5, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    roundRect(ctx, x + 2, y + 2, TILE - 4, TILE - 4, 5)
    ctx.fill()
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

  private drawFlames(ctx: CanvasRenderingContext2D, game: Game, t: number) {
    const seen = new Set<string>()
    const angles = [0, Math.PI, Math.PI / 2, -Math.PI / 2]
    for (const f of game.flames) {
      const id = `${f.col},${f.row},${f.dir}`
      if (seen.has(id)) continue
      seen.add(id)
      const x = f.col * TILE + TILE / 2
      const y = f.row * TILE + TILE / 2
      const life = f.ttl / (0.48)
      const flick = 0.85 + 0.15 * Math.sin(t * 30 + f.seed * 40)
      const size = (TILE / 2 - 2) * Math.min(1, life * 3) * flick
      ctx.save()
      ctx.translate(x, y)
      // continuous arm bar toward the blast direction
      if (f.dir >= 0) {
        ctx.save()
        ctx.rotate(angles[f.dir])
        const g2 = ctx.createLinearGradient(0, 0, size * 1.4, 0)
        g2.addColorStop(0, `rgba(255,200,90,${0.9 * life})`)
        g2.addColorStop(1, `rgba(255,90,30,${0.25 * life})`)
        ctx.fillStyle = g2
        roundRect(ctx, 0, -size * 0.55, size * 1.45, size * 1.1, size * 0.55)
        ctx.fill()
        ctx.restore()
      }
      // outer
      const g = ctx.createRadialGradient(0, 0, 1, 0, 0, size)
      g.addColorStop(0, `rgba(255,255,230,${Math.min(1, 0.98 * life)})`)
      g.addColorStop(0.4, `rgba(255,190,60,${Math.min(1, 0.92 * life)})`)
      g.addColorStop(0.8, `rgba(255,90,30,${0.7 * life})`)
      g.addColorStop(1, 'rgba(255,40,20,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      // flame blob with wobble
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 8) {
        const w = size * (0.85 + 0.2 * Math.sin(a * 3 + t * 25 + f.seed * 20))
        const px = Math.cos(a) * w, py = Math.sin(a) * w
        if (a === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.fill()
      // inner core
      ctx.fillStyle = `rgba(255,255,240,${0.9 * life})`
      ctx.beginPath(); ctx.arc(0, 0, size * 0.35, 0, Math.PI * 2); ctx.fill()
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

  private drawEnemy(ctx: CanvasRenderingContext2D, e: EnemyState, t: number) {
    const def = ENEMY_DEFS[e.type]
    const x = e.x * TILE + TILE / 2
    const y = e.y * TILE + TILE / 2
    ctx.save()
    ctx.translate(x, y)
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
