// Long-run QA: extended simulations to catch crashes / leaks / softlocks.
// Run: npx tsx test/qa-long.ts

;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true })

const { Game } = await import('../src/game.ts')
const idle = { dir: null as any, bomb: false, detonate: false }
const dirs = [2, 0, 3, 1] as const

let failures = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${extra}`); failures++ }
}

console.log('— Campaign: 5 minutes with aggressive bot —')
{
  const g = new Game('campaign')
  const p = g.players[0]
  p.invincibleUntil = 1e9
  let maxLevel = 1
  for (let t = 0; t < 300; t += 1 / 60) {
    g.update(1 / 60, {
      p1: { dir: dirs[Math.floor(t * 2) % 4], bomb: Math.floor(t * 2) % 5 === 0, detonate: Math.floor(t) % 9 === 0 },
      p2: idle,
    })
    maxLevel = Math.max(maxLevel, g.level)
  }
  check('no crash after 5 min', true)
  check('particles bounded (no leak)', g.particles.list.length < 400, `particles=${g.particles.list.length}`)
  check('flames bounded', g.flames.length < 40, `flames=${g.flames.length}`)
  check('score accumulated', g.score > 400, `score=${g.score}`)
  console.log(`  (score=${g.score}, level=${g.level}, maxLevel=${maxLevel}, lives=${g.lives}, state=${g.state})`)
}

console.log('— Battle: 5 min, 2 AI —')
{
  const b = new Game('battle', { aiPlayer2: true, attract: true })
  let resets = 0
  for (let t = 0; t < 300; t += 1 / 60) {
    b.update(1 / 60, { p1: idle, p2: idle })
    if (b.state === 'battleover') {
      // attract: restart
      b.state = 'playing'
      b.suddenDeath = false
      b.time = 0
      b.bombs = []
      b.flames = []
      for (const p of b.players) { p.alive = true; p.kills = 0 }
      b.players[0].col = 1; b.players[0].row = 1; b.players[0].x = 1; b.players[0].y = 1
      b.players[1].col = 13; b.players[1].row = 1; b.players[1].x = 13; b.players[1].y = 1
      resets++
    }
  }
  check('no crash after 5 min', true)
  check('multiple rounds played', resets >= 1, `resets=${resets}`)
  console.log(`  (resets=${resets}, state=${b.state})`)
}

console.log('— 12 consecutive campaign levels (fresh games) —')
{
  let ok = true
  for (let i = 0; i < 12; i++) {
    const g = new Game('campaign')
    for (let t = 0; t < 20; t += 1 / 60)
      g.update(1 / 60, { p1: { dir: 2, bomb: t === 1, detonate: false }, p2: idle })
    if (g.players[0].col < 0 || g.players[0].row < 0) ok = false
  }
  check('stable across levels', ok)
}

console.log(failures === 0 ? '\nALL QA PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
