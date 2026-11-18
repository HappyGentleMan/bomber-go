import {
  COLS, ROWS, T_WALK, T_HARD, T_SOFT,
  POWERUP_DEFS, ENEMY_MAX,
} from './constants'
import type { PowerupKind, EnemyType } from './types'

export interface Cell { t: number }
export type Grid = Cell[][]

export interface LevelDef {
  grid: Grid
  powerups: { col: number; row: number; kind: PowerupKind }[]
  exitCol: number
  exitRow: number
  enemySpawns: { col: number; row: number }[]
  playerSpawns: { col: number; row: number }[]
}

const rnd = (n: number) => Math.floor(Math.random() * n)

function makeGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ({ t: T_WALK as number })))
}

/** Corners used for players (battle) / player (campaign) */
export const SPAWNS = [
  { col: 1, row: 1 },
  { col: COLS - 2, row: 1 },
  { col: 1, row: ROWS - 2 },
  { col: COLS - 2, row: ROWS - 2 },
]

function clearAround(grid: Grid, c: number, r: number) {
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const cc = c + dc, rr = r + dr
      if (cc > 0 && rr > 0 && cc < COLS - 1 && rr < ROWS - 1)
        if (grid[rr][cc].t !== T_HARD) grid[rr][cc].t = T_WALK
    }
}

function pickWeighted(avoidRecent: PowerupKind[]): PowerupKind {
  const pool = Object.values(POWERUP_DEFS).filter(d =>
    d.kind !== 'life' && !(avoidRecent.includes(d.kind) && Math.random() < 0.5))
  let total = 0
  for (const d of pool) total += d.weight
  let roll = Math.random() * total
  for (const d of pool) {
    roll -= d.weight
    if (roll <= 0) return d.kind
  }
  return pool[0].kind
}

  /**
   * Ensure every important cell is reachable from the main spawn.
   * If a cell is walled off, carve a path by converting the soft bricks
   * along a pass-soft route into walk tiles.
   */
  function ensureConnectivity(grid: Grid, important: { col: number; row: number }[], start: { col: number; row: number }) {
    const reachable = (sc: number, sr: number, tc: number, tr: number, passSoft: boolean): { col: number; row: number }[] | null => {
      if (sc === tc && sr === tr) return []
      const prev = new Map<number, number>()
      const q: number[] = [sc + sr * COLS]
      const seen = new Set<number>(q)
      while (q.length) {
        const cur = q.shift()!
        const cx = cur % COLS, cy = Math.floor(cur / COLS)
        if (cx === tc && cy === tr) {
          const path: { col: number; row: number }[] = []
          let c = cur
          while (c !== sc + sr * COLS) {
            path.push({ col: c % COLS, row: Math.floor(c / COLS) })
            c = prev.get(c)!
          }
          path.reverse()
          return path
        }
        for (const dv of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dv[0], ny = cy + dv[1]
          if (nx < 1 || ny < 1 || nx >= COLS - 1 || ny >= ROWS - 1) continue
          const t = grid[ny][nx].t
          if (t === T_HARD) continue
          if (t === T_SOFT && !passSoft) continue
          const k = nx + ny * COLS
          if (seen.has(k)) continue
          seen.add(k)
          prev.set(k, cur)
          q.push(k)
        }
      }
      return null
    }
    for (const cell of important) {
      if (!reachable(start.col, start.row, cell.col, cell.row, false)) {
        const path = reachable(start.col, start.row, cell.col, cell.row, true)
        if (path) for (const p of path) if (grid[p.row][p.col].t === T_SOFT) grid[p.row][p.col].t = T_WALK
      }
    }
  }

/**
 * Generate a campaign level.
 * level: 1-based. Higher = more bricks, more powerups, more enemies.
 */
export function generateLevel(level: number): LevelDef {
  const grid = makeGrid()

  // border
  for (let c = 0; c < COLS; c++) { grid[0][c].t = T_HARD; grid[ROWS - 1][c].t = T_HARD }
  for (let r = 0; r < ROWS; r++) { grid[r][0].t = T_HARD; grid[r][COLS - 1].t = T_HARD }

  // hard pillars at even/even
  for (let r = 2; r < ROWS - 1; r += 2)
    for (let c = 2; c < COLS - 1; c += 2)
      grid[r][c].t = T_HARD

  // player spawn corner is clean
  clearAround(grid, 1, 1)

  // soft bricks
  const brickDensity = Math.min(0.68, 0.42 + level * 0.015)
  const softCells: { col: number; row: number }[] = []
  for (let r = 1; r < ROWS - 1; r++)
    for (let c = 1; c < COLS - 1; c++) {
      if (grid[r][c].t === T_WALK && Math.random() < brickDensity) {
        grid[r][c].t = T_SOFT
        softCells.push({ col: c, row: r })
      }
    }

  // powerups hidden in bricks
  const powerups: LevelDef['powerups'] = []
  const nPowerups = Math.min(softCells.length - 2, 2 + Math.ceil(level / 1.5))
  const recent: PowerupKind[] = []
  // shuffle soft cells
  for (let i = softCells.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[softCells[i], softCells[j]] = [softCells[j], softCells[i]]
  }
  for (let i = 0; i < nPowerups; i++) {
    const cell = softCells[i]
    let kind = pickWeighted(recent)
    // guarantee bomb + flame early on
    if (level === 1 && i < 2) kind = i === 0 ? 'bomb' : 'flame'
    powerups.push({ col: cell.col, row: cell.row, kind })
    recent.unshift(kind)
    recent.length = Math.min(recent.length, 3)
  }

  // exit under a random brick (not a powerup brick)
  const exitBricks = softCells.slice(nPowerups)
  const exit = exitBricks.length
    ? exitBricks[rnd(exitBricks.length)]
    : { col: COLS - 2, row: ROWS - 2 }

  // enemy spawn cells: far from player spawn, on walk tiles
  const enemySpawns: { col: number; row: number }[] = []
  const candidates: { col: number; row: number }[] = []
  for (let r = 1; r < ROWS - 1; r++)
    for (let c = 1; c < COLS - 1; c++) {
      const d = Math.abs(c - 1) + Math.abs(r - 1)
      if (grid[r][c].t === T_WALK && d >= 6) candidates.push({ col: c, row: r })
    }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  for (const cell of candidates.slice(0, ENEMY_MAX)) enemySpawns.push(cell)

  // guarantee everything important is reachable from the spawn
  ensureConnectivity(grid, [
    { col: 1, row: 1 },
    ...powerups,
    { col: exit.col, row: exit.row },
    ...enemySpawns,
  ], { col: 1, row: 1 })

  return {
    grid,
    powerups,
    exitCol: exit.col,
    exitRow: exit.row,
    enemySpawns,
    playerSpawns: [{ col: 1, row: 1 }],
  }
}

/**
 * Battle map: sparser bricks, four spawn corners, no exit.
 */
export function generateBattleMap(): LevelDef {
  const grid = makeGrid()
  for (let c = 0; c < COLS; c++) { grid[0][c].t = T_HARD; grid[ROWS - 1][c].t = T_HARD }
  for (let r = 0; r < ROWS; r++) { grid[r][0].t = T_HARD; grid[r][COLS - 1].t = T_HARD }
  for (let r = 2; r < ROWS - 1; r += 2)
    for (let c = 2; c < COLS - 1; c += 2)
      grid[r][c].t = T_HARD
  for (const s of SPAWNS) clearAround(grid, s.col, s.row)

  const softCells: { col: number; row: number }[] = []
  for (let r = 1; r < ROWS - 1; r++)
    for (let c = 1; c < COLS - 1; c++)
      if (grid[r][c].t === T_WALK) softCells.push({ col: c, row: r })
  for (let i = softCells.length - 1; i > 0; i--) {
    const j = rnd(i + 1)
    ;[softCells[i], softCells[j]] = [softCells[j], softCells[i]]
  }
  const nSoft = Math.floor(softCells.length * 0.45)
  const powerups: LevelDef['powerups'] = []
  for (let i = 0; i < nSoft; i++) {
    const cell = softCells[i]
    grid[cell.row][cell.col].t = T_SOFT
    if (i < Math.floor(nSoft * 0.25)) {
      let kind = pickWeighted([])
      if (kind === 'shrink' || kind === 'shrinkf') kind = Math.random() < 0.5 ? 'shrink' : 'shrinkf'
      powerups.push({ col: cell.col, row: cell.row, kind })
    }
  }
  ensureConnectivity(grid, [
    ...SPAWNS,
    ...powerups,
  ], SPAWNS[0])
  return {
    grid,
    powerups,
    exitCol: -1,
    exitRow: -1,
    enemySpawns: [],
    playerSpawns: SPAWNS,
  }
}

/** Enemy roster per level index (0-based): which types appear and how many */
export function levelEnemies(level: number): EnemyType[] {
  const list: EnemyType[] = []
  const count = Math.min(3 + Math.ceil(level * 0.8), 8)
  const table: [EnemyType, number, number][] = [
    // [type, minLevel, weight]
    ['balloom', 1, 30],
    ['oneal', 1, 24],
    ['doll', 2, 16],
    ['minvo', 3, 14],
    ['kondoria', 3, 10],
    ['ovapi', 4, 10],
    ['pass', 5, 12],
    ['pontan', 6, 12],
  ]
  for (let i = 0; i < count; i++) {
    const pool = table.filter(([, minL]) => level >= minL)
    let total = 0
    for (const [, , w] of pool) total += w
    let roll = Math.random() * total
    let type: EnemyType = 'balloom'
    for (const [t, , w] of pool) {
      roll -= w
      if (roll <= 0) { type = t; break }
    }
    list.push(type)
  }
  return list
}
