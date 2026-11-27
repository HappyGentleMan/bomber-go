# Bomber Go — Product-Grade Polish (Mobile-First) Design

Date: 2026-11-27
Status: approved by delegation — Anson said "you pick"; decisions below are my calls.

## Intent / Why
The game works but reads as a side project. Anson wants it to feel like a shipped
product, with first-class mobile UI and controls. The fixed-position joystick is the
specific pain point he raised ("now joystick not seems to be the best?").

## Goals
- Mobile controls that feel modern and precise: floating joystick (default) + floating D-pad (option).
- Cohesive product-grade UI: design tokens, real SVG icons, thumb-reachable menus, haptics, smooth transitions, proper empty/loading/error states.
- More detailed, expressive procedural characters: distinct silhouettes, real leg walk-cycle, directional lean, idle life.
- A full debug pass leaving the game bug-free.

## Non-goals
- No external image/audio assets — zero-asset procedural art is a core feature.
- No change to netcode core (absolute snapshots + seq stale-drop, interpolation/extrapolation cap — verified correct).
- No revert of instant bomb drop-in spawn (mandatory, earlier revert still in force).
- No new game modes or mechanics.

## Anti-goals (failure even if it technically works)
- Controls that require looking at the thumb or landing precisely on a fixed target.
- UI that covers the play field, or traps menus inside the short portrait canvas strip.
- Any level-transition hitch regression (the prewarmLevel fix must hold).
- Gate going red: `npx tsc --noEmit && npx tsx test/audit.ts && npx tsx test/smoke.ts`.

## Constraints
- TypeScript + Vite + canvas 2D; procedural art + WebAudio synth.
- Mobile letterbox layout: slim HUD bar ABOVE canvas; touch clusters live in the black letterbox; 15:13 field always fully visible (no camera); iPhone safe-area insets via env() vars.
- OpenCode in-app Chromium v152 quirks: `translateX(%)` dropped on %-sized boxes (animate background-position instead); pseudo-element `inset:0` does not stretch (use explicit width/height 100% + left/top 0).
- Visual checks use the in-app browser (tools.browser.*), per Anson's preference — not headless Chrome.
- Deploy: `npm run deploy` (typecheck-gated, atomic, no Caddy reload).

## Approaches
### Controls (the fork Anson raised)
- **A. Floating joystick** — base spawns where the thumb first touches in the move zone; drag steers; hard snap to 4 directions with a lit direction indicator; release = stop. **PICKED as default.** Modern product feel (Brawl Stars pattern); thumb never hunts for a target; keeps hold-to-move precision.
- B. Swipe/flick to move — dropped: fights the twitch-dodge core loop, stopping is awkward.
- **C. Floating D-pad** — 4-way pad appears under the thumb, press-and-hold a direction. **PICKED as a settings toggle** for pure-grid precision players.
### Characters
- **Procedural higher-detail redraw** — PICKED. Keeps zero-asset identity, tiny bundle, offline.
- Sprite-sheet image assets — rejected: breaks zero-asset identity, adds weight.
### UI
- **Design-token system + inline SVG icons + mobile bottom-sheet menus** — PICKED.
- Framework rewrite (React etc.) — rejected: overkill, bundle cost, loses the lean identity.

## Decided parts
- Default move = floating joystick; settings toggle switches to floating D-pad. Both spawn under the thumb in the move zone; release = stop.
- 4-direction snap with a lit direction indicator (dominant axis, deadzone).
- Haptics via `navigator.vibrate` on bomb / detonate / menu confirm (feature-guarded, no-op where unsupported).
- Characters: the existing 5 (classic/bomber/kitty/knight/ghost) redrawn at higher detail + 2-frame leg walk-cycle + directional lean + idle breathing. Still pre-rendered body cache per char+color.
- Icons: inline SVG for move arrows / bomb / detonate / pause / settings / nav, replacing text glyphs (▲◀▼▶, II).

## Left to the builder
- Exact token values, icon path data, sprite geometry, animation timing.
- Task breakdown and phasing (see the plan).

## Phasing
1. Debug pass — parallel read-only review subagent + my own in-app browser playtest (incl. the bomb-animation report); verified fixes applied by me.
2. Mobile controls (A + C).
3. UI design system + product polish.
4. Character model upgrade.
5. Verification (gate + browser playtest) + deploy.