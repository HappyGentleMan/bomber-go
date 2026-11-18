# Bomber Go — Overnight Status

**Last updated:** Nov 19, ~2 AM · **State: complete, all tests green, ready to push**

## What got done overnight

Built the whole game from scratch (zero external assets — every sprite is procedural
canvas, every sound is a WebAudio synth):

- **Engine** — Vite + TypeScript, pure canvas, fixed 60 Hz timestep, 15×13 grid.
  Pre-rendered sprites for performance.
- **3 modes** — Career (12+ levels, 5 cycling color themes), Battle (1P vs AI or
  2P local), Attract (AI vs AI plays behind the title screen).
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
  round pips in the HUD (●○), round-win banners, match stats on the battle-over
  screen (ROUNDS 2 — 1 · KILLS 3 — 2), CPU label in 1P vs AI matches

Battle bots now fight and finish matches (10-min soak: 4 full matches, no crashes).

## Verify (all passing as of last run)

```sh
cd "/Users/anson/Documents/Bomber Go"
npx tsx test/smoke.ts     # headless logic suite
npx tsx test/qa-long.ts   # 5-min stability + 12-level run
npx tsx test/soak.ts      # 10-min soak
npm run build             # production build
npm run preview -- --port 4173   # then open http://localhost:4173
```

## One thing left for you: push to GitHub

Keychain auth can't be driven from this environment (the GUI prompt can't appear).
In a real Terminal:

```sh
zsh /Users/anson/.local/share/opencode/gh-setup.sh
```

That creates the `HappyGentleMan/bomber-go` repo and pushes (19 commits).
See `PUSH_TO_GITHUB.md` for details / manual steps.

## Play

- **Career** — WASD + Space, E to detonate
- **Battle** — P1 WASD+Space · P2 IJKL+Enter · gamepads work too
- Debug: `?start=campaign|battle|demo&steps=N`, `&level=N`, `&ai=1`
