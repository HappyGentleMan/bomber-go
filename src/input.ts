import type { Dir } from './constants'
import { audio } from './audio'

export interface PlayerInput {
  dir: Dir | null
  bomb: boolean        // edge-triggered (consumed)
  detonate: boolean    // edge-triggered (consumed)
}

const KEYMAP_P1: Record<string, Dir> = {
  KeyD: 0, KeyA: 1, KeyS: 2, KeyW: 3,
  ArrowRight: 0, ArrowLeft: 1, ArrowDown: 2, ArrowUp: 3,
}
const KEYMAP_P2: Record<string, Dir> = {
  KeyL: 0, KeyJ: 1, KeyK: 2, KeyI: 3,
}

class InputManager {
  private down = new Set<string>()
  private p1: PlayerInput = { dir: null, bomb: false, detonate: false }
  private p2: PlayerInput = { dir: null, bomb: false, detonate: false }
  private lastDir1: Dir | null = null
  private lastDir2: Dir | null = null
  onTogglePause: (() => void) | null = null
  onMenuNav: ((d: 'up' | 'down' | 'ok' | 'back') => void) | null = null

  private touchDir: Dir | null = null
  private touchBomb = false
  private touchDetonate = false

  attach() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  private onBlur = () => { this.down.clear(); this.touchDir = null }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) { e.preventDefault(); return }
    this.down.add(e.code)

    if (e.code === 'KeyP' || e.code === 'Escape') {
      this.onTogglePause?.()
      e.preventDefault()
      return
    }
    if (e.code === 'KeyM') {
      if (this.inMenu) this.onMenuNav?.('back')
      else audio.toggleMute()
      return
    }

    // menu navigation (title state uses this)
    if (e.code === 'ArrowUp' && !e.ctrlKey && this.inMenu) this.onMenuNav?.('up')
    if (e.code === 'ArrowDown' && this.inMenu) this.onMenuNav?.('down')
    if (e.code === 'Enter' && this.inMenu) this.onMenuNav?.('ok')
    if (e.code === 'Space' && this.inMenu) this.onMenuNav?.('ok')

    this.lastDir1 = KEYMAP_P1[e.code] ?? this.lastDir1
    this.lastDir2 = KEYMAP_P2[e.code] ?? this.lastDir2

    if (e.code === 'Space' || e.code === 'KeyF') this.p1.bomb = true
    if (e.code === 'KeyE' || e.code === 'KeyG') this.p1.detonate = true
    if (e.code === 'Enter' || e.code === 'Numpad0') this.p2.bomb = true
    if (e.code === 'KeyO' || e.code === 'Numpad1') this.p2.detonate = true

    if (['Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code))
      e.preventDefault()
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code)
    if (KEYMAP_P1[e.code] === this.lastDir1) this.lastDir1 = null
    if (KEYMAP_P2[e.code] === this.lastDir2) this.lastDir2 = null
  }

  inMenu = false

  /** called every frame; returns and clears edge-triggered presses */
  poll(): { p1: PlayerInput; p2: PlayerInput } {
    // gamepad (first pad -> P1, second -> P2)
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    const g1 = pads[0], g2 = pads[1]
    const padDir = (p: Gamepad | null): Dir | null => {
      if (!p) return null
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0
      if (Math.abs(ax) > 0.5) return ax > 0 ? 0 : 1
      if (Math.abs(ay) > 0.5) return ay > 0 ? 2 : 3
      if (p.buttons[14]?.pressed) return 0
      if (p.buttons[15]?.pressed) return 1
      if (p.buttons[13]?.pressed) return 2
      if (p.buttons[12]?.pressed) return 3
      return null
    }
    const pd1 = padDir(g1), pd2 = padDir(g2)

    // touch
    const tDir = this.touchDir
    if (this.touchBomb) { this.p1.bomb = true; this.touchBomb = false }
    if (this.touchDetonate) { this.p1.detonate = true; this.touchDetonate = false }

    const dir1 = this.lastDir1 ?? pd1 ?? tDir
    const dir2 = this.lastDir2 ?? pd2

    if (g1?.buttons[0]?.pressed) this.p1.bomb = true
    if (g1?.buttons[2]?.pressed) this.p1.detonate = true
    if (g2?.buttons[0]?.pressed) this.p2.bomb = true
    if (g2?.buttons[2]?.pressed) this.p2.detonate = true

    // Return COPIES of the edge-triggered flags — `this.p1`/`this.p2` are the
    // live state we clear right after. Returning references (the old bug) meant
    // bomb/detonate were reset to false before game.update() could read them, so
    // bombs could never be placed.
    const out = {
      p1: { dir: dir1, bomb: this.p1.bomb, detonate: this.p1.detonate },
      p2: { dir: dir2, bomb: this.p2.bomb, detonate: this.p2.detonate },
    }
    this.p1.dir = dir1
    this.p2.dir = dir2
    this.p1.bomb = false
    this.p1.detonate = false
    this.p2.bomb = false
    this.p2.detonate = false
    return out
  }

  setTouchDir(d: Dir | null) { this.touchDir = d }
  setTouchBomb() { this.touchBomb = true }
  setTouchDetonate() { this.touchDetonate = true }
}

export const input = new InputManager()
