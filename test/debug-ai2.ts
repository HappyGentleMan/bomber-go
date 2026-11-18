;(globalThis as any).window = {
  addEventListener: () => {}, removeEventListener: () => {}, devicePixelRatio: 1,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
}
;(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0, getGamepads: () => [] }, configurable: true })

const { Game } = await import('../src/game.ts')
const b = new Game('battle', { aiPlayer2: true })
const idle = { dir: null as any, bomb: false, detonate: false }
for (let t = 0; t < 600; t++) {
  b.update(1 / 60, { p1: idle, p2: idle })
  if (t % 60 === 0) {
    const p1 = b.players[0], p2 = b.players[1]
    console.log(`t=${(t / 60).toFixed(0)} P2=(${p2.col},${p2.row}) mv=${p2.moving} md=${p2.movingDir} dir=${p2.dir} isAI=${p2.isAI} | P1=(${p1.col},${p1.row}) | bombs=${b.bombs.length}`)
  }
}
console.log('state', b.state, 'kills', b.players[0].kills, b.players[1].kills)
