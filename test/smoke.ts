// Headless smoke test: simulates game logic without DOM.
// Run: npx tsx test/smoke.ts

// ---- DOM stubs ----
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

let failures = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${extra}`); failures++ }
}
const noop = { dir: null as any, bomb: false, detonate: false }
const tick = (g: Game, t: number, p1in = { ...noop }, p2in = { ...noop }) =>
  g.update(1 / 60, { p1: p1in, p2: p2in })

console.log('— Level generation (all 12 levels) —')
for (let lvl = 1; lvl <= 12; lvl++) {
  const g = new Game('campaign')
  for (let i = 1; i < lvl; i++) g.nextLevel()
  check(`level ${lvl} valid`, g.grid.length === 13 && g.enemies.length >= 3 && g.exit.col > 0,
    `enemies=${g.enemies.length} exit=(${g.exit.col},${g.exit.row})`)
}

console.log('— Explosion mechanics —')
{
  const g = new Game('campaign')
  let brick: { c: number; r: number } | null = null
  outer: for (let r = 1; r < 12; r++)
    for (let c = 1; c < 14; c++)
      if (g.grid[r][c].t === 2) {
        for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]])
          if (g.grid[r+dr][c+dc].t === 0) { brick = { c, r }; break outer }
      }
  check('found test brick', !!brick)
  if (brick) {
    const p = g.players[0]
    const spots = [[1,0],[-1,0],[0,1],[0,-1]].map(([dc,dr]) => ({ c: brick!.c + dc, r: brick!.r + dr }))
        .find(s => g.grid[s.r][s.c].t === 0)!
    p.col = spots.c; p.row = spots.r; p.x = spots.c; p.y = spots.r
    p.invincibleUntil = 100
    g.tryPlaceBomb(p)
    check('bomb placed', g.bombs.length === 1)
    for (let t = 0; t < 3; t += 1/60) tick(g, t)
    check('brick destroyed by explosion', g.grid[brick.r][brick.c].t === 0)
    check('invincible player survived own bomb core', p.alive)
  }
}

console.log('— Enemy kill & scoring —')
{
  const g = new Game('campaign')
  const e = g.enemies[0]
  const p = g.players[0]
  // put player 2 tiles left of enemy on open ground
  const spots: { c: number; r: number }[] = []
  for (let r = 1; r < 12; r++)
    for (let c = 1; c < 10; c++)
      if (g.grid[r][c].t === 0 && g.grid[r][c+1].t === 0 && g.grid[r][c+2].t === 0)
        spots.push({ c, r })
  check('found open line', spots.length > 0)
  if (spots.length) {
    const s = spots[Math.floor(spots.length / 2)]
    p.col = s.c; p.row = s.r; p.x = s.c; p.y = s.r
    e.col = s.c + 2; e.row = s.r; e.x = s.c + 2; e.y = s.r
    e.moving = false; e.dir = 1
    g.freezeUntil = 100 // keep enemy in place for the test
    p.flame = 3
    g.tryPlaceBomb(p)
    for (let t = 0; t < 3; t += 1/60) tick(g, t)
    check('enemy killed by flame', !e.alive)
    check('score awarded (>=100)', g.score >= 100, `score=${g.score}`)
  }
}

console.log('— Powerup pickup —')
{
  const g = new Game('campaign')
  const p = g.players[0]
  g.powerups.push({ col: p.col, row: p.row, kind: 'bomb', born: 0 })
  tick(g, 0)
  check('bomb pickup raises capacity', p.bombs === 2, `bombs=${p.bombs}`)
  g.powerups.push({ col: p.col, row: p.row, kind: 'flame', born: 0 })
  tick(g, 1)
  check('flame pickup raises range', p.flame === 2, `flame=${p.flame}`)
}

console.log('— Campaign bot run (invincible, 60s) —')
{
  const g = new Game('campaign')
  const p = g.players[0]
  p.invincibleUntil = 1000
  const dirs = [2, 0, 3, 1] as const
  for (let t = 0; t < 60; t += 1/60) {
    tick(g, t, { dir: dirs[Math.floor(t * 2) % 4], bomb: Math.floor(t * 2) % 7 === 0, detonate: false })
  }
  check('bot scored points', g.score > 0, `score=${g.score}`)
  console.log(`  (score=${g.score}, state=${g.state}, level=${g.level}, lives=${g.lives})`)
}

console.log('— Battle: 2 AI, 150s —')
{
  const b = new Game('battle', { aiPlayer2: true, attract: true })
  for (let t = 0; t < 150; t += 1/60) tick(b, t)
  const total = b.players[0].kills + b.players[1].kills
  check('AI kills happen', total > 0, `kills=${b.players[0].kills}+${b.players[1].kills}`)
  console.log(`  (kills P1=${b.players[0].kills} P2=${b.players[1].kills}, suddenDeath=${b.suddenDeath}, state=${b.state})`)
}

console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
