# BOMBER GO 💣

A modern browser remake of the classic Bomberman. **Zero external assets** — every sprite is drawn procedurally on canvas and every sound is synthesized with the Web Audio API.

Built with **Vite + TypeScript**. No game engine, no dependencies.

![screenshot](docs/screenshot.png)

## Play

```sh
npm install
npm run dev        # → http://localhost:5173
```

Production build:

```sh
npm run build      # outputs to dist/
npm run preview
```

## Features

- **Career mode** — endless procedurally generated levels. Blast every enemy, find the hidden exit, beat the clock.
- **Battle mode** — 1P vs AI or 2P local on one keyboard. Last bomber standing wins; sudden death when the timer expires.
- **Classic enemy roster, modern AI** — 8 enemy types: wanderers, axis-chasers, BFS pathfinders, wall-passing ghosts, flee/ambush bots.
- **11 power-ups** — bomb +, flame +, speed +, shrink bomb, shrink flame, shield, invincibility, wall pass, freeze (stuns enemies — or your opponent in battle), kick, extra life.
- **Chain reactions** — bombs detonate bombs. Multi-kill combos multiply your score (100 → 200 → 400 → 800…).
- **Per-level color themes** — 5 cycling palettes (navy, purple, green, crimson, ice) keep the campaign visually fresh.
- **Sudden death** — as the timer runs down the board starts eating itself, enemies speed up, and the music tempo rises.
- **Attract mode** — AI vs AI battle plays behind the title screen.
- **Procedural audio** — three chiptune tracks (menu, campaign, battle) and fully synthesized SFX. `M` mutes.
- **Juice** — particles, screen shake, score popups, spawn pop-ins, dust trails, glow, freeze/sudden-death effects.
- **Modern UI** — neon DOM menus, HUD, pause, high-score board with initials, settings.
- **Inputs** — keyboard, gamepad (2 pads for 2P), and on-screen touch controls on mobile.
- **PWA** — installable, works offline (service worker).
- **High scores** — stored in `localStorage`.

## Controls

| Action | Player 1 | Player 2 |
| --- | --- | --- |
| Move | `W A S D` / arrows | `I J K L` |
| Bomb | `Space` / `F` | `Enter` / `Numpad 0` |
| Detonate oldest bomb | `E` / `G` | `O` / `Numpad 1` |
| Pause | `P` / `Esc` | `P` / `Esc` |
| Mute | `M` | `M` |

## Project layout

```
src/
  constants.ts   tuning values, grid size, powerup defs
  types.ts       shared types
  level.ts       maze generation + connectivity guarantee
  game.ts        core engine: movement, bombs, AI, rules
  enemies.ts     enemy roster
  render.ts      procedural canvas renderer
  particles.ts   particle system
  audio.ts       WebAudio SFX + chiptune sequencer
  input.ts       keyboard / gamepad / touch input
  ui.ts          DOM overlay UI
  storage.ts     settings + high scores (localStorage)
  main.ts        bootstrap, app state machine, loop
test/smoke.ts    headless logic simulation (npx tsx test/smoke.ts)
public/sw.js     offline service worker
```

## Debug hooks

Append to the URL for deterministic testing:

- `?start=campaign` — jump straight into a career run
- `?start=battle&ai=1` — battle vs AI
- `?start=demo&steps=N` — AI plays career, pre-advanced N/60 s
- `?start=flame` — staged explosion, frozen at peak (render tests)
- `?start=clear&steps=120` — level-clear screen
- `?start=over&steps=120` — game-over / high-score entry screen
- `?start=pause` — paused game
- `&level=N` — jump campaign to level N (theme checks)
- `&steps=N` — pre-advance the simulation N/60 s (works with any start)

## Notes

- Movement is grid-locked with buffered turns, simulated at a fixed 60 Hz timestep.
- Maps guarantee that every power-up, the exit, and every enemy spawn is reachable.
- The game is deterministic per map seed except for enemy wander randomness.
- Rendering is performance-minded: floors are pre-rendered per theme and flame effects use pre-rendered sprites, so big multi-bomb explosions stay at 60 fps on modest hardware.
