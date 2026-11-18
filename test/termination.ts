// Verify battle matches ALWAYS terminate (reach 'battleover') — guards against
// soft-locks from endless draw-replays. Runs N matches back-to-back, each capped
// at 30 min of sim time, and asserts every one resolves with a valid winner state.
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true })

const { Game } = await import('../src/game.ts')

const STEP = 1 / 60
const CAP = 30 * 60 // 30 min sim per match
const MATCHES = 5
const noop = { dir: null as any, bomb: false, detonate: false }

let allDone = 0
const durations: number[] = []

for (let m = 0; m < MATCHES; m++) {
  const g = new Game('battle', { aiPlayer2: true, attract: true })
  let t = 0
  let guard = 0
  while (g.state !== 'battleover' && t < CAP && guard < CAP / STEP) {
    g.update(STEP, { p1: noop, p2: noop })
    t += STEP
    guard++
  }
  const ok = g.state === 'battleover'
  const winnerValid = g.winner === 0 || g.winner === 1 || g.winner === -1
  durations.push(t)
  console.log(
    `match ${m + 1}: ${ok ? 'TERMINATED' : '*** SOFT-LOCK ***'} ` +
    `t=${t.toFixed(0)}s winner=${g.winner} roundsWon=${g.roundWins[0]}-${g.roundWins[1]} valid=${winnerValid}`
  )
  if (ok && winnerValid) allDone++
  else {
    console.error(`FAILED: match ${m + 1} did not resolve cleanly`)
    process.exit(1)
  }
}

console.log(`\n${allDone}/${MATCHES} matches terminated cleanly`)
console.log(`avg match length: ${(durations.reduce((a, b) => a + b, 0) / MATCHES).toFixed(0)}s ` +
  `(min ${Math.min(...durations).toFixed(0)}s, max ${Math.max(...durations).toFixed(0)}s)`)
console.log(allDone === MATCHES ? 'ALL MATCHES TERMINATE ✓' : 'SOME MATCHES DID NOT TERMINATE ✗')
process.exit(allDone === MATCHES ? 0 : 1)
