# Character select design (short)

**Intent.** Players pick a character model, not just a color. 4 procedural
characters, all tinted by the existing 8-neon palette (32 combos), saved per
device, and followed into online matches (opponent sees your character).

**Approaches considered.**
- Image/sprite-sheet characters: asset management, recolor problems, licensing,
  clashes with the vector aesthetic. Rejected.
- **Procedural variants (chosen, user approved the 4 designs in
  conversation)**: each character is canvas code sharing the existing base
  (torso + plate + head dome), differing in head treatment + a few live parts.
  All colors work, crisp at any res, zero assets.

**Characters (ids in `CHARACTERS`):**
- `bomber` — current: white cap + brim + badge, eyes/gloves/feet, walk cycle.
- `kitty` — no cap (full colored dome), two pointy ears (inner = darker shade),
  cheek blush dots; eyes/gloves/feet like bomber.
- `knight` — full white helmet, dark visor band, glowing eye slits in player
  color (live, directional + blink), feather plume behind the head.
- `ghost` — round blob with wavy bottom, no gloves/feet/torso, floats (deeper
  sine, no walk squash/dust-step feel), same eyes.

**Mechanics:**
- `settings.character` (default `'bomber'`) in storage.
- `PlayerState.char`; `Game.playerChars: [string, string]`; constructor opt
  `p1Char`. P2 default `'bomber'` (no collision logic needed — shapes differ).
- Netcode: `hello` carries `{ c, ch }`; host applies to player 1 (live +
  respawn). Snapshot carries `char` per player (index 15, fallback
  `'bomber'` = back-compat).
- Settings screen: CHARACTER row with 4 mini canvas previews, tinted with the
  currently selected color (re-tint when color changes). Click = select +
  persist + live in-game preview (title demo / in-match P1), same pattern as
  color swatches (`ui.onCharChange`).
- Rendering refactor: static body becomes a pure `drawCharBody(ctx, char,
  color)` used by both the Renderer's per-(char,color) cache and the settings
  previews. Live parts (eyes/slits, gloves, feet, squash) branch on char in
  `drawPlayer`.

**Non-goals.** More than 4 characters, character-specific abilities, names,
per-character trails.

**Files.** `src/constants.ts`, `src/types.ts`, `src/storage.ts`, `src/game.ts`,
`src/net.ts`, `src/netgame.ts`, `src/render.ts`, `src/ui.ts`, `src/main.ts`,
`index.html`, `test/audit.ts` (RED first).
