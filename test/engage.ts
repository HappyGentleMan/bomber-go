// Engagement probe: is the bot actively playing, or bomb->sit->repeat?
// p2 = the AI (real aiThink). p1 = a simple "live player" that wanders to
// powerups, keeps a moderate distance, dodges, and bombs when lined up.
// Measures the bot's distance to the player over time and how much of its
// time it spends idle vs moving-vs-the-player, split by own-bomb-live.
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
const secs = Number(process.argv[2] ?? 120)
const g: any = new Game('battle', { aiPlayer2: true })

// --- simple live player (p1): a "human-ish" opponent -------------------
function playerThink(p1: any, bot: any) {
  const out = { ...noop }
  if (!p1.alive) return out
  const box = [...g['boxTiles'](p1)]
  const ownBomb = g.bombs.some((b: any) => b.owner === 0)
  // danger: in an imminent blast -> flee
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
  // bomb when lined up with the bot within flame
  if (!g.bombAt(p1.col, p1.row) && g.bombs.filter((b: any) => b.owner === 0).length < p1.bombs) {
    const inLine = bot.col === p1.col || bot.row === p1.row
    const d = Math.abs(bot.col - p1.col) + Math.abs(bot.row - p1.row)
    if (inLine && d >= 1 && d <= p1.flame && g['canSurviveBomb'](p1)) out.bomb = true
  }
  if (out.bomb) return out
  // wander to the nearest powerup, else drift toward mid-map distance from bot
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

// --- measure the bot (p2) ---------------------------------------------
let idle = 0, idleBombLive = 0, moving = 0, movingBombLive = 0
let distSum = 0, distN = 0
let closing = 0, opening = 0, flat = 0
let bombs = 0, bombsNearPlayer = 0
let prevDist = -1
let farStreak = 0, farDumps = 0
const T = { 0: '.', 1: '#', 2: 'B' }
const DIST_BUCKETS = { close: 0, mid: 0, far: 0 } // <3, 3-6, >6
for (let t = 0; t < secs * 60; t++) {
  const p1 = g.players[0], p2 = g.players[1]
  const r1 = p1.alive ? playerThink(p1, p2) : { ...noop }
  const r2 = p2.alive ? g.aiThink(p2) : { ...noop }
  const nBombs = g.bombs.length
  g.update(1 / 60, { p1: { ...r1 }, p2: { ...r2 } })
  if (g.bombs.length > nBombs) {
    bombs++
    const nb = g.bombs[g.bombs.length - 1]
    if (nb.owner === 1) {
      const d = Math.abs(nb.col - p1.col) + Math.abs(nb.row - p1.row)
      if (d <= 4) bombsNearPlayer++
    }
  }
  if (!p2.alive || !p1.alive) continue
  const dist = Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y)
  const ownLive = g.bombs.some((b: any) => b.owner === 1)
  const isMoving = p2.movingDir !== null
  if (isMoving) { if (ownLive) movingBombLive++; else moving++ }
  else { if (ownLive) idleBombLive++; else idle++ }
  distSum += dist; distN++
  if (distN > 1) {
    if (dist < prevDist - 0.15) closing++
    else if (dist > prevDist + 0.15) opening++
    else flat++
  }
  prevDist = dist
  if (dist < 3) DIST_BUCKETS.close++
  else if (dist < 6) DIST_BUCKETS.mid++
  else DIST_BUCKETS.far++
  // far-seed diagnostic: if the bot stays >6 tiles for 30+ s straight, dump
  // what it is doing (target, path, box state, map) to catch the rare AFK run
  if (dist > 6) farStreak++; else farStreak = 0
  if (farStreak === 1800 && farDumps < 3) {
    farDumps++
    const st = g.aiState.get(1)
    const c = p2.col, r = p2.row
    let map = ''
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const b = g.bombs.some((bb: any) => bb.col === c + dc && bb.row === r + dr)
        map += T[g.tile(c + dc, r + dr)] + (b ? '*' : '') + ' '
      }
      map += '\n'
    }
    const nb = [...(st.noBricks ?? [])].map((k: number) => `${k % 15},${Math.floor(k / 15)}`).join(' ')
    const bs = g.bombs.map((b: any) => `(${b.col},${b.row})o${b.owner}`).join(' ')
    const direct = g['bfs'](p2.col, p2.row, p1.col, p1.row, true)
    console.log(`[far] t=${(t / 60).toFixed(0)}s bot=(${p2.x.toFixed(2)},${p2.y.toFixed(2)}) pl=(${p1.x.toFixed(2)},${p1.y.toFixed(2)}) d=${dist.toFixed(1)}`)
    console.log(`  map (bot center, * = bomb):\n${map}`)
    console.log(`  dir=${r2.dir} movingDir=${p2.movingDir} wallpassUntil=${(p2.wallpassUntil ?? 0).toFixed(1)} (now=${g.time.toFixed(1)})`)
    console.log(`  tgt=(${st.tc},${st.tr}) kind=${st.kind} stand=${st.standoff} detour=${st.detouring} detourBrick=${st.detourBrick !== undefined ? st.detourBrick % 15 + ',' + Math.floor(st.detourBrick / 15) : 'none'}`)
    console.log(`  path=${st.path.length} i=${st.i} noBricks=[${nb}]`)
    console.log(`  bombs: ${bs || 'none'}`)
    console.log(`  bfs bot->player (no avoid): ${direct ? direct.length + ' steps' : 'NONE'}`)
  }
}
const total = idle + moving
console.log(`— ${secs}s, bot (p2) vs live player (p1) —`)
console.log(`bot distance to player: avg=${(distSum / distN).toFixed(2)}  close(<3)=${DIST_BUCKETS.close}  mid(3-6)=${DIST_BUCKETS.mid}  far(>6)=${DIST_BUCKETS.far}`)
console.log(`bot motion: moving=${moving} idle=${idle}`)
console.log(`  while own bomb LIVE: moving=${movingBombLive} idle=${idleBombLive}  (idle%% of bomb-live=${(100 * idleBombLive / Math.max(1, idleBombLive + movingBombLive)).toFixed(0)}%)`)
const m = closing + opening + flat
console.log(`  vs player: closing=${closing} opening=${opening} flat=${flat}  (closing%%=${(100 * closing / Math.max(1, m)).toFixed(0)}%)`)
console.log(`bot bombs=${bombs}  within 4 tiles of player=${bombsNearPlayer}  (${(100 * bombsNearPlayer / Math.max(1, bombs)).toFixed(0)}%)`)
console.log(`kills: P1(human)=${g.players[0].kills} P2(bot)=${g.players[1].kills}`)
