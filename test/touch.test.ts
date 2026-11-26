// Unit test: pure 4-direction quantization for floating touch controls.
// Run: npx tsx test/touch.test.ts
import { quantizeDir } from '../src/touch.ts'
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

if (failures) { console.log(`\n${failures} FAILURE(S)`); process.exit(1) }
console.log('\nALL TOUCH TESTS PASSED')