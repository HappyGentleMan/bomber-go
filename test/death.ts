// Death-cause probe: twitch harness (p1 no-op), dump context when p2 dies
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
const g: any = new Game('battle', { aiPlayer2: true })
const key2 = (k: number) => (k % 15) + ',' + Math.floor(k / 15)
// log every aiState plant to find the ping-pong replanter
const stateMap: any = g.aiState
const origSet = stateMap.set.bind(stateMap)
let planting = false
g.aiState.set = (id: any, v: any) => {
  if (!planting && id === 1) {
    planting = true
    try {
      const s = stateMap.get(1)
      const prev = s ? `${s.kind}:${s.path.map((w: any) => w.x + ',' + w.y).join(' ')}` : 'null'
      const next = `${v.kind}:${v.path.map((w: any) => w.x + ',' + w.y).join(' ')}`
      if (prev !== next && g.bombs.length > 0) {
        const p2 = g.players[1]
        const sr = g['survivalRoute'](p2)
        const es = g['escapeRoute'](p2, g.blastSet(p2.col, p2.row, p2.flame))
        const allBl = new Set<number>(g['imminentSet']())
        for (const b of g.bombs) g.blastSet(b.col, b.row, b.power).forEach((k: number) => allBl.add(k))
        const boxInBlast = [...g['boxTiles'](p2)].filter((k: number) => allBl.has(k)).map(key2).join(' ')
        console.log(`PLANT t=${g.time.toFixed(3)} p2=(${p2.x.toFixed(2)},${p2.y.toFixed(2)}) box=[${[...g['boxTiles'](p2)].map(key2).join(' ')}] inBlast=[${boxInBlast}] ${prev} -> ${next} surv=[${sr ? sr.map((w: any) => w.x + ',' + w.y).join(' ') : 'null'}] esc=[${es ? es.map((w: any) => w.x + ',' + w.y).join(' ') : 'null'}] bombs=[${g.bombs.map((b: any) => `o${b.owner}@${b.col},${b.row}pw${b.power}f${Math.round(b.fuse)}`).join(' ')}]`)
      }
    } finally { planting = false }
  }
  origSet(id, v)
}
let deaths = 0
const hist: string[] = []
let lastPath = ''
for (let t = 0; t < 120 * 60 && deaths < 3; t++) {
  const p1 = g.players[0], p2 = g.players[1]
  const r2 = p2.alive ? g.aiThink(p2) : { ...noop }
  g.update(1 / 60, { p1: { ...noop }, p2: { ...r2 } })
  if (p2.alive) {
    const st = g.aiState.get(1)
    const pathStr = st ? `${st.kind}:${st.path.map((w: any) => w.x + ',' + w.y).join(' ')}` : 'null'
    if (pathStr !== lastPath) {
      hist.push(`t=${g.time.toFixed(2)} PATH-> ${pathStr} p2=(${p2.x.toFixed(2)},${p2.y.toFixed(2)}) bombs=[${g.bombs.map((b: any) => `o${b.owner}@${b.col},${b.row}f${Math.round(b.fuse)}`).join(' ')}]`)
      lastPath = pathStr
      if (hist.length > 40) hist.shift()
    }
  } else {
    deaths++
    console.log(`=== p2 death #${deaths} at t=${g.time.toFixed(2)} (p1 at ${p1.x.toFixed(1)},${p1.y.toFixed(1)} alive=${p1.alive}) ===`)
    for (const h of hist) console.log('  ' + h)
    hist.length = 0
    lastPath = ''
  }
}
console.log(`deaths=${deaths} in ${g.time.toFixed(1)}s`)
