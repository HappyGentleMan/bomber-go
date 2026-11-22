# iOS UI: full-screen game view, unblocked HUD, roomy controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On phones, the game canvas takes every pixel not used by a slim HUD bar and the touch controls; the HUD no longer covers the field; controls are bigger and never appear in menus.

**Architecture:** `#app` becomes a flex column: slim `#hud` bar (outside the canvas) + centered `#stage` (canvas + overlays). `fit()` reserves the HUD bar's height so the canvas is maximized at the fixed 15:13 aspect (no camera, whole field always visible). `layoutTouch()` places bigger controls in the remaining letterbox with safe-area insets. `body.ingame` (toggled from `appState === 'playing'`) gates control visibility.

**Tech Stack:** Vite + TypeScript, vanilla DOM/CSS, no test framework — verification is `npx tsc --noEmit` plus in-page DOM assertions via the in-app browser at the deployed site.

**Spec:** `docs/design/2026-11-21-ios-ui-fullscreen.md`

## Global Constraints

- Whole 15×13 field must always be visible: **no camera, no cropping** (spec constraint).
- Both portrait and landscape must work (spec constraint).
- HUD must never overlap the canvas (spec: "move it out").
- Touch controls visible **only** while `appState === 'playing'` (spec point 4).
- Commit message style: `ui: <summary>` (matches repo history).
- Do not change game logic, netcode, or renderer drawing — layout/CSS/main.ts wiring only.
- Verify before claiming done: run the listed checks and read the output (verification-before-completion).

## Review Focus

- **Short landscape (e.g. 740×360, older iPhone):** side letterbox bars can be too narrow for the bigger controls → controls must fit in the viewport and never overlap the canvas (Task 3 Step 4 pins this).
- **Rotation / window resize mid-game:** `fit()` + `layoutTouch()` must re-run and leave a consistent layout (Task 3 Step 4 pins this).
- **HUD appears/disappears (game start → menu):** canvas must re-fit so the HUD never overlaps it (Task 1 Step 5 pins this).
- **`settings.touch === 'off':`** no controls in any state, HUD unaffected (Task 2 Step 5 pins this).
- **Pause mid-game:** controls hide with the pause menu, reappear on resume (Task 2 Step 5 pins this).

---

### Task 1: Move HUD out of the canvas

**Files:**
- Modify: `index.html` (viewport meta, `#hud` DOM position, `#app`/`#hud` CSS)
- Modify: `src/main.ts` (`fit()` ~line 107, frame-loop HUD visibility refit)

**Interfaces:**
- Consumes: existing `#hud` element (id unchanged), `fit()` (id unchanged).
- Produces: `#hud` as a direct child of `#app` (sibling **before** `#stage`), visible only when `ui.hudSet()` has been given non-null; `fit()` accounts for `hud.offsetHeight`. Later tasks rely on the HUD never overlapping the canvas.

- [ ] **Step 1: Restructure DOM + CSS in `index.html`**

Move the `#hud` div (currently inside `#stage`, lines 283–288) to be the first child of `#app`, before `#stage`. Add `viewport-fit=cover` to the viewport meta (line 5): `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover`.

CSS changes:
- `#app`: `display: flex; flex-direction: column;` (keep `position: fixed; inset: 0;`; drop `align-items/justify-content: center` — `#stage` gets `margin: auto` which centers it in the leftover space on both axes).
- `#stage`: add `margin: auto;` (flex-centering in the remaining space).
- `#hud`: remove `position: absolute; top:0; left:0; right:0; z-index:5;` — it becomes a static full-width bar: `width: 100%; flex: none;` keep the flex row + `justify-content: space-between` + glass-chip child styles; shrink to a slim bar: `padding: 6px 10px; padding-top: calc(6px + env(safe-area-inset-top, 0px));` and reduce chip padding to `4px 10px`.

- [ ] **Step 2: Reserve HUD height in `fit()` (`src/main.ts` ~line 107)**

```ts
function fit() {
  const pad = 4
  const hud = document.getElementById('hud')!
  const hudH = hud.classList.contains('hidden') ? 0 : hud.offsetHeight
  const availW = window.innerWidth - pad
  const availH = window.innerHeight - pad - hudH
  const scale = Math.min(availW / CANVAS_W, availH / CANVAS_H)
  // ... rest unchanged (w, h, stage/canvas sizing, renderer.resize, layoutTouch)
}
```

- [ ] **Step 3: Refit when HUD visibility changes (`hudUpdate()`, `src/main.ts` ~line 478)**

`hudUpdate(view)` is the only caller of `ui.hudSet` and runs every frame. It has two exit points: line 479 (`ui.hudSet(null)` when `appState === 'title'`) and line 501 (`ui.hudSet({...})`). Add a module-level `let lastHudVisible = false` (next to `lastTickSecond`), and after **each** of the two `ui.hudSet` calls:

```ts
const hv = /* false on the null branch, true on the object branch */
if (hv !== lastHudVisible) { lastHudVisible = hv; fit() }
```

- [ ] **Step 4: Typecheck**

Run: `cd "/Users/anson/Documents/Bomber Go" && npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 5: In-page DOM assertions (in-app browser, deployed or dev URL)**

Load the page (dev: `npm run dev` URL or the deployed site). Via `evaluate`:
1. On title: `document.getElementById('hud').closest('#stage') === null` → true (HUD is outside the canvas).
2. `document.getElementById('hud').classList.contains('hidden')` → true on title.
3. Start a campaign (click `[data-action="campaign"]`), wait ~500ms: HUD no longer hidden, and `document.getElementById('game').getBoundingClientRect().top >= document.getElementById('hud').getBoundingClientRect().bottom - 1` → canvas starts **below** the HUD bar.
4. Canvas maximized: with the HUD visible, `Math.abs(canvasW - Math.min(availW, availH * CANVAS_W / CANVAS_H)) <= 2` using `availW = innerWidth - 4`, `availH = innerHeight - 4 - hud.offsetHeight`.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts
git commit -m "ui: move HUD out of the canvas — slim top bar, canvas maximized below it"
```

---

### Task 2: Touch controls only while playing

**Files:**
- Modify: `index.html` (`#touch` CSS gating, ~line 206–207)
- Modify: `src/main.ts` (frame loop, `body.ingame` toggle)

**Interfaces:**
- Consumes: `appState` (`'title' | 'playing' | 'paused'`, `src/main.ts` line 16), `#touch` element.
- Produces: `body.ingame` class present exactly while `appState === 'playing'`; `#touch` visible only when `body.touch.ingame`.

- [ ] **Step 1: Gate `#touch` on `body.ingame` (CSS, `index.html`)**

Replace:

```css
body.touch #touch { display: block; }
```

with:

```css
body.touch.ingame #touch { display: block; }
```

(`#touch` keeps its default `display: none`.)

- [ ] **Step 2: Toggle `body.ingame` in the frame loop (`src/main.ts`)**

At the top of the per-frame update (inside the rAF loop, before the `if (game && appState !== 'paused')` block), add:

```ts
document.body.classList.toggle('ingame', appState === 'playing')
```

(Idempotent per frame; catches every state change without touching the 13 `appState =` sites.)

- [ ] **Step 3: Typecheck**

Run: `cd "/Users/anson/Documents/Bomber Go" && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Reload the page (dev/deployed) and verify state transitions in-page**

Via `evaluate`, in order:
1. Title: `getComputedStyle(document.getElementById('touch')).display` → `'none'`.
2. Click `[data-action="campaign"]`, wait ~500ms: display → `'block'` (and `document.body.classList.contains('ingame')` → true).
3. Trigger pause (click `#t-pause`): display → `'none'`.
4. Click `[data-action="resume"]`: display → `'block'`.

- [ ] **Step 5: Review-focus checks (in-page)**

1. With `settings.touch === 'off'` (set via the settings toggle in-page), starting a game keeps `#touch` display `'none'`.
2. HUD still behaves as Task 1 (bar visible in play, hidden in menus).

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts
git commit -m "ui: hide touch controls outside of active play (menus, pause, game over)"
```

---

### Task 3: Roomier controls + layout that always fits

**Files:**
- Modify: `index.html` (control CSS sizes, `--safe-bottom` var)
- Modify: `src/main.ts` (`layoutTouch()` ~line 75, `fit()` side-bar guarantee)

**Interfaces:**
- Consumes: `settings.moveStyle` (`'joystick' | 'dpad'`), `layoutTouch()`/`fit()` from Task 1 (HUD height already reserved).
- Produces: control geometry constants — joy 150×150, d-pad 200×130 (60px buttons, 10px gaps), actions ~170×152 (BOMB 92, DET 64, pause 48); `fit()` guarantees side bars ≥ `moveW + 16` in height-fit landscape.

- [ ] **Step 1: Bigger control CSS (`index.html`)**

- `#joy-base`: `128px` → `150px`; `#joy-knob`: `56px` → `64px` (margin `-32px 0 0 -32px`).
- `#t-dpad`: grid `repeat(3, 54px)` → `repeat(3, 60px)`, rows `repeat(2, 60px)`, `gap: 8px` → `10px`.
- `.tbtn`: `54px` → `60px`.
- `#t-bomb`: `84px` → `92px`; `#t-det`: `56px` → `64px`; `#t-pause`: `44px` → `48px`; `#t-actions` gap `10px` → `12px`.
- `:root`: add `--safe-bottom: env(safe-area-inset-bottom, 0px);`.

- [ ] **Step 2: New geometry in `layoutTouch()` (`src/main.ts` ~line 75)**

Update constants to match Step 1: `moveW/moveH` → joy `150/150`, dpad `200/130`; `actW/actH` → `170/152`. Read the safe inset:

```ts
const safeB = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')) || 0
```

- Portrait branch: `bottom` placement becomes `Math.max(8 + safeB, (bottom - safeB) / 2 - H / 2)` for each cluster (centered in the bar above the home indicator).
- Landscape branch: unchanged formula, but keep the `side >= moveW + 16` gate (now with the bigger `moveW`).

- [ ] **Step 3: Side-bar guarantee in `fit()` (`src/main.ts`)**

After `w`/`h` are computed (and only when the canvas is height-limited, i.e. `h === Math.floor(availH)`): if `(availW - w) / 2 < moveW + 16` (moveW per `settings.moveStyle`, same values as Step 2), cap the canvas:

```ts
w = Math.floor(availW - 2 * (moveW + 16))
h = Math.floor(w * CANVAS_H / CANVAS_W)
```

so the side bars always fit the controls. (Portrait width-fit is unaffected: `h < availH`.)

- [ ] **Step 4: Typecheck**

Run: `cd "/Users/anson/Documents/Bomber Go" && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: In-page geometry assertions (in-app browser, in a running game)**

Via `evaluate` with the game in `playing` state:
1. Every control (`#joy-base` or `#t-dpad`, `#t-actions`) is inside the viewport: `r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0`.
2. No control overlaps the canvas rect (joy/dpad/actions vs `#game` rect, with 0px tolerance).
3. **Short-landscape pin:** resize the browser window (or emulate) to `740×360` (landscape), wait for the resize handler, then re-run checks 1–2 — controls still fit and don't overlap the canvas.
4. **Rotation pin:** toggle window between `390×844` and `844×390`, re-run checks 1–2 in both — consistent layout after each.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts
git commit -m "ui: bigger, roomier touch controls; layout always fits (side-bar guarantee, safe areas)"
```

---

### Task 4: Deploy, full visual pass, push

**Files:**
- No source changes (verification + deploy only).

**Interfaces:**
- Consumes: Tasks 1–3 (all layout behavior).
- Produces: live release at `https://bomber.119-247-94-77.sslip.io` with the new UI; pushed commit(s).

- [ ] **Step 1: Deploy**

Run: `cd "/Users/anson/Documents/Bomber Go" && npm run deploy`
Expected: build succeeds, `live:` line prints a new release name, `~/srv/bomber-go/current` updated.

- [ ] **Step 2: Full checklist on the live site (in-app browser, iPhone-sized window if the browser supports it; otherwise current window + the relative asserts)**

In-page via `evaluate`, in order:
1. Title: no controls visible (`#touch` display `none`), no HUD bar, canvas behind the menu.
2. Start campaign: HUD bar above canvas (canvas top ≥ HUD bottom), canvas maximized (Task 1 Step 5 check 4), controls visible, big (joy 150px), in the letterbox, not over the field.
3. Pause: controls hidden. Resume: controls back.
4. Quit to menu: controls + HUD gone.
5. Landscape (window resized): same invariants hold.

- [ ] **Step 3: Screenshots for the user**

Capture the in-game view (portrait and landscape if achievable) with `browser screenshot` and show them to the user for confirmation.

- [ ] **Step 4: Push**

```bash
cd "/Users/anson/Documents/Bomber Go" && git push
```

Expected: `main -> main`, new HEAD printed.
