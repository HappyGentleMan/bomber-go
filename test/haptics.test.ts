// Haptics test: the feature-guarded haptic() and bomb-drop feedback wiring.
// Run: npx tsx test/haptics.test.ts
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {},
  devicePixelRatio: 1, setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
const vibed: (number | number[])[] = []
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0, getGamepads: () => [], vibrate: (p: number | number[]) => { vibed.push(p); return true } },
  configurable: true,
})

const { Game, haptic } = await import('../src/game.ts')

let failures = 0
const check = (name: string, cond: boolean) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name}`); failures++ }
}

console.log('— haptic guard (existing behavior, regression) —')
vibed.length = 0
haptic(50)
check('haptic(50) forwards to navigator.vibrate', vibed.includes(50))
const saved = (navigator as any).vibrate
delete (navigator as any).vibrate
let threw = false
try { haptic(50) } catch { threw = true }
check('haptic without vibrate support does not throw', !threw)
;(navigator as any).vibrate = saved

console.log('— bomb-drop feedback (new wiring) —')
vibed.length = 0
const g = new Game('campaign', { p1Color: '#00e5ff', p1Char: 'bomber' })
g.playerInput(0, null, true, false) // place a bomb
check('placing a bomb triggers a haptic', vibed.length > 0)

if (failures) { console.log(`\n${failures} FAILURE(S)`); process.exit(1) }
console.log('\nALL HAPTICS TESTS PASSED')