// Jam probe: when the bot has commanded a direction but makes no progress
// for 5 s, dump its surroundings (3x3 tiles, canStep per dir, box after a
// half-step, bombs, path, noBricks, detourBrick) to find what blocks it.
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
const T = { 0: '.', 1: '#', 2: 'B' }

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

let lastX = 0, lastY = 0, stillT = 0, logged = 0
for (let t = 0; t < secs * 60; t++) {
  const p1 = g.players[0], p2 = g.players[1]
  const r1 = p1.alive ? playerThink(p1, p2) : { ...noop }
  const r2 = p2.alive ? g.aiThink(p2) : { ...noop }
  g.update(1 / 60, { p1: { ...r1 }, p2: { ...r2 } })
  if (!p1.alive || !p2.alive) continue
  if (t % 300 === 0) { lastX = p2.x; lastY = p2.y; stillT = 0 }
  const moved = Math.abs(p2.x - lastX) + Math.abs(p2.y - lastY)
  if (moved < 0.5) stillT++
  if (stillT === 300 && r2.dir !== null && logged < 3) {
    logged++
    const st = g.aiState.get(1)
    const c = p2.col, r = p2.row
    let map = ''
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const k = (c + dc) + ',' + (r + dr)
        const bomb = g.bombs.some((b: any) => b.col === c + dc && b.row === r + dr)
        map += T[g.tile(c + dc, r + dr)] + (bomb ? '*' : '') + ' '
      }
      map += '\n'
    }
    const steps = [0, 1, 2, 3].map((d: number) => `${d}:${g.canStep(p2, d) ? 'Y' : 'N'}`).join(' ')
    const halfStep = [0, 1, 2, 3].map((d: number) => {
      const [dc, dr] = [[1, 0], [-1, 0], [0, 1], [0, -1]][d]
      const bt = [...g.boxTilesAt(p2.x + dc * 0.5, p2.y + dr * 0.5)].map((k: number) => `${k % 15},${Math.floor(k / 15)}:${T[g.tile(k % 15, Math.floor(k / 15))]}`).join(';')
      return `d${d}[${bt}]`
    }).join(' ')
    const nb = [...(st.noBricks ?? [])].map((k: number) => `${k % 15},${Math.floor(k / 15)}`).join(' ')
    console.log(`[jam] t=${(t / 60).toFixed(0)}s bot=(${p2.x.toFixed(2)},${p2.y.toFixed(2)}) tile=(${c},${r}) dir=${r2.dir} movingDir=${p2.movingDir}`)
    console.log(`  map (bot at center, * = bomb):\n${map}`)
    console.log(`  canStep ${steps}`)
    console.log(`  halfStep boxes: ${halfStep}`)
    console.log(`  path=${st.path.length} i=${st.i} kind=${st.kind} tgt=(${st.tc},${st.tr}) noBricks=[${nb}] detourBrick=${st.detourBrick !== undefined ? st.detourBrick % 15 + ',' + Math.floor(st.detourBrick / 15) : 'none'}`)
    console.log(`  wallpassUntil=${(p2.wallpassUntil ?? 0).toFixed(1)} (now=${g.time.toFixed(1)})  boxTiles=${[...g['boxTiles'](p2)].map((k: number) => `${k % 15},${Math.floor(k / 15)}`).join(' ')}`)
  }
}
console.log(`jam dumps: ${logged}`)
