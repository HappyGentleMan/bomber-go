# Bomber Go — Overnight Status

**Last updated:** Nov 19, ~12:40 PM · **State: continuous (free-space) movement in, all tests green, ready to push**

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

## Continuous free-space movement (this round, latest)

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

## One thing left for you: push to GitHub

Keychain auth can't be driven from this environment (the GUI prompt can't appear).
In a real Terminal:

```sh
zsh /Users/anson/.local/share/opencode/gh-setup.sh
```

That creates the `HappyGentleMan/bomber-go` repo and pushes (35 commits).
See `PUSH_TO_GITHUB.md` for details / manual steps.

## Play

- **Career** — WASD + Space, E to detonate
- **Battle** — P1 WASD+Space · P2 IJKL+Enter · gamepads work too
- Debug: `?start=campaign|battle|demo&steps=N`, `&level=N`, `&ai=1`
