// Campaign clear mechanism probe (AI-free): for N fresh levels,
//  1. assert the exit is under a brick (the generation invariant)
//  2. destroyBrick on the exit -> portal must reveal
//  3. place the player ON the exit tile -> after 0.6s the level must clear
// This proves the full "find brick -> break it -> stand on portal -> clear"
// chain works, independent of AI navigation speed.
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
const { T_SOFT } = await import('../src/constants.ts')

const N = Number(process.argv[2] ?? 60)
let underBrick = 0, revealed = 0, cleared = 0
for (let i = 0; i < N; i++) {
  const g: any = new Game('campaign')
  const p = g.players[0]
  if (g.grid[g.exit.row][g.exitCol ?? g.exit.col].t === T_SOFT) underBrick++
  // 2. break the exit brick -> portal reveals
  g.destroyBrick(g.exit.col, g.exit.row)
  if (g.exit.revealed) revealed++
  // 3. the exit only works once ALL enemies are dead — kill them, then stand
  //    on the portal for 0.7s -> level clears
  for (const e of g.enemies) e.alive = false
  p.col = g.exit.col; p.row = g.exit.row; p.x = g.exit.col; p.y = g.exit.row
  p.invincibleUntil = 100
  for (let t = 0; t < 45; t++) g.update(1 / 60, { p1: { dir: null, bomb: false, detonate: false } })
  if (g.state === 'levelclear') cleared++
}
console.log(`levels: ${N}`)
console.log(`exit under a brick:        ${underBrick}/${N}`)
console.log(`portal revealed on break:  ${revealed}/${N}`)
console.log(`level cleared on standing: ${cleared}/${N}`)
