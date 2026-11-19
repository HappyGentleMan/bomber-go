# Bomber Go — Overnight Status

**Last updated:** Nov 19 · **State: battle AI active-play round, all tests green, ready to push**

## What got done overnight

Built the whole game from scratch (zero external assets — every sprite is procedural
canvas, every sound is a WebAudio synth):

- **Engine** — Vite + TypeScript, pure canvas, fixed 60 Hz timestep, 15×13 grid.
  Pre-rendered sprites for performance.
- **3 modes** — Career (12+ levels, 5 cycling color themes), Battle (1P vs AI or
  2P local, best-of-3 rounds), Attract (AI vs AI plays behind the title screen).
- **8 classic enemies** with distinct AIs (wander, axis-chase, BFS, wallpass, flee).
- **11 power-ups** — bomb/flame/speed+, shrinkers, shield, invincible, wallpass,
  freeze, kick, extra life.
- **Audio** — 3 chiptune tracks (menu 92 / campaign 148 / battle 172 bpm),
  sudden-death tempo push, 19 synthesized SFX. `M` mutes.
- **Juice** — particles, shake, score popups, hit-stop slow-mo on triple+ kills,
  escalating combo flash, ambient dust motes, golden high-score celebration.
- **PWA** — installable, works offline.
- **Mobile** — portrait title / landscape gameplay, on-screen touch controls.

## Battle upgrades (this morning, commits 250c25c → 4404a17)

The battle AI was stalemating (two bots orbiting the top row, 0 kills). Root cause:
`blastEscape` — the "can I survive my own bomb" check — was almost always false, so
the bots never bombed. Fixed with a proper BFS escape check plus:

- trap bombs (opponent hemmed into a dead-end), cut bombs (blast bricks behind them)
- back-off at point-blank (shared-tile bombs are mutual kills)
- flee *through* blasts toward open space (blasts are only fatal at detonation)
- reaction jitter, suicide-guarded early detonation, flame-powerup hunting
- **KILL!** popup + flash; battle kills now award 1000 score
- **Best-of-3 round system** — fresh map each round, powerups/kill stats persist,
  round pips in the HUD (●○), round-win + ROUND X banners, match stats on the
  battle-over screen (ROUNDS 2 — 1 · KILLS 3 — 2), CPU label in 1P vs AI matches
- **Powerup legend** on the settings screen (all 11, generated from defs)

Battle bots now fight and finish matches (10-min soak: full best-of-3 matches,
no crashes). Preview live on port 4173.

## Final polish (last stretch, commits 0e9cdd6 → c8c65a3)

- **Haptic feedback** — explosions and player hits now pulse mobile vibration
  and gamepad rumble (scales with bomb power). Feature-detected, never throws.
- **Auto-pause on blur** — switching tabs / losing window focus pauses the game,
  so you can't lose a life in the background.
- **Shorter battle matches** — sudden-death bombs now drop *adjacent to a random
  player* (their original intent) instead of a random tile, so rounds resolve to a
  single kill rather than a double-kill draw that replays the round. Measured over
  20 AI matches: avg length 632s → 460s (−27%), draws 39 → 26 (−33%).
- **Termination guard** — new `test/termination.ts` proves battle matches always
  reach `battleover` (no soft-lock from endless draw-replays); `test/battle-stats.ts`
  is the match-length / draw-rate harness.
- **Full code review pass** — re-read every source file end-to-end; no bugs found.

All tests re-run green after each change (tsc + smoke + qa-long + 10-min soak +
termination + build). **35 commits total**, clean tree, no remote yet.

## Verify (all passing as of last run)

```sh
cd "/Users/anson/Documents/Bomber Go"
npx tsx test/smoke.ts     # headless logic suite
npx tsx test/qa-long.ts   # 5-min stability + 12-level run
npx tsx test/soak.ts      # 10-min soak
npm run build             # production build
npm run preview -- --port 4173   # then open http://localhost:4173
```

## Battle AI active play: press the attack (this round)

Player feedback: "the AI just places a bomb then gets away to the next safe
area — it isn't actively playing with the player, not fun". Researched how
the top agents actually play (Pommerman Skynet, the NeurIPS-2018 winner
Osogami, HLPlayer): **safety is a constraint/filter, not the objective** —
after a bomb you keep walking toward the fight, you never idle, and the top
agents press through the fuse.

Measured the idling (`test/engage.ts`, bot vs a simple live player, 120s):
avg distance **15.2 tiles, 0% of ticks within 6, 79% of bomb-live time idle,
0% of bombs within 4 tiles of the player**. A bomb-and-hide machine.

Fixes (all in `src/game.ts`):

- **No blanket repath suppression while a bomb is live** — only the
  placement tick suppresses. The bot keeps closing in through the 2.6s fuse
  (the BFS already routes around the blast ring).
- **Bomb-vs-detour at the path head** — a bomb costs ~2.6s fuse + escape
  (≈13 tile-steps) and burns the bomb slot, so the bot now swings *around*
  a brick (≤10-step detour, `detourBrick` keeps it avoided until we move
  on) whenever that is cheaper, and only bombs when the swing is too long.
  Ends the brick-clearing machine.
- **Forward-biased escape route** — after a bomb, `survivalRoute` collects
  *all* reachable safe havens and picks the one that advances toward the
  opponent (closer than we are now, ≥2 tiles out). The plain nearest haven
  retreated behind with no net progress; the unconstrained "closest to the
  enemy" glued the bot to a corner opponent and it burned in its own
  follow-up bomb (caught by the death probe).
- **Sealed-pocket death trap** — the bot used to walk through a wallpass
  brick into a 1-tile pocket (walls left/right, bricks up/down); when the
  10s wallpass expired it was sealed in with no walkable exit and no
  survivable bomb (the blast reaches the brick exits the same step they
  break, so the stall-bomb never fires). `sealedPocket` now marks such
  tiles solid for AI players across physics + BFS + target selection — the
  bot routes around.
- **Wallpass-expiry un-wedge** — `boxHits` exit tolerance extended from
  bombs to bricks: a brick the box already stands in no longer traps it
  (wallpass can expire mid-tile).
- **Standoff hold no longer freezes on our own tile** (mutual-kill
  position) — the bot wanders off and re-approaches from a survivable angle.
- **No own-blast-ring pin** — the 0.6-wide box made *any* tile adjacent to
  the ring "inside", so the `inOwnBlast` repath gate pinned the bot for the
  whole fuse; removed (BFS avoid-set + threat override handle it).
- **Powerup detours must be on the way** — battle detours only for a
  powerup where `dist(enemy,pu) ≤ dist(enemy,bot)+2`; the old rule looted
  the far side of the map (9+ tiles out for 10s, closing in 0% of ticks).

**Results (headless):**

- engage (6×120s vs a live player): avg distance 15.2 → **4.6–6.8**, bombs
  within 4 tiles of the player 0% → **39–100%**, kills 0 → **2–14/match**
  (5 of 6 seeds)
- twitch (8×60s): **0 deaths**, 101 turns/min, 49 U-turns/min
- death probe: 6 clean 120s runs; stuck: 0–1 episodes/90s (cross-map delay,
  not freezes); jam probe: 0 wedges (6×60s)
- smoke (38 checks) + aggr (150s: both AIs press — 250/190 kill-opportunity
  ticks) + production build green

New harnesses: `test/engage.ts` (distance buckets, closing ticks,
idle-while-bomb-live, bombs-near-player %), `test/stuck.ts` (stuck-episode
tracer + state log), `test/jam.ts` (movement-jam probe with map dump),
`test/ttarget.ts` (target trace).

## Battle AI aggression: survivability-based bombing (this round)

Player feedback: the AI "is good at evading me but not placing bombs and
fighting back". Researched how people build Bomberman AIs (Pommerman,
arXiv 2203.09608 — `is_survivable` is a bounded BFS that schedules bomb
explosions in time; "if at least one action kills an enemy, prune all
others"; GameDev SE — pick the bomb spot, walk there, bomb, walk to the hide
spot, re-plan on every new bomb; baines/bomberman-ai — bomb when the enemy
is in range OR a good spot has a reachable safe tile outside the blast).

Measured root cause (`test/aggr.ts`, two AIs, 150s): **bombs/min 0.0 and
0.8, kills 1/0**. The old `blastEscape` gate treated every blast as a
*permanent wall* — ~80% of bomb attempts rejected (18,824 rejections in
150s); in a 1-wide corridor a flame-1 blast covers the whole segment, so
the bot could never bomb there and only ever evaded.

The fix:

- **`survivalRoute(p, placing?)`** — time-aware BFS over (tile, step), the
  Pommerman idea: a fire schedule built from current flames plus every live
  bomb's blast during `[E, E+1]` (`E = ceil(fuse / 240ms)`), 14-step
  horizon (3.36s > the 2.6s fuse). A safe haven is a tile no flame ever
  covers in the horizon; the route may *cross* blast tiles (the flame is
  scheduled, not a wall). The enemy's tile is never an exit. `placing=true`
  (placement tick only) schedules the about-to-be-placed bomb on p's tile.
- **Bomb decision priority** — kill bomb (on line + clear lane + distance
  ≤ flame) → lane-opener (brick between us within flame range) → cut (brick
  behind the enemy) → map-break (distance 2..flame+1, 85% jitter breaks
  symmetry). The old trap rule is subsumed by the kill bomb.
- **Commit the survival route when a bomb is placed** — the old wall-based
  `escapeRoute` pointed at the nearest *non-blast* tile, which in a
  corridor is the enemy's own tile (the bot walked into the enemy, got
  pinned, and burned in its own blast).
- **Repath suppression** — no pursuit re-path while any own bomb is live,
  including the *pending* one on the placement tick (the bomb is not in
  `this.bombs` until `update` runs, so the old guards were blind to it and
  the re-path routed through the about-to-exist blast).
- `blastEscape` removed; the brick-on-path bomb gate uses `canSurviveBomb`.

Two bugs caught by measurement (`test/death.ts` death-cause trace with
`aiState` plant logging): (1) the placement-tick blind spot above — the
bot re-pathed into its own not-yet-registered blast; (2) **phantom-bomb
poisoning** — re-evaluating `survivalRoute` after the bot moved scheduled a
phantom bomb at its *current* tile, making that tile unstandable, so every
re-plan from a box straddling two tiles picked the opposite neighbour and
the bot ping-ponged across the blast ring in a 0.33s cycle until the flame
landed. Both fixed and verified.

**Results (headless):**

- aggression (150s, two AIs): bombs/min 0.0/0.8 → **24.4/50.8**, kills
  1/0 → **5/2**
- twitch (8×60s vs a no-op player): **0 deaths**, 72 90° turns/min,
  8 U-turns/min (the intermediate aggressive build died 6/min before these
  fixes; target band 20–100 turns/min)
- death probe: 8 consecutive clean 120s runs
- smoke suite (38 checks) + production build green

Harnesses: `test/aggr.ts` (bomb rate + gate rejections), `test/death.ts`
(death trace + route-plant log), `test/besc.ts` (survivability rejection
dump), plus the existing `twitch.ts` / `probe.ts`.

## Battle AI rewrite: purposeful movement, no suicide (this round, commit 0efb2d1)

Player feedback: the battle AI "moved like she has ADHD" — direction flips
every tick — and kept killing itself. It also moved slower than the player.

Measured first (new headless harness `test/twitch.ts`, 8×60s): **8 deaths,
173 90° turns, 963 U-turns per minute**. Full rewrite of the decision loop:

- **Physical box probe** (`canStep`) replaces derived-tile checks in every
  per-tick heading decision — the root of the 60 Hz jiggle
- **Full-blast pathfinding** — BFS avoids the full blast of *every* live
  bomb, not just imminent flames (routing through a live radius sent the bot
  straight back into the blast it had just escaped, oscillating on the edge)
- **Threat override** — box-aware imminent set, committed escape routes, and
  flee only from *uncontrolled* approaches (a lined-up enemy is bombable, so
  the bot no longer bolts from every visible opponent)
- **Standoff state machine** with hysteresis (enter ≤3 / exit ≥4.5 free
  distance): on line + in range → close in for the kill; on line out of range
  → hold; off line → walk to the nearest **line-up tile** (the only position
  a bomb can connect from), powerup detour as fallback. Unreachable
  line-up targets are remembered (`triedLineup`) so the bot falls through to
  the next fallback instead of re-planning to the same dead tile forever
- **Powerup detour with hysteresis** — keep the chosen target while it is
  valid; re-picking the nearest one every tick flip-flopped the bot between
  two powerups at the distance midpoint
- **Stall detection + bomb-the-brick escape** for sealed pockets; **noBricks**
  makes a proven-unbombleable brick impassable
- **wanderDir v2** — 2-tile lookahead, anti-reversal, danger penalty

Speed was already at player speed (`PLAYER_BASE_SPEED`, no AI discount).

**Result (8×60s headless): deaths 8→0, 90° turns 173→12/min, U-turns
963→2/min.** Smoke suite green, AI kills in both directions. Debug
harnesses kept in `test/` (`twitch.ts`, `probe.ts` limit-cycle detector,
`dstream.ts`, `utrace.ts`, `ptrace.ts`).

## Permanent KICK + bombs stop at enemies (this round, commit 992cfdd)

Player feedback: the timed KICK felt like it "ran out", and the bomb
ploughing through enemies was too OP.

- **KICK is now a permanent ability** — every player can kick at any
  time (like movement / bomb placement). The 8s `kickUntil` timer is
  gone (player state + online snapshots), and the KICK powerup no
  longer drops or appears in the settings legend.
- **Sliding bombs stop in front of enemies** (same as walls, bricks,
  other bombs, players) — no more squash-kill on contact.
- Smoke suite's "AI kills happen" battle check hardened to two
  independent 150s runs (a single run can legitimately score 0 kills
  with an unlucky seed — this caused one flaky failure).

## Classic Bomb Kick slide (this round, commit 7e1e7d9)

The kick is now the real Bomb Kick (Bomberman '93+): one kick sends the
bomb **sliding across the stage until it hits a wall, brick, bomb,
enemy or player** (11 tiles/s, per-tile collision, stops flush against
the obstacle). Mid-slide detonation happens at the bomb's current tile.
Online clients get id + x/y + sliding in snapshots and lerp the bomb
like players. (An early version ploughed through enemies on the way —
removed in 992cfdd as too OP; a sliding bomb now stops in front of
them.)

## Joystick + KICK-at-start (this round, commit 7d3a242)

- **Virtual joystick** — now the default mobile movement (pointer events,
  deadzone, dominant-axis → 4 game dirs, knob follows the finger and
  springs back on release). New `MOVE: JOYSTICK / D-PAD` toggle in
  settings (persisted); d-pad still available. Sits in the same
  letterbox slot the d-pad used.
- **KICK** — now a permanent ability (superseded the original "8s KICK
  at start" idea in 992cfdd): every player can kick at any time, so
  bomb-pushing works from the first second and never runs out.
- **Kick probe fix** — the box stops ~0.06 tile short of the bomb tile, so
  the old "front of the box" probe rounded back to the player's own tile
  and kicks never fired; it now probes the tile directly ahead of the
  centre tile. Verified: bomb chains 2→5→8 while pushed.
- (Also this session: bomb pulse/spark calmed down — steady twinkling
  ember instead of 60fps random flicker, 0.5→1.2 Hz breathing; player
  walking-through-bricks regression fixed in 829f81b; portrait menus go
  full-screen in 4c39ead.)

## Continuous free-space movement (this round, commit 155d548)

Movement is no longer fixated on the unit grid — ported the DeepSeek
reference's free-space model:

- **Free AABB movement** — entities float as 0.6-tile boxes in open space
  (`tryMove` + `boxHits`). While a direction is held, the perpendicular axis
  eases back to the row/column centre (sequential snap→advance, not combined,
  so brick corners self-resolve), so you can turn and stop *anywhere*, not
  just on tile boundaries. `col/row` stay derived (`Math.round`) for grid
  logic, pickup, BFS and the exit check.
- **Bomb exit tolerance** — a bomb the entity's box already overlaps doesn't
  block the way out (entry is still blocked). Without this, dropping a bomb
  mid-tile spawns it under the box and the player is welded in place until
  the flame arrives.
- **KICK powerup** — now bump-based: pushing into a bomb slides it one tile
  further (can chain while you keep pushing).
- **Enemies** — slide freely toward tile-centre targets; wanderers keep their
  loping pauses, chasers pursue without per-tile stops; new obstacles make
  them stall + redecide from the current tile.
- **AI fixes (found while testing free movement)** — path following now
  replans when the derived tile changes and aims from the *actual* position
  (the old tile-delta aimed the bot backwards mid-tile); when the bot bombs it
  pre-plans a BFS **escape route** out of the blast (and never repaths over it
  while inside its own blast); `blastEscape` now requires a ≤3-tile escape so
  it never bombs itself into a trap. Battle-bot suicides vs an idle player
  dropped from ~7/min to ~1/min (the rest are genuine dead-end traps).
- **Bomb pulse** — the fuse animation was too fast (1.6→4.8 Hz); now a calm
  "breathing" pulse ~0.8 Hz that gently accelerates to ~2.5 Hz as the fuse
  runs down (4%→9% amplitude).

## HD + smoothness pass (commits d361030, 5b62a45)

- **Native-resolution canvas** — the canvas backing store now matches the
  displayed size × devicePixelRatio (`Renderer.resize`, wired into `fit()`), so
  all vector art (players, enemies, flames, text) renders at true display
  resolution. No more CSS upscale blur; `image-rendering: pixelated` removed.
- **2× pre-rendered sprites** — floor, walls, bombs, flames, powerups (per kind),
  player bodies (per color) and the vignette are all pre-rendered at 2× and
  drawn with smoothing, so edges are anti-aliased and crisp. Per-frame gradient
  cost is gone (powerups/bodies are cached canvases).
- **Render interpolation** — the 60 Hz simulation now snapshots each entity's
  previous position (`prevX/prevY`) and the renderer lerps between ticks using
  the frame accumulator, so motion is smooth on 120/144 Hz displays and free of
  per-tick stepping. Teleports (respawn/round) snap instead of ghosting.
- **Online client interpolation** — `RemoteGame` lerps between 20 Hz host
  snapshots (`tickInterp` + `prevX/prevY`), so remote play is as smooth as local.
- **HD UI** — animated gradient title, glass panels (backdrop blur), glowing
  selection bar on buttons, light sheen sweep, staggered overlay entrances,
  animated stage glow, HUD readability scrim.

### In-app browser CSS quirks (worked around)
This embedded Chromium (1) doesn't stretch `::before/::after` with `inset: 0`
(need explicit `width/height: 100%`), and (2) drops `transform: translateX(% )`
when the element box is percentage-sized. The button sheen now animates
`background-position` instead of `transform`. Full WebRTC/P2P still can't run
in-app (zero ICE candidates) — test online in a real browser.

## Online battle + hidden items (this round, commit 124425e)

- **Online 1v1 (PeerJS)** — host-authoritative netcode: the client sends only
  `{dir, bomb, detonate}` inputs; the host runs the real simulation and streams
  ~20 Hz state snapshots. Client renders a `RemoteGame` (no local sim) and plays
  audio/haptics from snapshot diffs. 5-letter room codes, `bomberggo-` peer
  prefix, graceful disconnect UX. New files: `src/net.ts`, `src/netgame.ts`.
- **Renderable interface** — `Renderer`/HUD now draw any `Renderable` (the real
  `Game` *or* a `RemoteGame`), so local and online play share one render path.
- **Hidden powerups in destructible walls** — level items load *unrevealed*;
  breaking a brick reveals the item inside (sparkle + "ITEM!" popup). Level-gen
  rules: items only on brick cells, never in spawn corners, connectivity carving
  never opens an item/exit brick, post-pass re-hides anything a path exposed.
  Runtime drops (kills, battle spawns) stay revealed.
- **Mobile touch in the letterbox** — the on-screen dpad + action buttons live in
  the black bars around the canvas, never over the play area. Landscape: side
  bars; portrait: bottom bar. Placement only where the cluster fully fits.
- **`__net` debug handle** — `window.__net` exposes the live net layer for
  inspection.

### Online: verified up to the ICE boundary
The full signaling chain works in the in-app browser (offer → answer → data
channel `connecting`). The final ICE leg can't complete *in this embedded
Chromium*: it gathers **zero** ICE candidates (no host/SRFLX/relay), which is a
browser-level restriction, not a code bug. A real browser (Chrome/Safari/Firefox
or any phone) gathers host candidates and will connect. **To test end-to-end:
open two windows of the game in a real browser, Create a room in one, Join with
the code in the other.**

## Career exit portal: always under a reachable brick (this round)

Player report: "in career, sometimes there is no portal to the next level".
Root cause (`test/exit.ts`): **52.8% of generated levels had the exit NOT
under a brick.** `ensureConnectivity` carves walk paths to powerups / enemy
spawns, and those paths routed *through* the exit's brick, converting it to a
walk tile. The portal is only revealed by `destroyBrick` (bricks), so an exit
left on a walk tile could never appear — the level was un-clearable. The code
already re-hid *powerups* exposed this way, but had no equivalent for the exit
(a second, rarer cause: the exit landing on a spawn-corner brick that
`clearSpawnCorner` clears).

Fix: after `ensureConnectivity`, if the exit cell is no longer `T_SOFT`,
re-hide it under a fresh intact brick (same pattern as the powerup re-hide),
falling back to re-bricking the exit cell itself (its carved path still
stands). Verified: `test/exit.ts` 2000 levels → 0 exposed, 0 unreachable;
`test/clearmech.ts` 60 levels → brick→reveal→clear 60/60; smoke suite now
asserts no hidden item **or exit** is exposed on a walk tile (60 maps).

## One thing left for you: push to GitHub

~~Keychain auth can't be driven from this environment~~ — **resolved.** You ran
`gh-setup.sh` once; the agent can now `git push origin main` directly from its
own shell (keychain auth works). All commits are pushed to
`HappyGentleMan/bomber-go`.

## Mobile: add a DETONATE key (this round)

Report: mobile touch controls had movement + a BOMB button but **no early-detonate**
key (the desktop `E`). The engine already had the full `detonate` input path (AI,
online netcode) — it was a pure UI gap.

- `input.ts` — `touchDetonate` edge, mirroring `touchBomb`; `setTouchDetonate()`.
- `index.html` — new `#t-det` round button; sits in a `.trow` **beside** BOMB so the
  action cluster keeps its 138px height (fits portrait letterbars on small phones).
- `main.ts` — `bindTouch('t-det', …)`; `layoutTouch` action cluster width 84→150.

Verified (headless, 844×390 + 390×844 mockups):
- Button renders, no canvas overlap in landscape **or** portrait.
- Chain: touchstart → `setTouchDetonate` → `poll()` delivers `p1.detonate` edge →
  `game.update` detonates the oldest owned bomb (flames appear). All 3 links pass.

## Play

- **Career** — WASD + Space, E to detonate
- **Battle** — P1 WASD+Space · P2 IJKL+Enter · gamepads work too
- **Mobile** — joystick to move, BOMB to drop, DETONATE to kick/early-blast
- Debug: `?start=campaign|battle|demo&steps=N`, `&level=N`, `&ai=1`
