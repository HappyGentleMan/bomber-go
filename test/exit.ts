// Exit-reachability probe: generate N campaign levels and check that the
// exit is ALWAYS under an intact brick (T_SOFT) in the final grid. If the
// exit cell is T_WALK, the portal can never be revealed (destroyBrick is
// only called on bricks) and the level is un-clearable.
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => {}, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0, getGamepads: () => [] },
  configurable: true,
})
const { generateLevel } = await import('../src/level.ts')
const { T_WALK, T_SOFT } = await import('../src/constants.ts')

// the player can walk walk-tiles and destroy any adjacent brick, so the
// blast-reachable region is the connected walk+soft region from the spawn
function blastReachable(def: any): Set<number> {
  const seen = new Set<number>([1 + 1 * 15])
  const q = [1 + 1 * 15]
  while (q.length) {
    const cur = q.shift()!
    const cx = cur % 15, cy = Math.floor(cur / 15)
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dc, ny = cy + dr
      if (nx < 1 || ny < 1 || nx >= 14 || ny >= 12) continue
      const t = def.grid[ny][nx].t
      if (t === 1) continue // hard wall
      const k = nx + ny * 15
      if (seen.has(k)) continue
      seen.add(k); q.push(k)
    }
  }
  return seen
}

const N = Number(process.argv[2] ?? 500)
let bad = 0, unreachable = 0
const badExamples: string[] = []
for (let lvl = 1; lvl <= 40; lvl++) {
  for (let i = 0; i < N / 40; i++) {
    const def = generateLevel(lvl)
    const t = def.grid[def.exitRow][def.exitCol].t
    if (t !== T_SOFT) {
      bad++
      if (badExamples.length < 10)
        badExamples.push(`level=${lvl} exit=(${def.exitCol},${def.exitRow}) tile=${t} (in spawn corner: ${def.exitCol <= 3 && def.exitRow <= 3})`)
      continue
    }
    // the exit brick must be in the blast-reachable region (the player can
    // get adjacent to it, destroy it, and stand on the revealed portal)
    if (!blastReachable(def).has(def.exitCol + def.exitRow * 15)) {
      unreachable++
      if (badExamples.length < 10)
        badExamples.push(`level=${lvl} exit=(${def.exitCol},${def.exitRow}) NOT blast-reachable`)
    }
  }
}
console.log(`levels generated: ${N}`)
console.log(`exit NOT under a brick (portal can never reveal): ${bad} (${(100 * bad / N).toFixed(1)}%)`)
console.log(`exit not blast-reachable from spawn: ${unreachable} (${(100 * unreachable / N).toFixed(1)}%)`)
for (const e of badExamples) console.log('  ' + e)
