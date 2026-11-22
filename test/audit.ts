// Audit fixes: headless tests for the 2026-11-22 audit findings (game logic half).
// Run: npx tsx test/audit.ts

// ---- DOM stubs (same pattern as smoke.ts) ----
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
const { updateSettings, settings } = await import('../src/storage.ts')
const { MAX_POWERUPS_ON_FIELD } = await import('../src/constants.ts')
const { RemoteGame, serializeGame, diffSnapshots } = await import('../src/netgame.ts')
const { input } = await import('../src/input.ts')

let failures = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${extra}`); failures++ }
}
const noop = { dir: null as any, bomb: false, detonate: false }
const tick = (g: Game, p1in = { ...noop }, p2in = { ...noop }) =>
  g.update(1 / 60, { p1: p1in, p2: p2in })

console.log('— Sudden-death kill credit —')
{
  const b = new Game('battle', { aiPlayer2: true })
  const [p1, p2] = b.players
  b.time = 2
  ;(b as any).lastSuddenDetonation = b.time // a sudden bomb just detonated
  b.killPlayer(p2, 'flame')
  check('sudden-death kill not credited', p1.kills === 0, `kills=${p1.kills}`)
}
{
  const b = new Game('battle', { aiPlayer2: true })
  const [p1, p2] = b.players
  b.time = 2
  ;(b as any).lastSuddenDetonation = 0 // old — normal kill
  b.killPlayer(p2, 'flame')
  check('normal kill still credited', p1.kills === 1, `kills=${p1.kills}`)
}

console.log('— No double detonation of a chained bomb —')
{
  const b = new Game('battle', { aiPlayer2: true })
  let a: { c: number; r: number } | null = null
  outer: for (let r = 1; r < 12; r++)
    for (let c = 1; c < 13; c++)
      if (b.grid[r][c].t === 0 && b.grid[r][c + 1].t === 0) { a = { c, r }; break outer }
  if (a) {
    b.bombs.push({ id: b.bombId++, owner: 0, col: a.c, row: a.r, x: a.c, y: a.r, sliding: null, fuse: 0, power: 2, born: b.time })
    b.bombs.push({ id: b.bombId++, owner: 1, col: a.c + 1, row: a.r, x: a.c + 1, y: a.r, sliding: null, fuse: 0, power: 2, born: b.time })
    tick(b)
    const dup = b.flames.filter(f => f.col === a.c + 1 && f.row === a.r && f.dir === -1).length
    check('chained bomb detonates once (no duplicate core flame)', dup === 1, `dups=${dup}`)
  }
}

console.log('— Respawn: stun cleared, spawn-tile bomb respected —')
{
  const b = new Game('battle', { aiPlayer2: true })
  const p1 = b.players[0]
  p1.alive = false; p1.respawnIn = 0.1; p1.frozenUntil = b.time + 10
  for (let t = 0; t < 2; t += 1 / 60) tick(b)
  check('respawn clears frozenUntil', p1.alive && p1.frozenUntil === 0, `alive=${p1.alive} frozen=${p1.frozenUntil}`)
}
{
  const b = new Game('battle', { aiPlayer2: true })
  const p1 = b.players[0]
  b.players[1].speed = 0 // keep the AI opponent out of the test
  b.bombs.push({ id: b.bombId++, owner: -1, col: 1, row: 1, x: 1, y: 1, sliding: null, fuse: 3000, power: 1, born: b.time })
  p1.alive = false; p1.respawnIn = 0.1
  for (let t = 0; t < 1; t += 1 / 60) tick(b)
  check('respawn waits for spawn-tile bomb', !p1.alive, `alive=${p1.alive}`)
  for (let t = 0; t < 4; t += 1 / 60) tick(b)
  check('respawn happens after the bomb clears', p1.alive && b.bombAt(1, 1) === undefined, `alive=${p1.alive}`)
}

console.log('— Stunned player cannot bomb/detonate —')
{
  const b = new Game('battle', { aiPlayer2: true })
  const p1 = b.players[0]
  p1.frozenUntil = b.time + 5
  b.playerInput(0, null, true, false)
  check('stunned player cannot place a bomb', b.bombs.length === 0, `bombs=${b.bombs.length}`)
}

console.log('— Battle item drops: no life, field cap respected —')
{
  const b = new Game('battle', { aiPlayer2: true, attract: true })
  b.players.forEach(p => p.speed = 0)
  b.powerups = []
  let sawLife = false, capHit = false
  for (let i = 0; i < 60; i++) {
    b.battleNextItem = 0
    tick(b)
    for (const u of b.powerups) if (u.kind === 'life') sawLife = true
    if (b.powerups.length > MAX_POWERUPS_ON_FIELD) capHit = true
  }
  check('battle drops never include life', !sawLife)
  check('battle drops respect MAX_POWERUPS_ON_FIELD', !capHit, `count=${b.powerups.length}`)
}

console.log('— Screen shake setting honored —')
{
  const g = new Game('campaign')
  g.shake(10, 0.4)
  updateSettings({ shake: false })
  const off = g.getShakeOffset()
  check('shake off => zero offset', off.x === 0 && off.y === 0, JSON.stringify(off))
  updateSettings({ shake: true })
  check('shake setting restored', settings.shake === true)
}

console.log('— Power>=4 blast hit-stops —')
{
  const b = new Game('battle', { aiPlayer2: true })
  let a: { c: number; r: number } | null = null
  outer: for (let r = 1; r < 12; r++)
    for (let c = 1; c < 13; c++)
      if (b.grid[r][c].t === 0) { a = { c, r }; break outer }
  if (a) {
    b.bombs.push({ id: b.bombId++, owner: -1, col: a.c, row: a.r, x: a.c, y: a.r, sliding: null, fuse: 0, power: 5, born: b.time })
    tick(b)
    check('power>=4 detonation hit-stops', b.timeScale < 1, `timeScale=${b.timeScale}`)
  }
}

console.log('— RemoteGame ready flag (join-race gate) —')
{
  const r = new RemoteGame()
  check('remote not ready before first snapshot', r.ready === false, `ready=${(r as any).ready}`)
  const g = new Game('battle', { aiPlayer2: true })
  r.apply(serializeGame(g))
  check('remote ready after first snapshot', r.ready === true)
}

console.log('— Round winner reaches the client via snapshot —')
{
  const g = new Game('battle', { aiPlayer2: true })
  g.endBattle(0) // awards the round to P1; state stays 'playing' (1 < round target)
  const snap = serializeGame(g)
  check('snapshot carries lastRoundWin', snap.lastRoundWin === 0, `lastRoundWin=${snap.lastRoundWin}`)
  const prev = { ...snap, lastRoundWin: -1, state: 'playing', round: snap.round - 1 }
  const ev = diffSnapshots(prev, snap)
  check('diff reports round winner to client', ev.roundWin === 0, `roundWin=${ev.roundWin}`)
  const ev2 = diffSnapshots(snap, { ...snap })
  check('no spurious round event on identical snapshots', ev2.roundWin === -1)
}

console.log('— Two-finger d-pad: latest press wins, release falls back —')
{
  input.dpadSet(1, true)   // left
  check('dpad single press', input.getTouchDir() === 1)
  input.dpadSet(2, true)   // left+down
  check('dpad two fingers -> latest (down)', input.getTouchDir() === 2)
  input.dpadSet(1, false)  // release left
  check('dpad release falls back to down', input.getTouchDir() === 2)
  input.dpadSet(2, false)
  check('dpad all released -> null', input.getTouchDir() === null)
}

console.log('— Game keys ignored while an input field is focused —')
{
  ;(globalThis as any).document = { activeElement: { tagName: 'INPUT' } }
  ;(input as any).onKeyDown({ code: 'Space', repeat: false, preventDefault: () => {} })
  check('Space in an input does not bomb', (input as any).p1.bomb === false)
  ;(globalThis as any).document = { activeElement: null }
}

console.log(failures === 0 ? '\nALL AUDIT TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
