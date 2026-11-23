import { TILE } from './constants'

interface Particle {
  x: number; y: number
  vx: number; vy: number
  life: number; maxLife: number
  size: number
  color: string
  kind: 'spark' | 'smoke' | 'ring' | 'text' | 'debris'
  text?: string
  grav: number
}

export class Particles {
  list: Particle[] = []

  clear() { this.list.length = 0 }

  burst(cx: number, cy: number, color: string, n = 14, speed = 160) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.3 + Math.random() * 0.9)
      this.list.push({
        x: cx, y: cy,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0, maxLife: 0.35 + Math.random() * 0.4,
        size: 2 + Math.random() * 3,
        color, kind: 'spark', grav: 300,
      })
    }
  }

  explosion(cx: number, cy: number) {
    this.list.push({
      x: cx, y: cy, vx: 0, vy: 0,
      life: 0, maxLife: 0.4, size: 8,
      color: '#ffd54a', kind: 'ring', grav: 0,
    })
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 60 + Math.random() * 220
      this.list.push({
        x: cx, y: cy,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0, maxLife: 0.3 + Math.random() * 0.5,
        size: 2 + Math.random() * 4,
        color: i % 3 === 0 ? '#ff9800' : i % 3 === 1 ? '#ff5252' : '#ffd54a',
        kind: 'spark', grav: 200,
      })
    }
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 20 + Math.random() * 60
      this.list.push({
        x: cx, y: cy,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 30,
        life: 0, maxLife: 0.6 + Math.random() * 0.5,
        size: 6 + Math.random() * 8,
        color: 'rgba(60,60,70,0.5)',
        kind: 'smoke', grav: -40,
      })
    }
  }

  dust(cx: number, cy: number) {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2
      const s = 15 + Math.random() * 35
      this.list.push({
        x: cx + (Math.random() - 0.5) * 10, y: cy + (Math.random() - 0.5) * 10,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10,
        life: 0, maxLife: 0.3 + Math.random() * 0.2,
        size: 2 + Math.random() * 2,
        color: 'rgba(150,150,165,0.5)', kind: 'smoke', grav: 0,
      })
    }
  }

  /** movement trail: a small fading dot in the player's color */
  trail(x: number, y: number, color: string) {
    this.list.push({
      x: x + (Math.random() - 0.5) * 6, y: y + (Math.random() - 0.5) * 6,
      vx: 0, vy: 0,
      life: 0, maxLife: 0.35, size: 4,
      color, kind: 'spark', grav: 0,
    })
  }

  text(cx: number, cy: number, text: string, color = '#ffd54a') {
    this.list.push({
      x: cx, y: cy, vx: 0, vy: -50,
      life: 0, maxLife: 0.9, size: 15,
      color, kind: 'text', text, grav: 0,
    })
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]
      p.life += dt
      if (p.life >= p.maxLife) { this.list.splice(i, 1); continue }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.grav * dt
    }
  }

  draw(ctx: CanvasRenderingContext2D, layer: 'smoke' | 'main' = 'main') {
    for (const p of this.list) {
      if (layer === 'smoke' && p.kind !== 'smoke') continue
      if (layer === 'main' && p.kind === 'smoke') continue
      const t = p.life / p.maxLife
      const alpha = 1 - t
      ctx.globalAlpha = alpha
      switch (p.kind) {
        case 'spark':
          ctx.fillStyle = p.color
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size * (1 - t * 0.5), p.size * (1 - t * 0.5))
          break
        case 'smoke':
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * (1 + t), 0, Math.PI * 2)
          ctx.fill()
          break
        case 'ring':
          ctx.strokeStyle = p.color
          ctx.lineWidth = 3 * (1 - t)
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size + t * 70, 0, Math.PI * 2)
          ctx.stroke()
          break
        case 'debris':
          ctx.fillStyle = p.color
          ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
          break
        case 'text':
          ctx.font = `900 ${p.size}px "Avenir Next", system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.fillStyle = p.color
          ctx.shadowColor = 'rgba(0,0,0,.8)'
          ctx.shadowBlur = 4
          ctx.fillText(p.text ?? '', p.x, p.y)
          ctx.shadowBlur = 0
          break
      }
    }
    ctx.globalAlpha = 1
  }

  tileCenter(col: number, row: number) {
    return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 }
  }
}
