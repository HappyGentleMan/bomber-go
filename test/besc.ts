// Trace canSurviveBomb rejections: why does the survivability gate fail?
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
const tn = (t: number) => ['WALK', 'SOFT', 'HARD'][t]
const orig = g['canSurviveBomb'].bind(g)
let n = 0
g['canSurviveBomb'] = (p: any) => {
  const ok = orig(p)
  if (!ok && p.id === 1 && ++n <= 6) {
    const blast = g.blastSet(p.col, p.row, p.flame)
    const box = [...g['boxTiles'](p)]
    console.log(`--- t=${g.time.toFixed(2)} p=(${p.x.toFixed(2)},${p.y.toFixed(2)}) derived=(${p.col},${p.row}) flame=${p.flame}`)
    console.log('  box:', box.map(key2).join(' '), ' inBlast:', box.filter(k => blast.has(k)).map(key2).join(' '))
    console.log('  blast:', [...blast].map(key2).join(' '))
    // which neighbours are enterable?
    for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nc = p.col + dc, nr = p.row + dr
      const enter = g.canEnter(p, nc, nr)
      console.log(`  n(${nc},${nr}) ${tn(g.tile(nc, nr))} enter=${enter} inBlast=${blast.has(15 * nr + nc)} bomb=${g.bombAt(nc, nr)}`)
    }
    console.log('  bombs:', g.bombs.map((b: any) => `o${b.owner}@${b.col},${b.row} f${Math.round(b.fuse)}`).join(' ') || 'none')
    console.log('  bombs near:', g.bombs.filter((b: any) => Math.abs(b.col - p.col) + Math.abs(b.row - p.row) <= 3).length)
  }
  return ok
}
for (let t = 0; t < 60 * 60; t++) {
  const p1 = g.players[0], p2 = g.players[1]
  const r1 = p1.alive ? g.aiThink(p1) : { ...noop }
  const r2 = p2.alive ? g.aiThink(p2) : { ...noop }
  g.update(1 / 60, { p1: { ...r1 }, p2: { ...r2 } })
}
console.log('done')
