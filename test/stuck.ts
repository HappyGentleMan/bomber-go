// Stuck-episode tracer: when the bot stays >6 tiles from the player for
// 10+ s straight, dump its decision state (target, path, kind, standoff,
// detouring, noBricks, out, and a direct BFS to the player with NO avoid).
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
const secs = Number(process.argv[2] ?? 90)
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

let farRun = 0, episodes = 0, logged = 0
for (let t = 0; t < secs * 60; t++) {
  const p1 = g.players[0], p2 = g.players[1]
  const r1 = p1.alive ? playerThink(p1, p2) : { ...noop }
  const r2 = p2.alive ? g.aiThink(p2) : { ...noop }
  g.update(1 / 60, { p1: { ...r1 }, p2: { ...r2 } })
  // continuous state log for the first 30 s (every 6th tick)
  if (t < 30 * 60 && t % 6 === 0) {
    const st = g.aiState.get(1)
    const dist = Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y)
    console.log(`t=${(t / 60).toFixed(2)} bot=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) tile=${g.tile(p2.col, p2.row)} d=${dist.toFixed(1)} ` +
      `kind=${st.kind} tgt=(${st.tc},${st.tr}) path=${st.path.length} i=${st.i} ` +
      `repathIn=${(st.repath - g.time).toFixed(2)} dir=${r2.dir} bomb=${r2.bomb} bombs=${g.bombs.length}`)
    // diagnostic: frozen with a live path head
    if (r2.dir === null && st.i < st.path.length && t % 12 === 0) {
      const h = st.path[st.i]
      console.log(`  DIAG head=(${h.x},${h.y}) tile=${g.tile(h.x, h.y)} dHead=${((h.x - p2.x) ** 2 + (h.y - p2.y) ** 2).toFixed(2)} ` +
        `canSurviveBomb=${g['canSurviveBomb'](p2)} bombAt=${g.bombAt(p2.col, p2.row)} myBombs=${g.bombs.filter((b: any) => b.owner === 1).length} p.bombs=${p2.bombs} p.flame=${p2.flame}`)
    }
  }
  if (!p1.alive || !p2.alive) continue
  const dist = Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y)
  if (dist > 6) {
    farRun++
    if (farRun === 600 && logged < 4) { // 10 s of staying far
      episodes++; logged++
      const st = g.aiState.get(1)
      const direct = g.bfs(p2.col, p2.row, p1.col, p1.row, true, new Set())
      const steps = [0, 1, 2, 3].map((d: number) => g.canStep(p2, d) ? [d] : [])
        .filter((x: number[]) => x.length).join(',')
      console.log(`[ep ${episodes}] t=${(t / 60).toFixed(0)}s bot=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) pl=(${p1.x.toFixed(1)},${p1.y.toFixed(1)}) dist=${dist.toFixed(1)}`)
      console.log(`  target=(${st.tc},${st.tr}) path=${st.path.length} i=${st.i} kind=${st.kind} standoff=${st.standoff} detour=${st.detouring} noBricks=${st.noBricks.size}`)
      console.log(`  movingDir=${p2.movingDir} out.dir=${r2.dir} out.bomb=${r2.bomb} bombs=${g.bombs.length} powerups=${g.powerups.length} canStep=${steps || 'NONE'}`)
      console.log(`  bfs->player(no avoid): ${direct ? direct.length + ' steps' : 'NULL'}`)
    }
  } else {
    farRun = 0
  }
}
console.log(`stuck episodes (>6 tiles for 10s+): ${episodes}`)
