// Difficulty-curve probe: play campaign with the built-in BFS AI, several
// runs, and report aggregate stats so tuning decisions aren't based on noise.
// Run: npx tsx test/qa-curve.ts [runs]

;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true })

const { Game } = await import('../src/game.ts')
const idle = { dir: null as any, bomb: false, detonate: false }
const ai = (g: Game) => (g as any).aiThink(g.players[0])

const RUNS = Number(process.argv[2] ?? 5)
const MAX_LEVELS = 8
const MAX_SIM = 30 * 60 // 30 min hard cap per run

let totalLevels = 0, totalDeaths = 0, totalScore = 0, totalCleared = 0
let bestLevel = 1
const perLevel: Record<number, { cleared: number; deaths: number; time: number; runs: number }> = {}

for (let run = 0; run < RUNS; run++) {
  const g = new Game('campaign')
  let t = 0, curLevel = 1, curStart = 0, curDeaths = 0, runDeaths = 0
  let livesAtLevel = g.lives, startScore = 0
  let runCleared = 0

  while (g.state !== 'over' && t < MAX_SIM && curLevel <= MAX_LEVELS) {
    g.update(1 / 60, { p1: ai(g), p2: idle })
    t += 1 / 60
    if (g.level !== curLevel) {
      const rec = (perLevel[curLevel] ??= { cleared: 0, deaths: 0, time: 0, runs: 0 })
      rec.cleared++; rec.deaths += curDeaths; rec.time += t - curStart; rec.runs++
      runCleared++
      curLevel = g.level; curStart = t; startScore = g.score; curDeaths = 0; livesAtLevel = g.lives
    }
    if (g.lives < livesAtLevel) { const lost = livesAtLevel - g.lives; curDeaths += lost; runDeaths += lost; livesAtLevel = g.lives }
  }
  totalLevels += runCleared
  totalDeaths += runDeaths
  totalScore += g.score
  totalCleared += runCleared
  bestLevel = Math.max(bestLevel, curLevel)
  console.log(`  run ${run + 1}: cleared ${runCleared} level(s), reached ${curLevel}, score=${g.score}, time=${Math.round(t)}s`)
}

console.log(`\nAggregate over ${RUNS} runs:`)
console.log(`  avg levels cleared: ${(totalCleared / RUNS).toFixed(1)}, best reached: ${bestLevel}, avg score: ${Math.round(totalScore / RUNS)}, total deaths: ${totalDeaths}`)
for (let lvl = 1; lvl <= MAX_LEVELS; lvl++) {
  const rec = perLevel[lvl]
  if (!rec) break
  console.log(`  level ${lvl}: cleared ${rec.cleared}/${rec.runs}, avg ${Math.round(rec.time / rec.runs)}s, deaths ${rec.deaths}`)
}
