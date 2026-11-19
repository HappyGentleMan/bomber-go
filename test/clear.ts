// Campaign clear probe: the AI plays a campaign level; verify it reaches the
// hidden exit, reveals the portal, and clears the level. Guards the
// "sometimes there is no portal" bug end-to-end (not just at generation).
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

const RUNS = Number(process.argv[2] ?? 12)
const SECS = Number(process.argv[3] ?? 90)
let cleared = 0, revealed = 0, failed = 0
let diagCount = 0
for (let run = 0; run < RUNS; run++) {
  const g: any = new Game('campaign')
  const p = g.players[0]
  p.invincibleUntil = 100000 // isolate exit-finding from combat deaths
  let exitSeen = false, levelCleared = false
  for (let t = 0; t < SECS * 60; t++) {
    const r1 = p.alive ? g.aiThink(p) : { ...noop }
    g.update(1 / 60, { p1: { ...r1 } })
    if (g.exit.revealed) exitSeen = true
    if (g.state === 'levelclear') { levelCleared = true; break }
    if (g.state === 'over') break
    // diagnostic: exit revealed + player adjacent, but not clearing — why?
    if (g.exit.revealed && !levelCleared) {
      const d = Math.abs(p.col - g.exit.col) + Math.abs(p.row - g.exit.row)
      if (d <= 2 && t % 60 === 0 && diagCount < 8) {
        diagCount++
        const soon = g['imminentSet']()
        const allB = new Set<number>(soon)
        for (const b of g.bombs) g['blastSet'](b.col, b.row, b.power).forEach((k: number) => allB.add(k))
        const exitKey = g.exit.col + g.exit.row * 15
        const st = g.aiState.get(0)
        console.log(`  [diag] t=${(t / 60).toFixed(0)}s p=(${p.x.toFixed(1)},${p.y.toFixed(1)}) tile=(${p.col},${p.row}) exit=(${g.exit.col},${g.exit.row}) d=${d} exitInAllBlasts=${allB.has(exitKey)} exitInSoon=${soon.has(exitKey)} bombs=${g.bombs.length} canStepDown=${g.canStep(p, 2)} path=${st ? st.path.length : '?'} kind=${st ? st.kind : '?'} dir=${r1.dir}`)
      }
    }
  }
  if (exitSeen) revealed++
  if (levelCleared) cleared++
  else {
    failed++
    if (failed <= 3)
      console.log(`  run ${run}: NOT cleared in ${SECS}s — state=${g.state} exit.revealed=${g.exit.revealed} exit=(${g.exit.col},${g.exit.row}) tile=${g.grid[g.exit.row][g.exit.col].t} player=(${p.x.toFixed(1)},${p.y.toFixed(1)})`)
  }
}
console.log(`campaign runs: ${RUNS} (${SECS}s each)`)
console.log(`exit revealed: ${revealed}/${RUNS}`)
console.log(`level cleared: ${cleared}/${RUNS}`)
