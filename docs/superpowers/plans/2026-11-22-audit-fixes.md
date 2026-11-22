# Bomber Go Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 30 verified audit findings (bugs + controls/UX + juice) and ship a verified deploy.

**Architecture:** Seven tasks in dependency order: simulation fixes (game.ts, headless-tested) → netcode (netgame/net/main, headless-tested) → input/menu (input/ui, headless-tested) → layout/overlay/HUD (main/index.html, browser-verified) → PWA icons → juice (game/render) → full verification + deploy. The codebase has no test framework; tests are headless tsx scripts in `test/` using the established DOM-stub + `check()` + `process.exit` pattern.

**Tech Stack:** TypeScript (strict), Vite, PeerJS, canvas 2D, WebAudio. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-22-audit-fixes.md`

## Global Constraints

- `npx tsc --noEmit` must stay clean after every task.
- All existing `test/*.ts` scripts must keep passing (run `npx tsx test/smoke.ts` as the canary each task).
- Tests follow the existing pattern: headless tsx, DOM stubs at top (copy from `test/smoke.ts:1-17`), `check(name, cond, extra)`, exit code 0/1.
- UI copy stays English; code comments English.
- No new npm dependencies.
- One commit per task, conventional-commit style (`fix:`, `feat:`, `chore:`).
- Deploy (`npm run deploy`) ONLY in Task 7, after all verification passes.
- Work on branch `audit-fixes` (create from `main` before Task 1).

## Review Focus

Failure modes no headless test exercises — each is pinned to a Task 7 browser-verification step:

1. **Real 2-tab online join (WebRTC):** first-frame crash fix (T2) must hold with a live host+client; expect zero console errors during join → Task 7 step 7.3.
2. **Post-match lifecycle:** after an online match ends, host stops broadcasting, and NEITHER side shows a spurious "CONNECTION LOST" / "OPPONENT LEFT" banner → Task 7 step 7.4.
3. **Notched-iPhone landscape insets:** with `--safe-left/right` forced to 47px in the test viewport, d-pad and joystick must not overlap the canvas → Task 7 step 7.2.
4. **iOS keyboard on initials:** Enter in `#over-initials` saves + blurs (can't reproduce real keyboard; verify the keydown path) → Task 7 step 7.5.
5. **Touch multi-finger (d-pad two-finger, joystick second finger):** browser touch emulation is limited → manual device check; note in the deploy summary → Task 7 step 7.6.

---

### Task 1: Simulation bug fixes (game.ts)

**Files:**
- Modify: `src/game.ts`
- Create: `test/audit.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Game.lastSuddenDetonation: number` (public), `weightedPowerupKind(excludeLife?: boolean)` (private, signature change), shake-respecting `getShakeOffset()`. No public API changes relied on by later tasks.

Fixes spec items: 8 (sudden-death credit), 17 (double detonation), 18 (respawn), 19 (stun input), 14+22 (battle drops), 25 (AI reverse), 6 (shake setting), 32-part (hit-stop power≥4).

- [ ] **Step 1: Write the failing tests** — create `test/audit.ts` with the DOM stubs from `test/smoke.ts:1-17`, then these checks:

```ts
import { Game } from '../src/game.ts'
import { updateSettings, settings } from '../src/storage.ts'
import { MAX_POWERUPS_ON_FIELD } from '../src/constants.ts'
// stubs first (window/localStorage/navigator), then dynamic import of Game as in smoke.ts

// 1. sudden-death kill is NOT credited
{
  const b = new Game('battle', { aiPlayer2: true })
  const [p1, p2] = b.players
  b.lastSuddenDetonation = b.time            // a sudden bomb just detonated
  b.killPlayer(p2, 'flame')
  check('sudden-death kill not credited', p1.kills === 0, `kills=${p1.kills}`)
}
{
  const b = new Game('battle', { aiPlayer2: true })
  const [p1, p2] = b.players
  b.lastSuddenDetonation = 0                 // old — normal kill
  b.killPlayer(p2, 'flame')
  check('normal kill credited', p1.kills === 1, `kills=${p1.kills}`)
}

// 2. no duplicate detonation: two adjacent bombs expiring same tick
{
  const b = new Game('battle', { aiPlayer2: true })
  // find two adjacent walk tiles
  let a = null
  outer: for (let r = 1; r < 12; r++) for (let c = 1; c < 13; c++)
    if (b.grid[r][c].t === 0 && b.grid[r][c + 1].t === 0) { a = { c, r }; break outer }
  b.bombs.push({ id: b.bombId++, owner: 0, col: a.c, row: a.r, x: a.c, y: a.r, sliding: null, fuse: 0, power: 2, born: b.time })
  b.bombs.push({ id: b.bombId++, owner: 1, col: a.c + 1, row: a.r, x: a.c + 1, y: a.r, sliding: null, fuse: 0, power: 2, born: b.time })
  b.update(1 / 60, { p1: {}, p2: {} })
  const dup = b.flames.filter(f => f.col === a.c + 1 && f.row === a.r && f.dir === -1).length
  check('chained bomb detonates once (no dup core flame)', dup === 1, `dups=${dup}`)
}

// 3. respawn clears stun + waits for spawn-tile bomb
{
  const b = new Game('battle', { aiPlayer2: true })
  const p1 = b.players[0]
  p1.alive = false; p1.respawnIn = 0.1; p1.frozenUntil = b.time + 10
  for (let t = 0; t < 2; t += 1 / 60) b.update(1 / 60, { p1: {}, p2: {} })
  check('respawn clears frozenUntil', p1.alive && p1.frozenUntil === 0, `alive=${p1.alive} frozen=${p1.frozenUntil}`)
}
{
  const b = new Game('battle', { aiPlayer2: true })
  const p1 = b.players[0]
  b.bombs.push({ id: b.bombId++, owner: -1, col: 1, row: 1, x: 1, y: 1, sliding: null, fuse: 3000, power: 1, born: b.time })
  p1.alive = false; p1.respawnIn = 0.1
  for (let t = 0; t < 1; t += 1 / 60) b.update(1 / 60, { p1: {}, p2: {} })
  check('respawn waits for spawn-tile bomb', !p1.alive, `alive=${p1.alive}`)
  for (let t = 0; t < 4; t += 1 / 60) b.update(1 / 60, { p1: {}, p2: {} })
  check('respawn after bomb clears', p1.alive && !b.bombAt(1, 1), `alive=${p1.alive}`)
}

// 4. stunned player cannot bomb/detonate
{
  const b = new Game('battle', { aiPlayer2: true })
  const p1 = b.players[0]
  p1.frozenUntil = b.time + 5
  b.playerInput(0, null, true, false)
  check('stunned player cannot place bomb', b.bombs.length === 0, `bombs=${b.bombs.length}`)
}

// 5. battle drops: no 'life', respects field cap
{
  const b = new Game('battle', { aiPlayer2: true, attract: true })
  b.players.forEach(p => p.speed = 0)
  b.powerups = []
  let sawLife = false, capHit = false
  for (let i = 0; i < 60; i++) {
    b.battleNextItem = 0
    b.update(1 / 60, { p1: {}, p2: {} })
    for (const u of b.powerups) if (u.kind === 'life') sawLife = true
    if (b.powerups.length > MAX_POWERUPS_ON_FIELD) capHit = true
  }
  check('battle drops never include life', !sawLife)
  check('battle drops respect MAX_POWERUPS_ON_FIELD', !capHit, `count=${b.powerups.length}`)
}

// 6. screen shake setting is honored
{
  const g = new Game('campaign')
  g.shake(10, 0.4)
  updateSettings({ shake: false })
  const off = g.getShakeOffset()
  check('shake off => zero offset', off.x === 0 && off.y === 0, JSON.stringify(off))
  updateSettings({ shake: true })
  check('shake default restored', settings.shake === true)
}

// 7. power>=4 detonation hit-stops
{
  const b = new Game('battle', { aiPlayer2: true })
  let a = null
  outer: for (let r = 1; r < 12; r++) for (let c = 1; c < 13; c++)
    if (b.grid[r][c].t === 0) { a = { c, r }; break outer }
  b.bombs.push({ id: b.bombId++, owner: -1, col: a.c, row: a.r, x: a.c, y: a.r, sliding: null, fuse: 0, power: 5, born: b.time })
  b.update(1 / 60, { p1: {}, p2: {} })
  check('power>=4 blast hit-stops', b.timeScale < 1, `timeScale=${b.timeScale}`)
}
```

(Adjust label syntax — the `b2:` label above is a drafting artifact; use a plain second block. If `b.bombId` is private, push with a fresh id `1`/`2` — check `game.ts` and use what compiles. If `p1.respawnIn`/`alive` mutation needs the game in a specific state, mirror how `test/death.ts` drives respawns.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx test/audit.ts`
Expected: FAIL on checks 1,2,3,4,5,6,7 (unimplemented behavior)

- [ ] **Step 3: Implement the fixes in `src/game.ts`**

1. Add public field `lastSuddenDetonation = 0` (near other battle state fields).
2. In `detonate(b, chain)` (game.ts:816): first line `const idx = this.bombs.indexOf(b); if (idx < 0) return; this.bombs.splice(idx, 1)` (replaces 816-818); after the splice add `if (b.owner === -1) this.lastSuddenDetonation = this.time`.
3. In `killPlayer` (game.ts:465): replace `const suddenBomb = this.bombs.some(b => b.owner === -1)` with `const suddenBomb = this.time - this.lastSuddenDetonation < 0.5`.
4. In `respawnPlayer` (game.ts:488-496): after computing `s`, add `if (this.bombAt(s.col, s.row)) return` (retried next tick); before `audio.play('spawn')` add `p.frozenUntil = 0`.
5. In `playerInput` (game.ts:245-253): `const stunned = p.frozenUntil > this.time`; gate `if (bomb && !stunned) this.tryPlaceBomb(p)` and `if (detonate && !stunned) { ... }`.
6. `weightedPowerupKind(excludeLife = false)`: `const kinds = excludeLife ? POWERUP_KINDS.filter(k => k !== 'life') : POWERUP_KINDS` and iterate `kinds`. Change the battle-drop call (game.ts:1050) to `this.weightedPowerupKind(true)`; add `&& this.powerups.length < MAX_POWERUPS_ON_FIELD` to the drop condition (game.ts:1037).
7. Replace all three `(dir + 2) % 4` with `dir ^ 1` (game.ts:621, 1856, 1933 — keep the `as Dir` casts).
8. `getShakeOffset()` (game.ts:1104): first line `if (!settings.shake) return { x: 0, y: 0 }`; add `settings` to the `./storage` import.
9. In `detonate` after the `audio.play(...)` line: `if (power >= 4) this.hitStop(0.45, 0.05)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx test/audit.ts && npx tsx test/smoke.ts && npx tsc --noEmit`
Expected: ALL PASS (audit, smoke, typecheck)

- [ ] **Step 5: Commit**

```bash
git add src/game.ts test/audit.ts
git commit -m "fix: simulation bugs (sudden-death credit, double detonation, respawn, stun, battle drops, AI reverse dir, shake setting, hit-stop)"
```

---

### Task 2: Netcode fixes (join race, post-match cleanup, round-win, join timeout)

**Files:**
- Modify: `src/netgame.ts`, `src/net.ts`, `src/main.ts`
- Modify: `test/audit.ts` (append)

**Interfaces:**
- Consumes: `RemoteGame` (Task 1 untouched), `Game.lastRoundWin` (added here).
- Produces: `RemoteGame.ready: boolean` (true after first `apply`); `Game.lastRoundWin: number` (-1 none/draw, 0/1 winner) serialized in snapshots; `Net` 20s join timeout + surfaced network errors; `matchOver`/`attractTimer` module state in main.ts (internal).

Fixes spec items: 1, 7, 9, 10, 13.

- [ ] **Step 1: Write the failing tests** — append to `test/audit.ts`:

```ts
import { RemoteGame, serializeGame, diffSnapshots } from '../src/netgame.ts'

// 8. RemoteGame ready flag
{
  const r = new RemoteGame()
  check('remote not ready before first snapshot', r.ready === false)
  const g = new Game('battle', { aiPlayer2: true })
  r.apply(serializeGame(g))
  check('remote ready after first snapshot', r.ready === true)
}

// 9. snapshot carries lastRoundWin and diff reports round winner
{
  const g = new Game('battle', { aiPlayer2: true })
  g.endBattle(0)                       // awards round 0, state stays 'playing' (round 1 < target)
  const snap = serializeGame(g)
  check('snapshot carries lastRoundWin', snap.lastRoundWin === 0, `lastRoundWin=${snap.lastRoundWin}`)
  const prev = { ...snap, lastRoundWin: -1, state: 'playing', round: snap.round - 1 }
  const ev = diffSnapshots(prev, snap)
  check('diff reports round winner to client', ev.roundWin === 0, `roundWin=${ev.roundWin}`)
  const ev2 = diffSnapshots(snap, { ...snap })
  check('no spurious round event on identical snapshots', ev2.roundWin === -1)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx test/audit.ts`
Expected: FAIL on checks 8, 9 (`ready` undefined; `lastRoundWin` undefined)

- [ ] **Step 3: Implement**

`src/netgame.ts`:
1. `RemoteGame`: add `ready = false`; set `this.ready = true` at the end of `apply()`.
2. `serializeGame`: add `lastRoundWin: g.lastRoundWin` (next to `roundWins`).
3. `RemoteGame`: add `lastRoundWin = -1`; in `apply()`: `this.lastRoundWin = s.lastRoundWin`.
4. `diffSnapshots` (netgame.ts:193-199): reorder the tail to:
```ts
if (cur.state === 'battleover' && prev.state !== 'battleover') {
  ev.battleOver = true
  ev.roundWin = cur.winner
} else if (cur.lastRoundWin !== prev.lastRoundWin && cur.lastRoundWin >= 0) {
  ev.roundWin = cur.lastRoundWin
} else if (cur.state === 'playing' && prev.state === 'playing' && cur.round !== prev.round) {
  ev.roundWin = -1
}
```

`src/game.ts`:
5. Add public `lastRoundWin = -1`; in `endBattle` (game.ts:926-935) `!done` branch, set `this.lastRoundWin = winner` before `startRound()`.

`src/main.ts`:
6. Render/HUD gate (main.ts:635): `else if (remote && remote.ready)` (draw + hudUpdate only once a snapshot has landed).
7. Post-match cleanup: add module state `let matchOver = false`. In the host `battleover` handler (main.ts:354-366, non-attract branch) set `matchOver = true` after `appState = 'title'`. In the loop (main.ts:576): `if (game && appState !== 'paused' && !matchOver)`. Reset `matchOver = false` in: `startCampaign`, `startBattle`, `startAttract`, `hostOnline`'s `onOpen`, `joinOnline`'s `onOpen`, `leaveNet`.
8. Client `ev.battleOver` path (main.ts:299-307): add `leaveNet()` after `appState = 'title'` (its `net.onClose` then early-returns via `netRole === 'none'`; the host's own close is handled by the host's `onClose` with `wasPlaying === false` → no banner).
9. Attract timer: add `let attractTimer: number | null = null`; main.ts:356 becomes `attractTimer = window.setTimeout(startAttract, 1500)`; clear it (`window.clearTimeout(attractTimer); attractTimer = null`) in the same six places `matchOver` is reset.
10. `src/net.ts` join():
   - add `private joinTimer: number | null = null`
   - after `new Peer(...)`: `this.joinTimer = window.setTimeout(() => { if (!this.connected) this.onError?.('Cannot reach server — check your connection') }, 20000)`
   - clear `joinTimer` in `destroy()` and in `wire()`'s `conn.on('open')`
   - error handler (net.ts:101-105): drop the `type !== 'network'` filter — surface every non-`peer-unavailable` error like the host path does.
11. Host auto-pause (spec 21): main.ts:648 `autoPause` must also exclude a host with a connected client: `const autoPause = () => { if (appState === 'playing' && netRole !== 'client' && !(netRole === 'host' && net.connected)) pause() }` — a host tab-blur mid-match no longer freezes the opponent. (Spec 20, lost one-shot input edges, is deliberately NOT fixed: rare, small reorder window, player can re-press; a resend/ack protocol is disproportionate.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx test/audit.ts && npx tsx test/smoke.ts && npx tsc --noEmit`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/netgame.ts src/net.ts src/main.ts src/game.ts test/audit.ts
git commit -m "fix: netcode (join-race gate, post-match cleanup, client round-win events, join timeout + network errors, attract timer)"
```

---

### Task 3: Input & menu fixes

**Files:**
- Modify: `src/input.ts`, `src/ui.ts`, `src/main.ts`
- Modify: `test/audit.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `InputManager.dpadSet(dir: Dir, active: boolean): void` + `getTouchDir(): Dir | null` (public); `InputManager.keyboardSeen`, `InputManager.gamepadSeen` (public booleans); `UI.showOnlineCopy(show: boolean): void` (used by Task 4).

Fixes spec items: 2, 11 (warning half), 12, 15, 16, 28 (deep-link read half).

- [ ] **Step 1: Write the failing tests** — append to `test/audit.ts`:

```ts
import { input } from '../src/input.ts'

// 10. two-finger d-pad: latest press wins, release falls back to other finger
{
  input.dpadSet(1, true)   // left
  check('dpad single press', input.getTouchDir() === 1)
  input.dpadSet(2, true)   // left+down
  check('dpad two fingers -> latest (down)', input.getTouchDir() === 2)
  input.dpadSet(1, false)  // release left
  check('dpad release falls back to down', input.getTouchDir() === 2)
  input.dpadSet(2, false)
  check('dpad all released -> null', input.getTouchDir() === null)
}

// 11. game/menu keys are ignored while an input field is focused
{
  const ae = (globalThis as any).document ?? {}
  ;(globalThis as any).document = { activeElement: { tagName: 'INPUT' } }
  ;(input as any).onKeyDown({ code: 'Space', repeat: false, preventDefault: () => {} })
  check('Space in an input does not bomb', (input as any).p1.bomb === false)
  ;(globalThis as any).document = { activeElement: null }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx test/audit.ts`
Expected: FAIL on checks 10, 11 (`dpadSet` not a function; Space bombs)

- [ ] **Step 3: Implement**

`src/input.ts`:
1. Add `private dpadOrder: Dir[] = []` and:
```ts
dpadSet(dir: Dir, active: boolean) {
  if (active) { if (!this.dpadOrder.includes(dir)) this.dpadOrder.push(dir) }
  else this.dpadOrder = this.dpadOrder.filter(d => d !== dir)
  this.touchDir = this.dpadOrder.length ? this.dpadOrder[this.dpadOrder.length - 1] : null
}
getTouchDir(): Dir | null { return this.touchDir }
```
2. `onBlur`: also `this.dpadOrder = []`.
3. `onKeyDown` (input.ts:45): after the `e.repeat` guard add:
```ts
this.keyboardSeen = true
const ae = document.activeElement as HTMLElement | null
if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return
```
4. Add public `keyboardSeen = false`, `gamepadSeen = false`; set `gamepadSeen = true` in the gamepad-poll section (input.ts:88) when a pad is present.

`src/main.ts`:
5. `bindTouch` (main.ts:437-462): the four d-pad buttons call `input.dpadSet(dir, true)` / `input.dpadSet(dir, false)` instead of `setTouchDir`; bomb/det unchanged.
6. Joystick (main.ts:489-499): add `let joyPointer: number | null = null`; pointerdown stores `joyPointer = e.pointerId`; pointermove and pointerup early-return `if (e.pointerId !== joyPointer)` (pointerup also resets `joyPointer = null`).
7. 2P warning: in the `battle-2p` action handler, after starting the game: `if (('ontouchstart' in window || navigator.maxTouchPoints > 0) && !input.keyboardSeen && !input.gamepadSeen) ui.banner('P2 NEEDS A KEYBOARD OR GAMEPAD', 3)`.
8. Deep link: in the debug-params section (main.ts:660+), after `ui.init()`: `const join = params.get('join'); if (join && /^[A-Z0-9]{4,5}$/i.test(join)) { ui.show('online'); ui.onlineCode(join.toUpperCase()) }`.

`src/ui.ts`:
9. `show()` (ui.ts:74-94): in the menu-selection block, the `else` branch sets `this.menuScreen = null; this.menuIndex = 0` (covers settings/scores/pause/over/clear/battleover).
10. Click handler (ui.ts:18-25): before `this.onAction?.(a)`, sync selection: `const menu = btn.closest('.menu'); if (menu) { const i = [...menu.querySelectorAll('.btn')].indexOf(btn); if (i >= 0) this.menuIndex = i }`.
11. `showGameOver` (ui.ts:193-195): keep the auto-focus, add on `inp`:
```ts
inp.onkeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault()
    ;($('over-save') as HTMLButtonElement).click()
    inp.blur()
  }
}
```
12. `banner()` (ui.ts:144-149): track the timeout (`private bannerTimer = 0`, clear before re-setting) and auto-shrink to fit:
```ts
el.style.fontSize = ''
const ratio = el.clientWidth / el.scrollWidth
if (ratio < 1) el.style.fontSize = `${Math.max(12, Math.floor(ratio * parseFloat(getComputedStyle(el).fontSize)))}px`
```
13. Add `showOnlineCopy(show: boolean)` toggling `hidden` on `#online-copy` (element added in Task 4; guard with `if (!el) return` so this task is self-contained).
14. In the settings bindings, wire `#online-code` Enter: `codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (document.querySelector('[data-action="online-join"]') as HTMLButtonElement)?.click() } })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx test/audit.ts && npx tsx test/smoke.ts && npx tsc --noEmit`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/input.ts src/ui.ts src/main.ts test/audit.ts
git commit -m "fix: input & menu (activeElement guard, two-finger d-pad, joystick pointerId, stale menu guard, 2P warning, code Enter-join, banner fit)"
```

---

### Task 4: Layout, overlays, HUD, online UX

**Files:**
- Modify: `src/main.ts`, `index.html`, `src/ui.ts`

**Interfaces:**
- Consumes: `UI.showOnlineCopy` (Task 3).
- Produces: none (leaf task, browser-verified).

Fixes spec items: 3, 4 (overlay-scroll half), 5, 11 (hint), 24 (CSS fallback), 26, 27, 28 (copy button), 29.

- [ ] **Step 1: `fit()` safe-area budget** (main.ts:116-155)

Read the three CSS vars (`--safe-left/right/bottom`) at the top of `fit()` (same pattern as `layoutTouch()` main.ts:88-91), then:
- landscape branch (main.ts:131-138): `const need = Math.max(moveW, 170) + 16 + safeL + safeR`
- portrait branch (main.ts:141-148): `const need = moveH + 16 + safeB`

- [ ] **Step 2: Pause button out of the action cluster**

`index.html`: move `<div class="tbtn" id="t-pause">II</div>` (line 428) out of `#t-actions` into its own wrapper `<div class="tcluster" id="t-pause-wrap">…</div>` inside `#touch`. CSS: give `#t-pause` a translucent style (`background: rgba(10,16,32,.45)`; keep 48px) so the field shows through. `main.ts` `layoutTouch()`: position `#t-pause-wrap` at the canvas top-right corner: `left = stageRect.right - 56`, `top = stageRect.top + 8` (read `stage.getBoundingClientRect()`; run after `stage` sizing in `fit()`).

- [ ] **Step 3: Overlay scroll** (index.html `.overlay`, line 47-56)

Add `overflow-y: auto;` and change `justify-content: center` to `justify-content: safe center;` (graceful fallback where unsupported).

- [ ] **Step 4: HUD polish** (ui.ts `hudSet` 151-162, main.ts `hudUpdate` 513+)

1. `hudSet`: hide the level chip's `.stat` wrapper when `h.level <= 0`: `;($('hud-level').parentElement as HTMLElement).classList.toggle('hidden', h.level <= 0)`.
2. Cache `#hud-player` innerHTML: `private lastPlayerHtml = ''`; skip the write when unchanged; on change add a `bump` class (retrigger via `void el.offsetWidth`).
3. CSS (index.html): `@keyframes pipbump { 0% { transform: scale(1) } 35% { transform: scale(1.18) } 100% { transform: scale(1) } }` and `#hud-player.bump { animation: pipbump .28s ease; }`.
4. Life-loss flash: in `hudUpdate`, track `let lastLives = -1`; when `view.mode === 'campaign' && view.lives < lastLives`, add class `hurt` to `#hud-player` (CSS: red glow pulse ~0.5s, removed on animationend); update `lastLives` each frame.

- [ ] **Step 5: Level-clear tap-to-continue** (main.ts, index.html)

1. Loop gate (main.ts:576): `if (game && appState !== 'paused' && ui.screen !== 'clear')` — freezes the 2.2s auto-advance while the panel is up.
2. Controls hidden during the panel (main.ts:570): `document.body.classList.toggle('ingame', appState === 'playing' && ui.screen !== 'clear')`.
3. Continue on tap: `stage.addEventListener('pointerdown', () => { if (ui.screen === 'clear') ui.show(null) })`.
4. Continue on keyboard: in `input.onMenuNav` handler (main.ts:427-433), before the screen check: `if (ui.screen === 'clear') { if (d === 'ok') ui.show(null); return }`.
5. `index.html` `#ui-clear`: add `<div class="hint" style="letter-spacing:.2em">TAP TO CONTINUE</div>` after the stats panel.

- [ ] **Step 6: Room-code copy button** (index.html, main.ts)

1. `index.html` online panel row (line 406-409): add `<button class="btn hidden" id="online-copy" style="min-width:0; padding:10px 18px" data-action="online-copy">COPY CODE</button>`.
2. `main.ts` `onAction`: `case 'online-copy': navigator.clipboard?.writeText(net.roomCode).then(() => ui.onlineStatus('COPIED!', 'ok')).catch(() => ui.onlineStatus('COPY FAILED', 'err')); break`.
3. Show/hide: `ui.showOnlineCopy(true)` in `hostOnline` after `net.host()`; `ui.showOnlineCopy(false)` in `joinOnline`, both `onOpen`s, and `leaveNet`.
4. Deep link read is already in Task 3 step 3.8 — no work here.

- [ ] **Step 7: Battle-screen 2P hint** (index.html:324)

Extend the hint: `P1 <span class="kbd">WASD</span>+<span class="kbd">SPACE</span> · P2 <span class="kbd">IJKL</span>+<span class="kbd">ENTER</span> · 2P LOCAL needs 2 keyboards / gamepads`.

- [ ] **Step 8: Verify in browser**

Run: `npm run build` (typecheck + bundle), then load `?start=campaign` in the in-app browser at 844×390 landscape with `--safe-left/right` forced to 47px (existing forced-class technique): assert d-pad (switch settings to d-pad) right edge < canvas left edge; joystick unchanged; overlay scroll works on 352×354-ish landscape (settings screen BACK reachable); pause button at canvas top-right, not above BOMB; level-clear panel shows TAP TO CONTINUE and hides touch controls.
Expected: all layout assertions hold; no console errors.

- [ ] **Step 9: Commit**

```bash
git add src/main.ts src/ui.ts index.html
git commit -m "fix: layout & UX (safe-area letterbox budget, pause button position, overlay scroll, HUD chip/cache/pulse, tap-to-continue, copy code, 2P hint)"
```

---

### Task 5: PWA icons + iOS meta

**Files:**
- Create: `public/icon-180.png`, `public/icon-512.png`
- Modify: `public/manifest.webmanifest`, `index.html`

**Interfaces:** none.

Fixes spec item: 23.

- [ ] **Step 1: Generate PNGs from `public/icon.svg`**

Check available converters (`rsvg-convert`, `magick`, `python3 -c "import cairosvg"`); use the first that exists. Fallback: `npx --yes sharp-cli` (dev-only, not added to package.json). Render 180×180 and 512×512. If the SVG art touches the edges (check `icon.svg`), render the 512 with the art scaled to 76% (maskable safe zone) and keep 180 as-is.

- [ ] **Step 2: Manifest + meta**

`public/manifest.webmanifest`: add `"sizes": "180x180"` and `"sizes": "512x512"` PNG entries (`purpose: "any"` for 180, `"any maskable"` for 512), keep the SVG entry.
`index.html` head (after the icon link, line 8):
```html
<link rel="apple-touch-icon" href="./icon-180.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- [ ] **Step 3: Verify**

Run: `npm run build && node -e "JSON.parse(require('fs').readFileSync('public/manifest.webmanifest'))"` and confirm both PNGs exist with non-zero size.
Expected: build clean, manifest valid JSON, PNGs present.

- [ ] **Step 4: Commit**

```bash
git add public/ index.html
git commit -m "feat: PWA icons (PNG 180/512, maskable) + iOS apple meta tags"
```

---

### Task 6: Juice (bomb drop-in, flame growth, pickup/hit feedback, match-end celebration)

**Files:**
- Modify: `src/game.ts`, `src/netgame.ts`, `src/render.ts`, `src/main.ts`, `index.html`
- Modify: `test/audit.ts` (append)

**Interfaces:**
- Consumes: `born` field on `BombState` (game.ts) and serialized bombs.
- Produces: serialized bomb index 9 = `born` (seconds); render `drawBomb(ctx, b, t, time, alpha)` signature (time = game seconds).

Fixes spec items: 31, 32, 33, 34, 35.

- [ ] **Step 1: Write the failing test** — append to `test/audit.ts`:

```ts
// 12. match end celebrates (flash + particles on the winner's side)
{
  const g = new Game('battle', { aiPlayer2: true, attract: true })
  g.roundWins = [1, 0]
  const flashBefore = g.getFlashAlpha()
  g.endBattle(0)
  check('match end flashes', g.getFlashAlpha() > flashBefore, `flash=${g.getFlashAlpha()}`)
  check('match end spawns particles', g.particles.list.length > 0, `particles=${g.particles.list.length}`)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx test/audit.ts`
Expected: FAIL on check 12

- [ ] **Step 3: Implement**

`src/game.ts`:
1. `endBattle` done-branch (game.ts:936-937): after `this.winner = winner` add the celebration (winner ≥ 0 only):
```ts
if (winner >= 0) {
  const wp = this.players[winner]
  const hex = winner === 0 ? '#00e5ff' : '#ff2e88'
  this.flash(winner === 0 ? '0,229,255' : '255,46,136', 0.5, 0.8)
  this.particles.burst(wp.x * 48 + 24, wp.y * 48 + 24, hex, 40, 300)
  this.particles.burst(wp.x * 48 + 24, wp.y * 48 + 24, '#ffd54a', 30, 240)
  this.hitStop(0.3, 0.15)
}
```
2. `killPlayer` (game.ts:457 area): add `this.hitStop(0.35, 0.1)` (spec 34 — death slow-mo, both modes).

`src/netgame.ts`:
3. `serializeGame` bombs: append `+b.born.toFixed(2)` (index 9).
4. `RemoteGame.apply` bombs: `born: b[9] ?? 0`.

`src/render.ts`:
5. `drawBomb` (render.ts:408): change signature to `drawBomb(ctx: CanvasRenderingContext2D, b: BombState, t: number, time: number, alpha = 1)` where `time` is game seconds; update the call site in `draw()` to pass `game.time`. Inside, after computing `x,y`:
```ts
const age = time - b.born
let fallY = 0, stretch = 1
if (age >= 0 && age < 0.18) {
  const k = 1 - age / 0.18
  fallY = -k * k * 44          // ease-out fall from 44px above
  stretch = 1 + k * 0.18       // slight vertical stretch while falling
}
```
Draw the ground shadow at `(0, 12)` (unchanged) and the body/ring/spark translated by `fallY` with `scale(pulse / stretch, pulse * stretch)`. (Existing bombs on the first snapshot have old `born` → `age ≥ 0.18` → no animation; kicked bombs keep `born` from placement.)
6. `drawFlames` (render.ts:478-508): import `FLAME_DURATION` from constants; per flame compute `const age = FLAME_DURATION / 1000 - f.ttl` and `const grow = Math.min(1, age / 0.05)`; multiply `size` by `grow`; when `age < 0.06` draw a white-hot core first: `ctx.globalAlpha = (1 - age / 0.06) * 0.9; ctx.fillStyle = '#fff'; ctx.arc(0, 0, 26 * grow, …)`.

`src/main.ts` / `index.html` (spec 33 pickup feedback):
7. HUD pip pulse is already implemented in Task 4 step 4.2 (bump on pips change) — no new work; verify the `bump` class covers the campaign pips row.
8. Battle HUD kill flash: when `view.players[i].kills` increases (track last values in `hudUpdate`), add the `bump` class to `#hud-player` (reuse Task 4 CSS).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx test/audit.ts && npx tsx test/smoke.ts && npx tsc --noEmit`
Expected: ALL PASS

- [ ] **Step 5: Verify visuals in browser**

Use the deterministic debug hooks: load `?start=battle&steps=30` (bomb active) and `?start=campaign&steps=40` — confirm via screenshot/inspection: new bombs drop in (not teleport), flames grow in ~50ms, match-end flash + confetti present on a forced `endBattle` (call `window.__game` handle from the console).
Expected: animations visible, no console errors.

- [ ] **Step 6: Commit**

```bash
git add src/game.ts src/netgame.ts src/render.ts src/main.ts test/audit.ts
git commit -m "feat: juice (bomb drop-in, flame growth + white core, hit-stops, match-end celebration, kill flash)"
```

---

### Task 7: Full verification + deploy

**Files:** none (verification only; `dist/` regenerated).

- [ ] **Step 7.1: Static + full test suite**

Run: `npx tsc --noEmit && npx tsx test/audit.ts && npx tsx test/smoke.ts && npx tsx test/clear.ts 6 60 && npx tsx test/battle-stats.ts && npx tsx test/termination.ts && npx tsx test/stuck.ts`
Expected: all pass, exit 0.

- [ ] **Step 7.2: Viewport/layout suite (in-app browser)**

At `npm run dev` (or built preview), run the 7-viewport simulation suite used for the iOS UI work, PLUS two forced-inset viewports: 844×390 and 852×393 landscape with `--safe-left/--safe-right: 47px`. For each: canvas fits, letterbox clusters outside the field (d-pad AND joystick modes), HUD above canvas, no element overlaps the play area.
Expected: all viewports clean.

- [ ] **Step 7.3: Online join race (2 tabs)**

Tab A: CREATE ROOM. Tab B: `?join=CODE` deep link → type nothing, press JOIN. Assert: zero console errors in tab B during join (the join-race fix), game renders within ~100ms, deep link pre-filled the code.
Expected: clean join, no exceptions.

- [ ] **Step 7.4: Post-match lifecycle (2 tabs)**

Play a short forced match (console: `window.__game.players[1].alive = false` + a kill, or wait for sudden death). Assert: battleover screens appear on both sides; no "CONNECTION LOST"/"OPPONENT LEFT" banner on either side; host console shows no further `sendState` traffic after match end (instrument `window.__net`); client stops rendering the remote view.
Expected: clean teardown.

- [ ] **Step 7.5: Initials Enter path**

Force a game-over high-score state (console or `?start=over` if available, else play), type initials, press Enter → score saved, input blurred, keyboard dismissed.
Expected: save works via Enter.

- [ ] **Step 7.6: Manual-device checklist (note in summary, do not block)**

On a real iPhone (user's device): two-finger d-pad steering, joystick second-finger immunity, pause button reachability, iOS keyboard over initials. List as "check on device" items in the final summary.

- [ ] **Step 7.7: Deploy + live check**

Run: `npm run deploy`
Then load `https://bomber.119-247-94-77.sslip.io` in the browser: title renders, `?start=campaign` plays, console clean.
Expected: live site updated, no console errors.

- [ ] **Step 7.8: Final commit + push**

```bash
git add -A
git commit -m "chore: verification pass"   # only if verification left artifacts
git push origin audit-fixes
```

Report to user (Cantonese): what was fixed per batch, test evidence, deploy URL, and the manual-device checklist.
