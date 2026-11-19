// Position/state trace in a time window: finds the limit-cycle ping-pong.
// Run: npx tsx test/ptrace.ts [t0] [t1]
;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => {}, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0, getGamepads: () => [] },
  configurable: true,
})

const { Game } = await import('../src/game.ts')
const noop = { dir: null as any, bomb: false, detonate: false }
const T0 = Number(process.argv[2] ?? 40)
const T1 = Number(process.argv[3] ?? 46)
const g: any = new Game('battle', { aiPlayer2: true })
g.__dbg = []
g.__dbg2 = []
const p2 = g.players[1]
let last = ''
for (let t = 0; t < 60; t += 1 / 60) {
  g.update(1 / 60, { p1: { ...noop }, p2: { ...noop } })
  if (g.time < T0 || g.time > T1) continue
  if (!p2.alive) { console.log(`t=${g.time.toFixed(2)} DEAD`); continue }
  const st = g.aiState.get(1)
  const line = `t=${g.time.toFixed(2)} pos=(${p2.x.toFixed(2)},${p2.y.toFixed(2)}) md=${p2.movingDir} ` +
    `st=${st ? `i${st.i}/${st.path.length} h=${st.path[st.i] ? st.path[st.i].x + ',' + st.path[st.i].y : '-'} tc=${st.tc},${st.tr} nb=${[...st.noBricks].map((k: number) => (k % 15) + ',' + Math.floor(k / 15)).join('|')}` : 'null'} ` +
    `bombs=[${g.bombs.map((b: any) => b.owner + '@' + b.col + ',' + b.row + '/f' + Math.round(b.fuse / 100)).join(' ')}]`
  // print only when something changes (direction, state, bombs) to keep it readable
  const sig = p2.movingDir + '|' + (st ? st.i + '/' + st.path.length + st.path[st.i] : 'x') + '|' + g.bombs.map((b: any) => b.col + ',' + b.row).join()
  if (sig !== last) { console.log(line); last = sig }
}
