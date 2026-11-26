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