// 10-minute soak: battle (2 AI) + campaign (bot). Checks stability + leaks.
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true })

const { Game } = await import('../src/game.ts')
const noop = { dir: null as any, bomb: false, detonate: false }
const t0 = Date.now()

// --- battle soak: 10 min, 2 AI ---
{
  let g = new Game('battle', { aiPlayer2: true, attract: true })
  let rounds = 0
  for (let t = 0; t < 600; t += 1 / 60) {
    if (g.state === 'battleover') { rounds++; g = new Game('battle', { aiPlayer2: true, attract: true }); continue }
    g.update(1 / 60, { p1: { ...noop }, p2: { ...noop } })
  }
  const k1 = (g as any).players?.[0]?.kills ?? 0
  console.log(`battle 10min: ok, rounds=${rounds}, state=${g.state}`)
}

// --- campaign soak: bot plays, up to 10 min ---
{
  const g = new Game('campaign')
  const dirs = [2, 0, 3, 1] as const
  let maxLevel = 1, maxFlames = 0, maxBombs = 0, maxParts = 0
  for (let t = 0; t < 600; t += 1 / 60) {
    g.update(1 / 60, {
      p1: { dir: dirs[Math.floor(t * 2) % 4], bomb: Math.floor(t * 2) % 7 === 0, detonate: false },
      p2: { ...noop },
    })
    maxLevel = Math.max(maxLevel, g.level)
    maxFlames = Math.max(maxFlames, g.flames.length)
    maxBombs = Math.max(maxBombs, g.bombs.length)
    maxParts = Math.max(maxParts, (g as any).particles?.items?.length ?? 0)
    if (g.state === 'over') break
  }
  console.log(`campaign 10min: ok, level=${g.level}, maxLevel=${maxLevel}, score=${g.score}, state=${g.state}`)
  console.log(`  bounds: flames=${maxFlames} bombs=${maxBombs} particles=${maxParts}`)
}

console.log(`soak complete in ${((Date.now() - t0) / 1000).toFixed(0)}s wall`)
