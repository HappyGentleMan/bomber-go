// Statistical helper: run N battle matches, report length + draw rate.
// A "drawn round" ends with winner -1 (the round replays). We count rounds via
// the roundstart event and draws via roundwin(winner=-1).
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true })

const { Game } = await import('../src/game.ts')

const STEP = 1 / 60
const CAP = 30 * 60
const N = parseInt(process.argv[2] || '20')
const noop = { dir: null as any, bomb: false, detonate: false }

let totalLen = 0, totalDraws = 0, totalRounds = 0, terminated = 0
let minLen = Infinity, maxLen = 0

for (let m = 0; m < N; m++) {
  const g = new Game('battle', { aiPlayer2: true, attract: true })
  let rounds = 0, draws = 0
  g.onEvent = (ev: string, data?: any) => {
    if (ev === 'roundstart') rounds++
    if (ev === 'roundwin' && data?.winner === -1) draws++
  }
  let t = 0, guard = 0
  while (g.state !== 'battleover' && t < CAP && guard < CAP / STEP) {
    g.update(STEP, { p1: noop, p2: noop }); t += STEP; guard++
  }
  if (g.state === 'battleover') terminated++
  totalLen += t; totalRounds += rounds; totalDraws += draws
  minLen = Math.min(minLen, t); maxLen = Math.max(maxLen, t)
}

console.log(`matches: ${terminated}/${N} terminated`)
console.log(`avg length: ${(totalLen / N).toFixed(0)}s  (min ${minLen.toFixed(0)}s, max ${maxLen.toFixed(0)}s)`)
console.log(`avg rounds/match: ${(totalRounds / N).toFixed(2)}`)
console.log(`total drawn rounds: ${totalDraws}  (draw rate: ${(totalDraws / Math.max(1, totalRounds)).toFixed(2)})`)
