// Aggression probe: two AIs, 150s. Measures bomb rate, kill opportunities
// (enemy on line within flame) and what the bot did with them.
// Run: npx tsx test/aggr.ts [seconds]
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
const secs = Number(process.argv[2] ?? 150)
const noop = { dir: null as any, bomb: false, detonate: false }
const g: any = new Game('battle', { aiPlayer2: true })
// both players are AI in this harness: run the aiThink loop manually for p1 too
let bombsP1 = 0, bombsP2 = 0
let oppTicksP2 = 0, oppBombsP2 = 0, oppTicksP1 = 0, oppBombsP1 = 0
let killsP1 = 0, killsP2 = 0
let bombAttemptsBlocked = 0 // p2 wanted to bomb (opportunity) but canSurviveBomb said no
const origCanSurvive = g['canSurviveBomb'].bind(g)
g['canSurviveBomb'] = (p: any) => {
  const ok = origCanSurvive(p)
  if (!ok && p.id === 1) bombAttemptsBlocked++
  return ok
}
const t0 = g.time
for (let t = 0; t < secs * 60; t++) {
  const p1 = g.players[0], p2 = g.players[1]
  // measure p2's opportunities before it thinks
  if (p2.alive && p1.alive) {
    const d = Math.abs(p1.col - p2.col) + Math.abs(p1.row - p2.row)
    const inLine = p1.col === p2.col || p1.row === p2.row
    if (inLine && d >= 1 && d <= p2.flame) {
      oppTicksP2++
      if (g.bombs.filter((b: any) => b.owner === 1).length < p2.bombs && !g.bombAt(p2.col, p2.row)) oppBombsP2++
    }
    const d1 = Math.abs(p2.col - p1.col) + Math.abs(p2.row - p1.row)
    const inLine1 = p2.col === p1.col || p2.row === p1.row
    if (inLine1 && d1 >= 1 && d1 <= p1.flame) {
      oppTicksP1++
      if (g.bombs.filter((b: any) => b.owner === 0).length < p1.bombs && !g.bombAt(p1.col, p1.row)) oppBombsP1++
    }
  }
  const r1 = p1.alive ? g.aiThink(p1) : { ...noop }
  const r2 = p2.alive ? g.aiThink(p2) : { ...noop }
  const b1 = g.bombs.length
  g.update(1 / 60, { p1: { ...r1 }, p2: { ...r2 } })
  if (g.bombs.length > b1) {
    for (const b of g.bombs) if (b.born > t0) { if (b.owner === 0) bombsP1++; else bombsP2++ }
  }
  killsP1 = p1.kills, killsP2 = p2.kills
}
const pm = (n: number) => (n / secs * 60).toFixed(1)
console.log(`— ${secs}s, two AIs —`)
console.log(`bombs placed/min:  P1=${pm(bombsP1)}  P2=${pm(bombsP2)}`)
console.log(`kills:             P1=${killsP1}  P2=${killsP2}`)
console.log(`kill opportunities (on line, in flame):`)
console.log(`  P2: ${oppTicksP2} ticks, bombable ${oppBombsP2} (${oppTicksP2 ? (oppBombsP2 / oppTicksP2 * 100).toFixed(0) : 0}%)`)
console.log(`  P1: ${oppTicksP1} ticks, bombable ${oppBombsP1} (${oppTicksP1 ? (oppBombsP1 / oppTicksP1 * 100).toFixed(0) : 0}%)`)
console.log(`p2 canSurviveBomb rejections (all): ${bombAttemptsBlocked}`)
console.log(`final: p1=${g.players[0].x.toFixed(1)},${g.players[0].y.toFixed(1)} f${g.players[0].flame}/b${g.players[0].bombs}  p2=${g.players[1].x.toFixed(1)},${g.players[1].y.toFixed(1)} f${g.players[1].flame}/b${g.players[1].bombs}`)
console.log(`live bombs at end: ${g.bombs.length}`)
