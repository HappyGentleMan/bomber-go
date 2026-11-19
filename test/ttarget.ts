// Target-trace: every 2 s, log where the bot is, where the player is, and
// WHAT the bot is targeting (powerup vs enemy vs self) and why it isn't
// closing in. Run several times to catch a "far" seed.
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
const secs = Number(process.argv[2] ?? 60)
const g: any = new Game('battle', { aiPlayer2: true })

function playerThink(p1: any, bot: any) {
  const out = { ...noop }
  if (!p1.alive) return out
  const box = [...g['boxTiles'](p1)]
  const soon = g['imminentSet']()
  if (box.some((k: number) => soon.has(k))) {
    let best: any = null, bestScore = -1
    for (const d of [0, 1, 2, 3] as any[]) {
      if (!g.canStep(p1, d)) continue
      const [dc, dr] = [[1, 0], [-1, 0], [0, 1], [0, -1]][d]
      const st = g.boxTilesAt(p1.x + dc * 0.5, p1.y + dr * 0.5)
      const danger = [...st].some((k: number) => soon.has(k))
      const score = danger ? -10 : 1
      if (score > bestScore) { bestScore = score; best = d }
    }
    if (best !== null) { out.dir = best; return out }
  }
  if (!g.bombAt(p1.col, p1.row) && g.bombs.filter((b: any) => b.owner === 0).length < p1.bombs) {
    const inLine = bot.col === p1.col || bot.row === p1.row
    const d = Math.abs(bot.col - p1.col) + Math.abs(bot.row - p1.row)
    if (inLine && d >= 1 && d <= p1.flame && g['canSurviveBomb'](p1)) out.bomb = true
  }
  if (out.bomb) return out
  let target: { x: number; y: number } | null = null
  let bd = 99
  for (const u of g.powerups) {
    const dd = Math.abs(u.col - p1.col) + Math.abs(u.row - p1.row)
    if (dd < bd) { bd = dd; target = { x: u.col, y: u.row } }
  }
  if (!target) target = { x: 7, y: 6 }
  const dx = target.x - p1.x, dy = target.y - p1.y
  if (Math.abs(dx) > 0.4) out.dir = dx > 0 ? 0 : 1
  else if (Math.abs(dy) > 0.4) out.dir = dy > 0 ? 2 : 3
  return out
}

let farRun = 0
for (let t = 0; t < secs * 60; t++) {
  const p1 = g.players[0], p2 = g.players[1]
  const r1 = p1.alive ? playerThink(p1, p2) : { ...noop }
  const r2 = p2.alive ? g.aiThink(p2) : { ...noop }
  g.update(1 / 60, { p1: { ...r1 }, p2: { ...r2 } })
  if (!p1.alive || !p2.alive) continue
  const dist = Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y)
  if (t % 120 === 0) {
    const st = g.aiState.get(1)
    // classify the target
    const isPU = g.powerups.some((u: any) => u.col === st.tc && u.row === st.tr)
    const isEnemy = p1.col === st.tc && p1.row === st.tr
    const isSelf = p2.col === st.tc && p2.row === st.tr
    const kind = isPU ? 'PU' : isEnemy ? 'ENEMY' : isSelf ? 'SELF' : `other(${st.tc},${st.tr})`
    if (dist > 6) farRun++
    console.log(`t=${(t / 60).toFixed(0)}s bot=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) pl=(${p1.x.toFixed(1)},${p1.y.toFixed(1)}) d=${dist.toFixed(1)} tgt=${kind} kind=${st.kind} stand=${st.standoff} detour=${st.detouring} dir=${r2.dir} bombs=${g.bombs.length} farTicks=${farRun}`)
  }
}
console.log(`total far(>6) ticks: ${farRun}`)
