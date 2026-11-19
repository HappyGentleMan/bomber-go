// Direction-stream probe: prints the AI's heading as a 10Hz symbol stream
// (.=still R=right L=left D=down U=up) to spot square-wave zigzags.
// Run: npx tsx test/dstream.ts [seconds]
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
const SECS = Number(process.argv[2] ?? 60)
const g: any = new Game('battle', { aiPlayer2: true })
const p2 = g.players[1]
const sym = ['R', 'L', 'D', 'U']
let line = ''
let turns = 0, prev: number | null = null
let printed = 0
for (let t = 0; t < SECS; t += 1 / 60) {
  g.update(1 / 60, { p1: { ...noop }, p2: { ...noop } })
  if (!p2.alive) { line += 'x'; prev = null; if (t % 6 === 0) { line += ' ' } continue }
  const d = p2.movingDir
  if (p2.moving && d !== null) {
    if (prev !== null && d !== prev) {
      turns++
      // dump state at the 30th, 60th, 90th direction changes (deep in steady state)
      if ((turns === 30 || turns === 60 || turns === 90) && printed < 3) {
        printed++
        const s = g.aiState.get(1)
        console.log(`--- change #${turns} t=${g.time.toFixed(1)} pos=(${p2.x.toFixed(2)},${p2.y.toFixed(2)}) ` +
          `st=${s ? `i${s.i}/${s.path.length} h=${s.path[s.i] ? s.path[s.i].x + ',' + s.path[s.i].y : '-'} tc=${s.tc},${s.tr}` : 'null'} ` +
          `bombs=[${g.bombs.map((b: any) => b.owner + '@' + b.col + ',' + b.row + '/f' + Math.round(b.fuse / 100)).join(' ')}]`)
      }
    }
    prev = d
    line += sym[d]
  } else {
    line += '.'
    if (prev !== null) prev = null
  }
  if (t % 6 === 0) line += ' '
}
console.log('turns:', turns)
console.log(line)
