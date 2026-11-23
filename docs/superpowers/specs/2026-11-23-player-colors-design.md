# Player color / avatar design (short)

**Intent.** Players pick their own neon color; it follows them everywhere —
campaign, 2P local (P1), and online matches (each side uses its own device's
color). Research: every modern remake ships player customization; it's the
cheapest "is this my character?" win and fixes "which one is my friend?" in
battles.

**Approaches considered.**
- Free color picker (input[type=color]): any color, but washed-out picks look
  bad on the dark bg and break the neon aesthetic. Rejected.
- **Fixed neon swatches (chosen)**: 8 hand-picked colors that all pop on
  `#0a0e1a`; zero contrast risk.

**Design (builder calls, stated):**
- Palette (8): `#00e5ff` cyan (default), `#ff2e88` pink, `#ffd54a` gold,
  `#7dff5e` lime, `#b388ff` purple, `#ff9840` orange, `#4aa8ff` blue,
  `#5effd0` mint.
- Chosen on the SETTINGS screen ("COLOR" row of swatches), persisted via the
  existing `storage.ts` (`settings.color`, default `#00e5ff`).
- Applies to: player body (sprite cache is already per-color), bomb owner
  ring (made dynamic from player color), death/kill bursts (already dynamic),
  HUD battle chips (made dynamic), and a new subtle movement trail in the
  player's color.
- P2 is fixed to pink in v1 (one color per device), with collision avoidance:
  if P1 chose pink, P2 becomes gold (`otherColor()` helper) — local and online.
- Netcode:
  - new `hello` message, client → host on connect: `{ t:'hello', c: <hex> }`
  - host applies it to player 1 (live + on respawn via `playerColors`)
  - snapshot carries each player's `color` so the client renders the host's
    color; apply falls back to the slot default (back-compat)

**Non-goals.** P2 color selection, names/nicknames, trails as a separate
setting, cosmetic packs.

**Files.** `src/storage.ts` (settings.color), `src/game.ts`
(`playerColors`, makePlayer), `src/net.ts` (hello msg), `src/netgame.ts`
(snapshot color), `src/main.ts` (settings wiring, HUD chips, online
hello/apply), `src/ui.ts` + `index.html` (swatch row + CSS), `src/render.ts`
(bomb ring, trail), `test/audit.ts` (RED first).
