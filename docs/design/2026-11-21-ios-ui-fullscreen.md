# iOS UI: full-screen game view, unblocked HUD, roomy controls

Date: 2026-11-21 · Status: proposed

## Problem (from user, playing on iPhone portrait)

1. The top HUD (score / lives / timer) is an overlay **on top of the game field** — it blocks the top rows of the play area.
2. In portrait the canvas fits to screen width only → the game is a strip and most of the screen is blank black.
3. Touch controls are cramped (54px buttons, 128px joystick).
4. The joystick + buttons show in **every** screen, including all menus.

## Constraints (user decisions)

- Whole field must always be visible → **no camera / no cropping**.
- Both portrait and landscape must work well.
- HUD must be moved **out** of the play area.

## Design

### 1. HUD moves outside the canvas
- `#hud` moves out of `#stage` into a slim full-width bar **above** the canvas
  (`#app` becomes a flex column: HUD bar → stage area).
- HUD is visible only while actively playing (`appState === 'playing'`).
- `fit()` reserves the HUD bar's height, so the canvas takes every pixel that's left
  → canvas is as large as possible with nothing covering the field.

### 2. Maximize the canvas (both orientations, whole field visible)
- Aspect ratio stays 15:13 (720×624 logical), no camera.
- Portrait: canvas = full screen width (tiles ≈ 26px), canvas sits under the HUD,
  leftover space below is used by the control bar.
- Landscape: canvas fills the leftover height; side letterbox bars host the controls.
- Reduce padding (8px → 4px) and account for iPhone safe areas
  (`viewport-fit=cover`, `env(safe-area-inset-*)`) so the Dynamic Island /
  home indicator never eat the HUD or the buttons.

### 3. Bigger, roomier controls (still in the letterbox — never over the field)
- Joystick base 128 → 150px, knob 56 → 64px.
- D-pad buttons 54 → 60px (gap 10), BOMB 84 → 92px, DETONATE 56 → 64px, pause 44 → 48px.
- Portrait: joystick bottom-left, BOMB/DETONATE bottom-right, vertically centered in the
  bottom bar (comfortable thumb reach). Landscape: left/right side bars as today.

### 4. No controls in menus
- `main.ts` toggles `body.ingame` when `appState === 'playing'`.
- CSS: `#touch` displays only when `body.touch.ingame` → title / battle / online /
  scores / settings / pause / game-over screens are control-free.

### 5. Verification
- `npx tsc --noEmit` + `npm run deploy`.
- In-app browser at iPhone viewport (390×844 portrait, 844×390 landscape):
  - menu screens: no joystick/buttons visible;
  - in game: HUD bar above canvas (not over field), canvas maximized,
    controls fully in the letterbox, bigger and spaced out.
- Screenshots for user confirmation.

## Files touched

- `index.html` — viewport meta, HUD moved out of `#stage`, CSS for column layout,
  control sizes, `body.ingame` gating, safe-area insets.
- `src/main.ts` — `fit()` reserves HUD height, `layoutTouch()` new geometry,
  `body.ingame` toggle on state changes.
- `src/ui.ts` — (only if needed) HUD show/hide already exists via `hudSet(null)`.
