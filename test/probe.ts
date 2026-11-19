// Probe: finds the micro-oscillation (position ping-pong < 0.2 tiles) and
// dumps the surroundings: tiles, canStep, blastEscape, box overlap.
// Run: npx tsx test/probe.ts
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => {}, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0, getGamepads: () => [] },
  configurable: true,
})

const { Game } = await import('../src/game.ts')
const noop = { dir: null as any, bomb: false, detonate: false }
const g: any = new Game('battle', { aiPlayer2: true })
g.__dbg = []
g.__dbg2 = []
g.__pathLog = []
g.__bfsLog = []
const origBfs = g.bfs.bind(g)
g.bfs = (sc: number, sr: number, tc: number, tr: number, passSoft: boolean, avoid?: Set<number>) => {
  const res = origBfs(sc, sr, tc, tr, passSoft, avoid)
  const bad = (arr: { x: number; y: number }[] | null) =>
    arr?.some(w => g.tile(w.x, w.y) === 1) ?? false
  if (res) g.__bfsLog.push({ t: +g.time.toFixed(2), s: `${sc},${sr}`, e: `${tc},${tr}`, ps: passSoft, av: avoid?.size ?? 0, len: res.length, bad: bad(res), targetHard: g.tile(tc, tr) === 1, path: res.map((w: any) => w.x + ',' + w.y).join(' ') })
  else g.__bfsLog.push({ t: +g.time.toFixed(2), s: `${sc},${sr}`, e: `${tc},${tr}`, ps: passSoft, av: avoid?.size ?? 0, len: 0, bad: false, targetHard: g.tile(tc, tr) === 1 })
  return res
}
const origSet = g.aiState.set.bind(g.aiState)
g.aiState.set = (id: number, val: any) => {
  g.__pathLog.push({ t: +g.time.toFixed(2), path: val.path.map((w: any) => w.x + ',' + w.y).join(' ') })
  return origSet(id, val)
}
const p2 = g.players[1]
const key2 = (k: number) => (k % 15) + ',' + Math.floor(k / 15)
const tn = (t: number) => ['WALK', 'SOFT', 'HARD'][t]

let hist: { x: number; y: number; t: number; md: number | null }[] = []
function dump(tag: string) {
  const c = Math.round(p2.x), r = Math.round(p2.y)
  console.log(`=== ${tag} at t=${g.time.toFixed(2)} pos=(${p2.x.toFixed(2)},${p2.y.toFixed(2)}) derived=(${p2.col},${p2.row}) ===`)
  console.log('tiles around:')
  for (let rr = r - 2; rr <= r + 2; rr++) {
    let row = ''
    for (let cc = c - 2; cc <= c + 2; cc++) row += ` [${tn(g.tile(cc, rr))}]`
    console.log(`  r${rr}:${row}`)
  }
  console.log('box tiles:', [...g['boxTiles'](p2)].map(key2).join(' '))
  console.log('powerups:', g.powerups.map((u: any) => `${u.col},${u.row}/${u.kind}`).join(' ') || 'none')
  console.log('raw grid[3][6]:', JSON.stringify(g.grid[3][6]), 'tile(6,3) =', g.tile(6,3))
  console.log('flames:', g.flames.map((f: any) => f.col + ',' + f.row).join(' ') || 'none')
  console.log('imminent:', [...g['imminentSet']()].map(key2).join(' ') || 'empty')
  console.log('canStep RLDU:', [0, 1, 2, 3].map(q => (g['canStep'](p2, q) ? 'Y' : 'N')).join(''))
  console.log('blastEscape:', g['blastEscape'](p2))
  console.log('bombs:', g.bombs.map((b: any) => `${b.owner}@${b.col},${b.row}/f${Math.round(b.fuse)}/p${b.power}`).join(' '))
  const st = g.aiState.get(1)
  console.log('st:', st ? `i${st.i}/${st.path.length} kind=${st.kind} path=[${st.path.map((w: any) => w.x + ',' + w.y).join(' ')}] nb=[${[...st.noBricks].map(key2).join(' ')}]` : 'null')
  console.log('last path assignments:')
  for (const e of g.__pathLog.slice(-6)) console.log(`  t=${e.t} [${e.path}]`)
  console.log('bfs calls with bad results (hard tile in path):')
  const flagged = g.__bfsLog.filter(e => e.bad)
  for (const e of flagged.slice(-8)) console.log(`  t=${e.t} ${e.s}->${e.e} ps=${e.ps} av=${e.av} len=${e.len} [${e.path ?? ''}]`)
  console.log(`total bfs calls: ${g.__bfsLog.length}, flagged: ${flagged.length}`)
  console.log('last bfs calls:')
  for (const e of g.__bfsLog.slice(-8)) console.log(`  t=${e.t} ${e.s}->${e.e} ps=${e.ps} av=${e.av} len=${e.len} targetHard=${e.targetHard} ${e.bad ? 'BAD: [' + e.path + ']' : ''}`)
  console.log('last aiThink decisions:')
  for (const e of g.__dbg.slice(-12)) console.log(`  t=${e.t} pos=(${e.x},${e.y}) dir=${e.dir} bomb=${e.bomb} md=${e.md} cs=${e.cs} inSoon=${e.inSoon} inAll=${e.inAll} nd=${e.nd} enemy=${e.enemy} st=${e.st}`)
  console.log('last threat branches:')
  for (const e of g.__dbg2.slice(-12)) console.log(`  t=${e.t} pos=(${e.x},${e.y}) br=${e.br} kept=${e.kept} md=${e.md}`)
  // which tile blocks canStep in each dir?
  for (const q of [0, 1, 2, 3]) {
    if (g['canStep'](p2, q)) continue
    const [dc, dr] = [[1, 0], [-1, 0], [0, 1], [0, -1]][q]
    const bx = p2.x + dc * 0.2, by = p2.y + dr * 0.2
    const h = 0.3
    const c0 = Math.floor(bx - h + 0.5), c1 = Math.floor(bx + h + 0.5 - 1e-4)
    const r0 = Math.floor(by - h + 0.5), r1 = Math.floor(by + h + 0.5 - 1e-4)
    const blockers: string[] = []
    for (let rr = r0; rr <= r1; rr++)
      for (let cc = c0; cc <= c1; cc++)
        if (g['tileSolidFor'](p2, cc, rr)) blockers.push(`${cc},${rr}(${tn(g.tile(cc, rr))}${g.bombAt(cc, rr) ? '+bomb' : ''})`)
    console.log(`  blocked dir ${q}: shifted box tiles ${blockers.join(' ') || '???'}`)
  }
  process.exit(0)
}
for (let t = 0; t < 120; t += 1 / 60) {
  g.update(1 / 60, { p1: { ...noop }, p2: { ...noop } })
  if (!p2.alive) { hist = []; continue }
  hist.push({ x: p2.x, y: p2.y, t: g.time, md: p2.movingDir })
  if (hist.length > 180) hist.shift()
  // detect a limit cycle: confined to a small region for 3s AND changing
  // direction repeatedly (the L/R/stop 4s ping-pong has ~1 tile amplitude,
  // so a tight 0.5-tile window never caught it)
  if (hist.length >= 180) {
    const xs = hist.map(h => h.x), ys = hist.map(h => h.y)
    const spreadX = Math.max(...xs) - Math.min(...xs)
    const spreadY = Math.max(...ys) - Math.min(...ys)
    let flips = 0
    for (let i = 1; i < hist.length; i++)
      if (hist[i].md !== hist[i - 1].md) flips++
    if (spreadX < 2.5 && spreadY < 2.5 && flips >= 2) {
      dump('limit-cycle')
    }
  }
}
console.log('no ping-pong found in 120s')
