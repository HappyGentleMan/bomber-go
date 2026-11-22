# Bomber Go — Audit Findings (verified spec)

Every finding below was verified against the code at HEAD `0101434` (line numbers as of that commit).
Scope: all bugs found in the 2026-11-22 full audit + UI/controls/aesthetics improvements + research-backed juice.

## Critical (breaks play)

1. **Join-race crash.** `net.onOpen` (main.ts:260-266) sets `remote = new RemoteGame()` (`players=[]`, `grid=[]`, `mode='battle'`, netgame.ts:58-80) and `appState='playing'`. The loop (main.ts:635-638) renders `remote` and `hudUpdate(remote)` (main.ts:519 `const p = view.players[0]`, :537 `p.kills`) on the very next frame, before the first snapshot → uncaught TypeError on every join. Self-heals ~50ms later.
2. **Room-code Enter hijack.** `#online-code` sits on the `online` screen which is in `inMenu` (main.ts:573); `onKeyDown` (input.ts:45-64) has no `activeElement` guard, so Enter in the code box fires `menuNav('ok')` on menu item 0 = `CREATE ROOM` (index.html:401) → a joiner silently becomes a host.
3. **D-pad overlaps the field in landscape on notched iPhones.** `fit()` (main.ts:131-138) budgets the side letterbox as `need = max(moveW,170)+16` without safe-area insets; `layoutTouch()` (main.ts:92-102) then pushes the cluster in by `safeL/safeR` (≈47px). D-pad (200px) overhangs the canvas 23–37px (844×390: d-pad spans x 55–255, canvas starts x 219) and steals touches. Joystick mode is not affected.
4. **High-score initials trapped under the iOS keyboard.** Auto-focus at 100ms (ui.ts:193-195); centered overlay; SAVE/MENU land below the keyboard; Return does nothing.
5. **Settings/Scores clip on small phones; BACK unreachable** in phone landscape — `.overlay` has no `overflow-y:auto` (index.html:47-56).

## Important (wrong behavior)

6. **Screen-Shake setting does nothing.** Toggle persists `settings.shake` (ui.ts:35-39) but `getShakeOffset()` (game.ts:1104) never reads it.
7. **Post-match state leak.** `battleover` (main.ts:354-366 host, :299-307 client) sets `appState='title'` but never `leaveNet()`; host keeps simulating + broadcasting the dead game at 30Hz forever (loop main.ts:576, 590); client keeps rendering a stale `remote` behind the title.
8. **Sudden-death kills credited to the survivor.** `killPlayer` (game.ts:465) checks `bombs.some(b => b.owner === -1)`, but the sudden bomb is spliced out by `detonate()` (game.ts:816-818) the same tick before `updateFlames` kills (order at game.ts:1061-1065) → survivor always gets +1000 + "KILL!".
9. **Attract restart timer hijacks fresh games.** `setTimeout(startAttract, 1500)` (main.ts:356) is never cleared; starting a game within 1.5s of an attract battle-over yanks it back to the title.
10. **Join hangs forever when offline.** `join()` (net.ts:101-105) swallows `'network'` peer errors (host path surfaces them, net.ts:79-83) and has no timeout.
11. **2P LOCAL is a dead end on touch phones.** P2 has no controls (touch binds P1 only, main.ts:457-462) and no warning.
12. **Two-finger d-pad movement broken.** All four d-pad buttons share one `touchDir`; any button's `touchend` clears it (main.ts:446-448).
13. **Client never sees round winners.** `diffSnapshots` (netgame.ts:196-199) returns `roundWin=-1` on round restart; the client banner branch (main.ts:298-299) is dead code.
14. **Battle drops can include `life`.** `weightedPowerupKind()` (game.ts:765-773) includes `life` (constants.ts:80-83); battle has no life system → "EXTRA LIFE!" is a visible lie.
15. **Keyboard "ok" on Settings/Scores clicks a stale hidden title button.** `setMenu` only runs for title/battle/online (ui.ts:90-93); `menuScreen` stays `#menu-main`.
16. **Joystick ignores `pointerId`.** A second finger on the base retargets the knob (main.ts:489-499).

## Minor

17. Same-tick double detonation of a chained bomb: `detonate()` continues after `indexOf === -1` (game.ts:780 + 816-818) → duplicate flames/particles/shake/score.
18. `respawnPlayer` (game.ts:488-496) never clears `frozenUntil` (stunned respawn) and never checks the spawn tile for a live bomb (2.6s trapped).
19. Stunned battle player can still place/detonate bombs (game.ts:245-253).
20. One-shot bomb/detonate input edges can be lost to out-of-order delivery (main.ts:608-609, 279) — rare, player can re-press.
21. Host can pause an online match, freezing the client with no notification (main.ts:648).
22. Battle periodic drops ignore `MAX_POWERUPS_ON_FIELD` (game.ts:1037-1052).
23. iOS PWA install broken: no `apple-touch-icon`, no apple meta tags, SVG-only manifest icons (index.html:8-10).
24. Long banners clip ("PLAYER 2 TAKES THE ROUND!" at clamp(28px,5vw,52px) needs ~600-900px; stage is ~390-410px wide) — `#banner` in overflow-hidden stage (index.html:206-214).
25. AI "reverse direction" is the perpendicular: `DIRS=[right,left,down,up]` (constants.ts:71-78) so `(dir+2)%4` ≠ opposite (opposite is `dir^1`); 3 sites: game.ts:621, 1856, 1933.
26. Empty `LV` HUD chip in battle (ui.ts:157); `#hud-player` innerHTML re-parsed every frame (ui.ts:161); banner timeouts untracked (ui.ts:144-149).
27. Level-clear auto-advances at 2.2s with no continue control and keeps touch controls visible (game.ts:440).
28. Room code is read-only: no copy button, no deep link (main.ts:228, index.html:410).
29. Pause button sits 12px above BOMB in the action cluster — thumb drift risk (index.html:427-433).
30. Attract-mode SFX play behind the menu (game.ts:270, 823) — acceptable ambience, leave as-is.

## Juice (research-backed game-feel, infra already present)

31. Bomb teleports into existence (render.ts:408) → drop-in + squash.
32. Flames appear full-size in one frame (render.ts:478-508) → ~50ms growth + white-hot core; hit-stop for power ≥ 4.
33. Powerup pickup: HUD pips change silently (main.ts:530-533) → pulse changed pips.
34. Taking a hit: 0.08s pink flash is easy to miss on phones (game.ts:470) → hit-stop + HUD heart flash.
35. Round/match win is the least juiced moment (main.ts:344-349) → winner-color flash + confetti + hit-stop on the killing blow.

## Verified sound (do NOT change)

- Netcode core: absolute snapshots + seq stale-drop = best practice for unreliable/unordered WebRTC channels.
- Interpolation + 1.25× extrapolation cap + teleport-snap; client audio/haptics from snapshot diffs.
- iOS audio unlock; blur/visibility auto-pause; pre-rendered sprites + dpr backing store; safe-area handling in portrait.
