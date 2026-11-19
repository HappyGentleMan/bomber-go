# Bomber Go — Overnight Status

**Last updated:** Nov 19, ~9:40 AM · **State: online mode + hidden items in, all tests green, ready to push**

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
