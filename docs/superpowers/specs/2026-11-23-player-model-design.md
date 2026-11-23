# Player model redesign (short)

**Intent.** The player is currently a 32px blob (rounded square + white stripe +
two eyes). Research (classic Bomberman art, chibi design consensus): the face
is the character, big head + big eyes = expressiveness, structure comes from
helmet/plate/gloves, and movement needs squash & stretch. Goal: a chibi
neon character that reads clearly at 32px in battle, in the player's own color.

**Approaches considered.**
- Pixel-art sprite sheets: 192 frames for 8 colors × 4 dirs, muddy recolors,
  clashes with the vector aesthetic, licensing issues with third-party art.
- AI-generated art as in-game assets: can't produce clean 4-dir animated
  sheets with transparent bg.
- **Hand-drawn procedural redesign (chosen, user picked A)**: redraw in canvas
  code. All 8 swatch colors + online custom colors work instantly, crisp at
  any resolution, consistent with the rest of the game (everything is
  procedural), zero asset management.

**Design (32×32 sprite, centered, drawn area −16..16):**
- Head (chibi, ~60% of height): full dome in player color, y −15..4; white
  helmet cap over the top (y −15..−5) + white brim strip (y −5..−2); the
  exposed colored lower face holds the eyes. Antenna: white stem from the cap
  top, glowing player-color tip.
- Eyes (live, directional): radius 2.8 at ±5.5, look-offset up to 3.5px in the
  facing dir, white highlight, and a periodic blink (~every 3.4s, phase
  offset per player id) — eyes become a short closed line. (Mouth dropped:
  at 32px it reads as noise next to the eyes — big eyes carry the face.)
- Torso: rounded rect y 4..14, player-color gradient (lighter top → darker
  bottom), white belly-plate inset (0.18 alpha).
- Gloves: two white circles (±11.5, 8) drawn live, sway ±1px with the step
  cycle, shift slightly with facing.
- Feet: two rounded rects (±4.5, 13.5), alternating lift with the step phase.
- Walk: keep the existing bob, add squash & stretch — scale
  (1 + 0.04·sin, 1 − 0.04·sin) at the step frequency; idle keeps a gentle
  breathing bob.
- Shield ring / invincible aura / wallpass ghost / spawn blink: unchanged.

**Implementation notes.**
- Static parts (dome, cap, brim, antenna, torso, plate, mouth) go into the
  existing per-color `getPlayerBody` cache (2× SS res, one canvas per color).
- Dynamic parts (eyes, blink, gloves, feet, squash) draw live in
  `drawPlayer`.
- `src/render.ts` only. No game logic, no netcode, no protocol change —
  colors already flow through snapshots.

**Non-goals.** Multiple selectable character models (future cosmetics
feature), per-player names, 4-direction sprite variants (direction is
expressed via eye/glove shift, as today).

**Verification.** tsc + audit + smoke (no logic touched), then browser
screenshots: battle (both colors, moving + idle) and campaign; check the
sprite at 2× DPR and in the online HUD.
