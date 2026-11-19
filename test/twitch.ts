// Twitch measurement: AI 180° U-turns, 90° turns, and deaths per 60s battle
// trial (p1 idle, p2 AI). Run: npx tsx test/twitch.ts [trials]
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
const N = Number(process.argv[2] ?? 8)

const results: { trial: number; aiDeaths: number; movingTicks: number; uturns: number; turns: number }[] = []
for (let trial = 0; trial < N; trial++) {
  const g = new Game('battle', { aiPlayer2: true })
  const p2 = g.players[1]
  let prevDir: number | null = null
  let movingTicks = 0, uturns = 0, turns = 0, aiDeaths = 0
  let aiAlive = true
  for (let t = 0; t < 60; t += 1 / 60) {
    g.update(1 / 60, { p1: { ...noop }, p2: { ...noop } })
    if (aiAlive && !p2.alive) { aiAlive = false; aiDeaths++; prevDir = null; continue }
    if (!aiAlive && p2.alive) { aiAlive = true; prevDir = null; continue }
    if (p2.moving && p2.movingDir !== null) {
      movingTicks++
      const d = p2.movingDir
      if (prevDir !== null && d !== prevDir) {
        if (d === (prevDir ^ 1)) uturns++   // 180° reversal (0=right<->1=left, 2=down<->3=up)
        else turns++                        // 90° corner
      }
      prevDir = d
    }
  }
  results.push({ trial, aiDeaths, movingTicks, uturns, turns })
}
console.table(results)
const avg = (k: 'aiDeaths' | 'movingTicks' | 'uturns' | 'turns') =>
  Math.round(results.reduce((s, r) => s + r[k], 0) / results.length)
console.log(`avg per 60s: deaths=${avg('aiDeaths')} turns=${avg('turns')} uturns=${avg('uturns')} movingTicks=${avg('movingTicks')}`)
