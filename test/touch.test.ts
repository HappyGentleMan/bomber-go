// Unit test: pure 4-direction quantization for floating touch controls.
// Run: npx tsx test/touch.test.ts
import { quantizeDir, clampBaseOrigin } from '../src/touch.ts'
import type { Dir } from '../src/constants.ts'

let failures = 0
const eq = (name: string, got: Dir | null, want: Dir | null) => {
  if (got === want) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} — got ${got}, want ${want}`); failures++ }
}

console.log('— quantizeDir: deadzone —')
eq('origin → null', quantizeDir(0, 0, 12), null)
eq('inside deadzone → null', quantizeDir(11, 0, 12), null)
eq('on deadzone edge → null', quantizeDir(12, 0, 12), null)

console.log('— quantizeDir: cardinal directions —')
eq('right', quantizeDir(13, 0, 12), 0)
eq('left', quantizeDir(-13, 0, 12), 1)
eq('down', quantizeDir(0, 13, 12), 2)
eq('up', quantizeDir(0, -13, 12), 3)

console.log('— quantizeDir: dominant axis —')
eq('mostly right', quantizeDir(20, 5, 12), 0)
eq('mostly down', quantizeDir(5, 20, 12), 2)
eq('mostly up', quantizeDir(-5, -20, 12), 3)
eq('mostly left', quantizeDir(-20, 5, 12), 1)

console.log('— quantizeDir: diagonal tie → horizontal —')
eq('tie +/+ → right', quantizeDir(20, 20, 12), 0)
eq('tie -/- → left', quantizeDir(-20, -20, 12), 1)
eq('tie +/- → right', quantizeDir(20, -20, 12), 0)

console.log('— clampBaseOrigin: base stays inside the move zone (never over the field) —')
const zone = { left: 0, top: 500, right: 192, bottom: 844 }
const eqXY = (name: string, got: { cx: number; cy: number }, cx: number, cy: number) => {
  if (got.cx === cx && got.cy === cy) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} — got (${got.cx},${got.cy}), want (${cx},${cy})`); failures++ }
}
eqXY('inside zone unchanged', clampBaseOrigin(100, 700, 66, zone, 390, 844), 100, 700)
eqXY('near top edge clamps down into zone', clampBaseOrigin(100, 505, 66, zone, 390, 844), 100, 566)
eqXY('near left edge clamps right', clampBaseOrigin(5, 700, 66, zone, 390, 844), 66, 700)
eqXY('near bottom edge clamps up', clampBaseOrigin(100, 840, 66, zone, 390, 844), 100, 778)
eqXY('near right edge clamps left', clampBaseOrigin(190, 700, 66, zone, 390, 844), 126, 700)
{
  const top = clampBaseOrigin(100, 505, 66, zone, 390, 844)
  if (top.cy - 66 >= zone.top) console.log('  ✓ base top never above zone top (no field coverage)')
  else { console.log('  ✗ base covers field above zone'); failures++ }
}

if (failures) { console.log(`\n${failures} FAILURE(S)`); process.exit(1) }
console.log('\nALL TOUCH TESTS PASSED')