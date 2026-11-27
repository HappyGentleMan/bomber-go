import type { Dir } from './constants'

/** Quantize a 2D drag vector to one of the 4 game directions (0=right,1=left,
 *  2=down,3=up). Dominant axis wins; an exact diagonal tie resolves to
 *  horizontal. Vectors whose length is <= dead return null (no movement).
 *  Pure — no DOM — so it is unit-testable. */
export function quantizeDir(dx: number, dy: number, dead: number): Dir | null {
  if (Math.hypot(dx, dy) <= dead) return null
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 0 : 1
  return dy > 0 ? 2 : 3
}

export type MoveStyle = 'joystick' | 'dpad'

/** Clamp the floating base origin so the WHOLE base stays inside the move zone
 *  (never over the play field — a spec anti-goal) and on screen. If the zone is
 *  narrower than the base on an axis, fall back to the zone centre. Pure. */
export function clampBaseOrigin(
  px: number, py: number, r: number,
  zone: { left: number; top: number; right: number; bottom: number },
  screenW: number, screenH: number,
): { cx: number; cy: number } {
  const loX = Math.max(zone.left + r, r)
  const hiX = Math.min(zone.right - r, screenW - r)
  const loY = Math.max(zone.top + r, r)
  const hiY = Math.min(zone.bottom - r, screenH - r)
  const cx = hiX >= loX ? Math.min(Math.max(px, loX), hiX) : (zone.left + zone.right) / 2
  const cy = hiY >= loY ? Math.min(Math.max(py, loY), hiY) : (zone.top + zone.bottom) / 2
  return { cx, cy }
}

/** Floating-origin movement control. The base spawns wherever the thumb first
 *  touches inside `zone` (no fixed target to hunt for), drags steer with a hard
 *  4-direction snap, release stops. One pointer owns it — a second finger is
 *  ignored. `setStyle` swaps the joystick knob for a D-pad cross without
 *  re-binding listeners. DOM-heavy by nature; the direction math is the pure,
 *  unit-tested `quantizeDir` above. */
export class FloatingMove {
  private active = false
  private pointerId: number | null = null
  private cx = 0
  private cy = 0
  private style: MoveStyle
  private curDir: Dir | null = null
  private readonly radius = 66 // base is 132px
  private readonly travel = 40 // knob max travel from centre
  private readonly dead = 12

  constructor(
    private zone: HTMLElement,
    private base: HTMLElement,
    private knob: HTMLElement,
    private arrows: HTMLElement[], // indexed by Dir: 0=right,1=left,2=down,3=up
    private onDir: (d: Dir | null) => void,
    style: MoveStyle = 'joystick',
  ) {
    this.style = style
    this.base.classList.toggle('as-dpad', style === 'dpad')
    zone.addEventListener('pointerdown', this.down)
    zone.addEventListener('pointermove', this.move)
    zone.addEventListener('pointerup', this.up)
    zone.addEventListener('pointercancel', this.up)
    zone.addEventListener('lostpointercapture', this.release)
    window.addEventListener('blur', this.release)
  }

  /** force-release any active touch — blur / resize / lost-capture safety so a
   *  direction can never stick when the pointer stream is interrupted */
  release = () => {
    if (!this.active) return
    this.active = false
    this.pointerId = null
    this.base.classList.add('hidden')
    this.knob.style.transform = 'translate(0px, 0px)'
    this.curDir = null
    this.lit(null)
    this.onDir(null)
  }

  setStyle(style: MoveStyle) {
    this.style = style
    this.base.classList.toggle('as-dpad', style === 'dpad')
    if (this.active) this.lit(this.curDir) // keep the committed direction lit across a style swap
  }

  destroy() {
    this.zone.removeEventListener('pointerdown', this.down)
    this.zone.removeEventListener('pointermove', this.move)
    this.zone.removeEventListener('pointerup', this.up)
    this.zone.removeEventListener('pointercancel', this.up)
    this.zone.removeEventListener('lostpointercapture', this.release)
    window.removeEventListener('blur', this.release)
    this.active = false
    this.pointerId = null
    this.base.classList.add('hidden')
    this.onDir(null)
  }

  private down = (e: PointerEvent) => {
    e.preventDefault()
    if (this.active) return // single owner — ignore a second finger
    this.active = true
    this.pointerId = e.pointerId
    try { this.zone.setPointerCapture(e.pointerId) } catch { /* synthetic pointers */ }
    // clamp the base fully inside the move zone (never over the play field)
    const r = this.radius
    const z = this.zone.getBoundingClientRect()
    const o = clampBaseOrigin(e.clientX, e.clientY, r, z, window.innerWidth, window.innerHeight)
    this.cx = o.cx
    this.cy = o.cy
    this.base.style.left = `${this.cx - r}px`
    this.base.style.top = `${this.cy - r}px`
    this.base.classList.remove('hidden')
    this.knob.style.transform = 'translate(0px, 0px)'
    this.update(e.clientX, e.clientY)
  }

  private move = (e: PointerEvent) => {
    if (this.active && e.pointerId === this.pointerId) this.update(e.clientX, e.clientY)
  }

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return
    this.active = false
    this.pointerId = null
    this.base.classList.add('hidden')
    this.knob.style.transform = 'translate(0px, 0px)'
    this.curDir = null
    this.lit(null)
    this.onDir(null)
  }

  private update(px: number, py: number) {
    const rawX = px - this.cx
    const rawY = py - this.cy
    if (this.style === 'joystick') {
      let kx = rawX, ky = rawY
      const len = Math.hypot(kx, ky)
      if (len > this.travel) { kx = kx / len * this.travel; ky = ky / len * this.travel }
      this.knob.style.transform = `translate(${kx}px, ${ky}px)`
    }
    const d = quantizeDir(rawX, rawY, this.dead)
    this.curDir = d
    this.lit(d)
    this.onDir(d)
  }

  private lit(d: Dir | null) {
    for (let i = 0; i < this.arrows.length; i++) this.arrows[i]?.classList.toggle('on', i === d)
  }
}