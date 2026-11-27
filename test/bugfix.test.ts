// Regression tests for verified bugs from the full-game debug review.
// Run: npx tsx test/bugfix.test.ts
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {},
  devicePixelRatio: 1, setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
;(globalThis as any).document = { activeElement: null, addEventListener: () => {}, removeEventListener: () => {} }
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true,
})

const { Game } = await import('../src/game.ts')
const { input } = await import('../src/input.ts')
const { T_SOFT } = await import('../src/constants.ts')

let failures = 0
const check = (name: string, cond: boolean) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name}`); failures++ }
}
const idle = { dir: null as any, bomb: false, detonate: false }
const battle = () => new Game('battle', { aiPlayer2: false, p1Color: '#00e5ff', p1Char: 'bomber' })
const pad = (pressed: number[]) => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false }))
  for (const i of pressed) buttons[i] = { pressed: true }
  return [{ axes: [0, 0], buttons }]
}
const setPads = (pads: any[]) => Object.defineProperty(navigator, 'getGamepads', { value: () => pads, configurable: true })

console.log('— I1: stunned player cannot bomb/detonate (update path) —')
{
  const g = battle()
  g.players[0].frozenUntil = g.time + 5
  const before = g.bombs.length
  g.update(1 / 60, { p1: { ...idle, bomb: true }, p2: idle })
  check('stunned player cannot place a bomb', g.bombs.length === before)
}

console.log('— I2: startRound clears the sudden-death kill window —')
{
  const g = battle()
  g.lastSuddenDetonation = 121 // round 1 ended via sudden death
  g.startRound()
  check('round 2 normal kills are credited (window reset)', g.time - g.lastSuddenDetonation >= 0.5)
}

console.log('— I3: can bomb out of a brick after wallpass expires (no softlock) —')
{
  const g = new Game('campaign', { p1Color: '#00e5ff', p1Char: 'bomber' })
  const p = g.players[0]
  let sc = -1, sr = -1
  for (let r = 1; r < g.grid.length - 1 && sc < 0; r++)
    for (let c = 1; c < g.grid[r].length - 1; c++)
      if (g.grid[r][c].t === T_SOFT) { sc = c; sr = r; break }
  p.col = sc; p.row = sr; p.x = sc; p.y = sr
  const before = g.bombs.length
  g.tryPlaceBomb(p)
  check('bomb placeable while standing in a soft tile', g.bombs.length > before)
}

console.log('— I4: blur releases a held keyboard direction —')
{
  setPads([])
  ;(input as any).onKeyDown({ code: 'KeyD', repeat: false, preventDefault() {} })
  check('held D gives dir 0', input.poll().p1.dir === 0)
  ;(input as any).onBlur()
  check('after blur, no stuck direction', input.poll().p1.dir === null)
}

console.log('— I5: gamepad d-pad LEFT/RIGHT are not swapped —')
{
  ;(input as any).onBlur()
  setPads(pad([14])) // W3C button 14 = LEFT
  check('d-pad LEFT -> dir 1 (left)', input.poll().p1.dir === 1)
  setPads(pad([15])) // W3C button 15 = RIGHT
  check('d-pad RIGHT -> dir 0 (right)', input.poll().p1.dir === 0)
  setPads([])
}

console.log('— M4: gamepad bomb is edge-triggered, not auto-fire —')
{
  ;(input as any).onBlur()
  setPads(pad([0])) // hold A (bomb)
  const first = input.poll().p1.bomb
  const second = input.poll().p1.bomb
  check('held bomb fires once (first poll)', first === true)
  check('held bomb does not auto-fire (second poll)', second === false)
  setPads([])
}

if (failures) { console.log(`\n${failures} FAILURE(S)`); process.exit(1) }
console.log('\nALL BUGFIX TESTS PASSED')