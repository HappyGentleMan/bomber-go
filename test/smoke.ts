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

console.log('— Spawn area clear (no bricks boxing in the player) —')
{
  let bad = 0
  for (let i = 0; i < 25; i++) {
    const g = new Game('campaign')
    // 3x3 around spawn (1,1): only the (2,2) hard pillar may be non-walk
    for (let r = 1; r <= 3; r++)
      for (let c = 1; c <= 3; c++) {
        if (c === 2 && r === 2) continue
        if (g.grid[r][c].t !== 0) bad++
      }
  }
  check('no soft bricks in spawn 3x3 (25 levels)', bad === 0, `bricks=${bad}`)
  const b = new Game('battle', { aiPlayer2: true })
  let badB = 0
  for (const s of [
    { c: 1, r: 1, dc: 1, dr: 1 }, { c: 13, r: 1, dc: -1, dr: 1 },
    { c: 1, r: 11, dc: 1, dr: -1 }, { c: 13, r: 11, dc: -1, dr: -1 },
  ])
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const c = s.c + s.dc * i, r = s.r + s.dr * j
        if (c <= 0 || r <= 0 || c >= 14 || r >= 12) continue // border
        if (Math.abs(c - s.c) + Math.abs(r - s.r) === 2 && i === 1 && j === 1) continue // pillar
        if (b.grid[r][c].t !== 0) badB++
      }
  check('no soft bricks in battle spawn corners', badB === 0, `bricks=${badB}`)
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

console.log('— Powerup drops —')
{
  // kills drop items: 20 fresh levels, kill everyone, count drops
  let drops = 0
  for (let i = 0; i < 20; i++) {
    const g = new Game('campaign')
    for (const e of g.enemies) g.killEnemy(e, null, false)
    drops += g.powerups.length
  }
  check('kills drop powerups (expect ~40+)', drops > 15, `drops=${drops}/20 levels`)

  // the level's FINAL enemy is a guaranteed drop
  {
    const g = new Game('campaign')
    const alive = g.enemies.filter(e => e.alive)
    for (const e of alive.slice(0, -1)) g.killEnemy(e, null, false)
    g.powerups = [] // simulate the player collecting everything so far
    const last = g.enemies.filter(e => e.alive)[0]
    g.killEnemy(last, null, false)
    check('final enemy always drops an item', g.powerups.length === 1, `powerups=${g.powerups.length}`)
  }
}

console.log('— Battle item spawn —')
{
  const b = new Game('battle', { aiPlayer2: true, attract: true })
  const before = b.powerups.length // battle map ships with items hidden in bricks
  b.players.forEach(p => p.speed = 0) // freeze: spawn is checked before AI could pick it up
  b.battleNextItem = 0
  tick(b, 0)
  check('battle item spawns', b.powerups.length === before + 1, `powerups=${b.powerups.length} (before=${before})`)
  const u = b.powerups[b.powerups.length - 1]
  check('spawned item is revealed (not hidden)', u.revealed === true, `revealed=${u.revealed}`)
  const free = b.grid[u.row][u.col].t === 0 && !b.players.some(p => p.alive && p.col === u.col && p.row === u.row)
  check('battle item on open unoccupied tile', free, `tile=(${u.col},${u.row})`)
}

console.log('— Hidden powerups in destructible bricks —')
{
  let tested = 0
  for (let lvl = 1; lvl <= 6 && tested < 3; lvl++) {
    const g = new Game('campaign')
    for (let i = 1; i < lvl; i++) g.nextLevel()
    const hidden = g.powerups.filter(u => !u.revealed)
    if (!hidden.length) continue
    tested++
    const u = hidden[0]
    check(`level ${lvl}: item hides under a brick`, g.grid[u.row][u.col].t === 2,
      `tile=(${u.col},${u.row}) t=${g.grid[u.row][u.col].t}`)
    g.destroyBrick(u.col, u.row)
    const now = g.powerups.find(x => x.col === u.col && x.row === u.row)
    check(`level ${lvl}: breaking the brick reveals it`, now?.revealed === true, `revealed=${now?.revealed}`)
  }
  check('campaign levels hide items in bricks (6 levels sampled)', tested > 0, `tested=${tested}`)
  // stress: NO hidden item (or the exit) may be exposed on a walk tile
  // (campaign + battle). The exit was the one that slipped through: carving
  // for powerups/enemies routed through its brick, and with no brick under
  // it the portal could never reveal (52.8% of levels were un-clearable)
  let exposed = 0, maps = 0
  for (let i = 0; i < 60; i++) {
    maps++
    const g = new Game('campaign')
    for (const u of g.powerups) if (!u.revealed && g.grid[u.row][u.col].t !== 2) exposed++
    if (g.grid[g.exit.row][g.exit.col].t !== 2) exposed++
    const b = new Game('battle', { aiPlayer2: true, attract: true })
    for (const u of b.powerups) if (!u.revealed && b.grid[u.row][u.col].t !== 2) exposed++
  }
  check('no hidden item/exit exposed on walk tiles (60 maps)', exposed === 0, `exposed=${exposed}`)
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
  // two independent battles: 0 kills in a single 150s run is possible with an
  // unlucky seed (both bots camping), so require kills across both
  let total = 0
  for (let n = 0; n < 2; n++) {
    const b = new Game('battle', { aiPlayer2: true, attract: true })
    for (let t = 0; t < 150; t += 1/60) tick(b, t)
    total += b.players[0].kills + b.players[1].kills
    console.log(`  (run ${n + 1}: kills P1=${b.players[0].kills} P2=${b.players[1].kills}, suddenDeath=${b.suddenDeath}, state=${b.state})`)
  }
  check('AI kills happen', total > 0, `kills=${total} over 2 runs`)
}

console.log(failures === 0 ? '\nALL SMOKE TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
