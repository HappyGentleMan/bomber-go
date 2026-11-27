# Bomber Go Product-Grade Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bomber Go feel like a shipped product — modern floating mobile controls, a cohesive design-system UI, and more expressive procedural characters — while a parallel debug pass leaves it bug-free.

**Architecture:** Keep the lean TypeScript + Vite + canvas-2D, zero-external-asset stack. Extract touch movement into a focused `src/touch.ts` (pure direction quantization + a floating-origin controller). Add `src/haptics.ts`. Upgrade the procedural character renderer in place. Apply a CSS design-token layer + inline SVG icons to the existing DOM overlay. The netcode core and instant bomb spawn are untouched.

**Tech Stack:** TypeScript, Vite, canvas 2D, WebAudio, DOM/CSS, Pointer Events, navigator.vibrate.

**Spec:** `docs/superpowers/specs/2026-11-27-product-polish-design.md`

## Global Constraints
- Zero external image/audio assets — all art procedural canvas, all sound WebAudio synth.
- Do NOT modify netcode core (absolute snapshots + seq stale-drop, interpolation/extrapolation cap) in `src/net.ts` / `src/netgame.ts`.
- Do NOT revert instant bomb drop-in spawn.
- Gate must stay green: `cd "/Users/anson/Documents/Bomber Go" && npx tsc --noEmit && npx tsx test/audit.ts && npx tsx test/smoke.ts`.
- Mobile letterbox layout preserved: HUD bar above canvas; touch clusters in the black letterbox; 15:13 field fully visible; safe-area env() insets respected.
- OpenCode Chromium quirks: no `translateX(%)` on %-sized boxes; pseudo `inset:0` won't stretch (use explicit width/height 100% + left/top 0).
- Visual verification uses the in-app browser (`tools.browser.*`), not headless Chrome.
- Deploy only via `npm run deploy`.

## Review Focus
- **Second finger on the move zone** must not steal the active joystick or leave a stuck direction (single-owner pointer capture).
- **pointercancel / pointerleave / blur** (call, notification, app switch) must release movement — no stuck dir.
- **Toggling joystick↔D-pad in settings mid-game** must not orphan listeners or stick a direction.
- **Keyboard/gamepad + touch together**: keyboard/gamepad still override touch (`dir1 = lastDir1 ?? pd1 ?? tDir` in input.ts:127).
- **Resize / orientation change mid-touch** must reposition the move zone and release any active touch cleanly.

---

### Task 1: Pure direction quantization (TDD)

**Files:**
- Create: `src/touch.ts`
- Test: `test/touch.test.ts` (run with `npx tsx test/touch.test.ts`)

**Interfaces:**
- Produces: `export function quantizeDir(dx: number, dy: number, dead: number): Dir | null` — `Dir` from `./constants` (0=right,1=left,2=down,3=up). Dominant axis wins; ties (`|dx|===|dy|`) resolve to horizontal. Below `dead` (inclusive) → null.

- [ ] **Step 1: Write the failing test** — `test/touch.test.ts` asserts: `(0,0,12)→null`; `(11,0,12)→null`; `(13,0,12)→0`; `(-13,0,12)→1`; `(0,13,12)→2`; `(0,-13,12)→3`; `(20,5,12)→0`; `(5,20,12)→2`; `(20,20,12)→0` (tie→horizontal); `(-20,-20,12)→1`. Use a tiny assert helper that throws on mismatch and prints PASS/FAIL counts, exit 1 on any failure (mirror test/smoke.ts style).
- [ ] **Step 2: Run** `npx tsx test/touch.test.ts` — expect FAIL (module/function missing).
- [ ] **Step 3: Implement** `quantizeDir` in `src/touch.ts` (pure, no DOM).
- [ ] **Step 4: Run** `npx tsx test/touch.test.ts` — expect PASS; run the gate — expect green.
- [ ] **Step 5: Commit** `git add src/touch.ts test/touch.test.ts && git commit -m "feat(touch): pure 4-dir quantization with deadzone + tie-break"`

### Task 2: Floating mobile move controls (joystick default + D-pad option)

**Files:**
- Modify: `src/touch.ts` (add controller)
- Modify: `src/main.ts:79-176` (layoutTouch/fit move-zone sizing), `src/main.ts:532-610` (remove fixed joystick + fixed dpad binding, wire floating controller)
- Modify: `index.html` (move-zone + floating base/knob/cross + direction-indicator markup & CSS)
- Modify: `src/ui.ts:63-76` (move-style toggle reflects floating styles)

**Interfaces:**
- Consumes: `quantizeDir` (Task 1); `input.setTouchDir(d)`, `input.dpadSet` (input.ts); `settings.moveStyle` ('joystick'|'dpad').
- Produces: `export class FloatingMove` in `src/touch.ts` — `new FloatingMove(zone: HTMLElement, base: HTMLElement, knob: HTMLElement, arrows: HTMLElement[], onDir: (d: Dir|null)=>void)`, methods `setStyle(style: 'joystick'|'dpad'): void`, `destroy(): void`. On pointerdown in `zone`: position `base` centered at the touch point (clamped inside zone), capture the pointer, show base; pointermove → `quantizeDir` from base center → `onDir` + light the matching arrow; pointerup/cancel/leave → hide base, `onDir(null)`. Only the first pointer owns it (ignore a second finger). `setStyle` swaps joystick-circle vs D-pad-cross visuals without re-binding listeners.

- [ ] **Step 1: Markup/CSS** — add `#move-zone` (invisible, fills the left letterbox region), `#float-base` (position:fixed, hidden), `#float-knob`, four `.float-arrow` indicators, and a `.dpad-cross` variant. Tokens for size (base 132px, knob 56px). Keep action cluster (`#t-bomb`/`#t-det`) and pause unchanged on the right.
- [ ] **Step 2: Implement `FloatingMove`** in `src/touch.ts` per the interface; clamp base origin so the whole base stays on-screen; reuse one set of pointer listeners across styles.
- [ ] **Step 3: Wire main.ts** — replace the fixed joystick block (563-610) and fixed dpad `bindTouch` direction calls with one `FloatingMove` instance over `#move-zone`, `onDir = input.setTouchDir`. Update `layoutTouch`/`fit` to size the move zone (left half of bottom bar in portrait; left side bar in landscape) instead of the fixed 150/200px clusters. Keep `bindTouch` for bomb/det/pause only.
- [ ] **Step 4: Settings toggle** — ui.ts move toggle calls `floatingMove.setStyle(...)` (via a callback exposed from main.ts) and updates the label; verify no stuck dir on toggle (Review Focus #3).
- [ ] **Step 5: Gate** — `npx tsc --noEmit && npx tsx test/audit.ts && npx tsx test/smoke.ts && npx tsx test/touch.test.ts` green.
- [ ] **Step 6: Browser verify** — open live/dev game in-app browser at a phone viewport (e.g. 390×844 portrait + 844×390 landscape); confirm: base spawns under thumb anywhere in the zone, drag steers + arrow lights, release stops, second finger ignored, bomb/det still fire, toggle to D-pad works. Exercise Review Focus #1,#2,#5 (cancel/resize). Capture screenshots.
- [ ] **Step 7: Commit** `git commit -am "feat(mobile): floating joystick + floating D-pad with 4-dir snap indicator"`

### Task 3: Haptics

**Files:**
- Create: `src/haptics.ts`
- Test: `test/haptics.test.ts`
- Modify: `src/main.ts` (bomb/detonate edges), `src/ui.ts` (menu confirm)

**Interfaces:**
- Produces: `export function haptic(kind: 'light'|'medium'|'heavy'|'select'): void` — maps to `navigator.vibrate` patterns (light=8, medium=18, heavy=[24,40,24], select=6); no-op when `navigator.vibrate` is absent. Export `export const hapticPatterns` for testability.

- [ ] **Step 1: Failing test** — `test/haptics.test.ts`: with a stubbed `navigator.vibrate` recorder, `haptic('heavy')` emits `[24,40,24]`; with vibrate deleted, `haptic('light')` does not throw. Expect FAIL first.
- [ ] **Step 2: Implement** `src/haptics.ts`; run test → PASS.
- [ ] **Step 3: Wire** — call `haptic('medium')` on bomb place, `haptic('heavy')` on detonate, `haptic('select')` on menu confirm (ui.ts click handler). Guard so it never blocks input.
- [ ] **Step 4: Gate** green; **Commit** `git commit -am "feat: guarded haptic feedback on bomb/detonate/menu"`

### Task 4: Design-system UI + SVG icons + mobile polish

**Files:**
- Modify: `index.html` (CSS token layer, inline SVG icon set, menu/bottom-sheet styling, transitions, states)
- Modify: `src/ui.ts` (empty/loading/error state rendering for scores + online status; icon injection)

**Interfaces:**
- Consumes: existing DOM overlay structure (`.overlay`, `.btn`, `.panel`, `#hud`, `.room-tiles`).
- Produces: CSS custom properties `--space-1..6`, `--radius-sm/md/lg`, `--fs-sm/md/lg/xl`, `--dur-fast/base`, `--ease-out`; an inline `<svg>` sprite (`<symbol id="i-...">`) referenced via `<use>` for move/bomb/detonate/pause/settings/back/chevrons.

- [ ] **Step 1: Tokens + icons** — add the token layer to `:root`; define an SVG symbol set; replace text glyphs (▲◀▼▶ on dpad arrows, `II` pause, BOMB/DETONATE labels get icon+text) with `<svg><use>`. Keep the neon palette but normalize spacing/radius/type to the tokens.
- [ ] **Step 2: Mobile menus** — enlarge tap targets (min 44px), make portrait overlays feel like bottom sheets (rounded top, slide-up transition using background-position/opacity per Chromium quirk), thumb-reachable primary actions. Preserve the portrait full-screen overlay rule (index.html:299) so menus never trap in the canvas strip.
- [ ] **Step 3: States** — ui.ts: scores empty state ("No scores yet — play a round"), online status loading/error styling, button disabled state. Consistent focus-visible rings.
- [ ] **Step 4: Gate** green.
- [ ] **Step 5: Browser verify** — in-app browser at phone portrait + landscape + desktop; screenshot title/settings/online/scores/pause; confirm no field coverage, no trapped menus, icons render, transitions smooth. Check Review Focus: menus usable one-handed.
- [ ] **Step 6: Commit** `git commit -am "feat(ui): design tokens, SVG icons, mobile bottom-sheet menus, proper states"`

### Task 5: Character model upgrade (procedural)

**Files:**
- Modify: `src/render.ts:91` (`drawCharBody`), `src/render.ts:673-767` (`getCharBody` size if needed, `drawPlayer` walk cycle)

**Interfaces:**
- Consumes: `CHARACTERS = ['bomber','kitty','knight','ghost','classic']`, `PLAYER_COLORS` (constants.ts); existing `getCharBody(char,color)` cache contract (returns HTMLCanvasElement, drawn at -16,-16,32,32 in drawPlayer).
- Produces: richer `drawCharBody` (distinct silhouettes + accessories + shading per char, still centered at 0,0 in a 32×32 logical box); `drawPlayer` gains a 2-frame leg walk-cycle + directional lean + idle breathing while keeping the existing eye/blink/shield/aura logic and the pre-rendered body cache.

- [ ] **Step 1: Redraw bodies** — upgrade each of the 5 characters in `drawCharBody` with clearer silhouette, shading, and a signature accessory (e.g. bomber cap+visor, kitty ears+tail, knight helm+plume, ghost sheet+wisp, classic round bomb-head). Keep within the 32×32 box and the char+color cache key.
- [ ] **Step 2: Animation** — in `drawPlayer`, add alternating leg lift driven by the step phase (replace the static feet lift), a subtle directional lean (translate/rotate by dir), and idle breathing scale. Keep ghost floating (no legs). Preserve spawn-blink, shield ring, invincible aura, wallpass alpha.
- [ ] **Step 3: Cache sanity test** — add to test (or a throwaway probe) that `getCharBody` builds for every CHARACTERS×PLAYER_COLORS combo without throwing and returns a non-zero canvas. Gate green.
- [ ] **Step 4: Browser verify** — in-app browser: open settings char picker (all 5 previews render), start a campaign + battle, screenshot characters idle/walking in each direction; confirm distinct silhouettes, smooth walk, no hitch on level transition (prewarm still holds).
- [ ] **Step 5: Commit** `git commit -am "feat(characters): higher-detail procedural sprites + walk cycle + directional lean"`

### Task 6: Debug-fix integration (parallel workstream)

**Files:** whatever the read-only review subagent flags (verify first).

- [ ] **Step 1:** When the review subagent returns, quote-verify EACH finding against real code (prior sessions had fabricated quotes). Reproduce reachable bugs with a throwaway probe in the temp dir.
- [ ] **Step 2:** Apply only confirmed fixes, one at a time, gate after each. Do not touch netcode core / instant spawn.
- [ ] **Step 3:** Commit verified fixes separately: `git commit -am "fix: <verified bug>"`.

### Task 7: Final verification + deploy

- [ ] **Step 1:** Full gate green: `npx tsc --noEmit && npx tsx test/audit.ts && npx tsx test/smoke.ts && npx tsx test/touch.test.ts && npx tsx test/haptics.test.ts`.
- [ ] **Step 2:** In-app browser playtest: campaign through ≥2 level transitions (zero hitch), battle, online room create/join UI, mobile portrait+landscape controls, settings toggles. Verify the bomb-animation report (pulse ~0.6 Hz, not strobing).
- [ ] **Step 3:** `npm run deploy`; confirm live 200 + new bundle hash; `git push`.
- [ ] **Step 4:** Report to Anson (Cantonese): what changed, screenshots, live URL, and the net-test reminder.