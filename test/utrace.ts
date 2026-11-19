// U-turn tracer: finds 180° reversals and dumps the full AI state at each.
// Run: npx tsx test/utrace.ts [seconds]
;(globalThis as any).window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  devicePixelRatio: 1,
  setTimeout: () => 0,
  setInterval: () => 0,
  clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0, getGamepads: () => [] },
  configurable: true,
})

const { Game } = await import('../src/game.ts')
const noop = { dir: null as any, bomb: false, detonate: false }
const SECS = Number(process.argv[2] ?? 60)
const g: any = new Game('battle', { aiPlayer2: true })
g.__dbg = []
g.__dbg2 = []
const p2 = g.players[1]
let prevDir: number | null = null
let count = 0
let printed = 0

for (let t = 0; t < SECS; t += 1 / 60) {
  g.update(1 / 60, { p1: { ...noop }, p2: { ...noop } })
  if (!p2.alive) { prevDir = null; continue }
  if (p2.moving && p2.movingDir !== null) {
    const d = p2.movingDir
    if (prevDir !== null && d !== prevDir) {
      count++
      const inWin = g.time >= 2.8 && g.time <= 3.6
      if (inWin && printed < 5) {
        printed++
        console.log(`=== change #${count} t=${g.time.toFixed(2)} pos=(${p2.x.toFixed(2)},${p2.y.toFixed(2)}) ${prevDir}->${d} bombs=[${g.bombs.map((b: any) => b.owner + '@' + b.col + ',' + b.row + '/f' + Math.round(b.fuse / 100)).join(' ')}] ===`)
        for (const line of g.__dbg.slice(-8)) {
          console.log(`   ai t=${line.t} pos=(${line.x},${line.y}) dir=${line.dir} md=${line.md} canStep=${line.cs} inAll=${line.inAll} st=${line.st}`)
        }
        for (const line of g.__dbg2.slice(-6)) {
          console.log(`   th t=${line.t} pos=(${line.x},${line.y}) branch=${line.br} kept=${line.kept} md=${line.md}`)
        }
      }
    }
    prevDir = p2.movingDir
  }
}
console.log(`total direction changes: ${count}`)
