;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true })

const { Game } = await import('../src/game.ts')
const b = new Game('battle', { aiPlayer2: true, attract: true })
const noop = { dir: null as any, bomb: false, detonate: false }
for (let t = 0; t < 40; t += 1 / 60) {
  b.update(1 / 60, { p1: { ...noop }, p2: { ...noop } })
  if (Math.abs(t - Math.round(t * 5) / 5) < 1 / 120 && Math.round(t * 5) % 5 === 0) {
    const p1 = b.players[0], p2 = b.players[1]
    console.log(`t=${t.toFixed(1)} P1=(${p1.col},${p1.row}) mv=${p1.moving} md=${p1.movingDir} alive=${p1.alive} | P2=(${p2.col},${p2.row}) mv=${p2.moving} md=${p2.movingDir} alive=${p2.alive} | bombs=${b.bombs.length} powerups=${b.powerups.length}`)
  }
}
console.log('kills', b.players[0].kills, b.players[1].kills, 'state', b.state)
