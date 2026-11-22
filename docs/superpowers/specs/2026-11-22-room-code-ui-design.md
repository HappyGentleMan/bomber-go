# Room-code UI design (short)

**Intent.** The room code is the hero of the online screen. Research consensus
(Among Us / Fortnite / party-game lobbies, UX write-ups): never bury the join
code in debug text; make it large, centered, readable across a room; pair it
with a copy button that confirms visibly. User feedback: the code was crammed
into a small status hint and "not obvious"; the 25-second "turn off iCloud
Private Relay" troubleshooting hint is dead weight now that the self-hosted
Mac TURN relay (coturn @ 119.247.94.77) covers cross-network joins.

**Approaches considered.**
- A — big mono text code (Among Us style): classic, simplest.
- B — letter tiles (one letter per neon box): most arcade, easiest to read
  across a room, zero misread risk. **Chosen** (user-approved direction).

**Design.**
- Host mode (after CREATE ROOM): panel shows a "SHARE THIS CODE" label, five
  letter tiles (58px, neon border + glow, mono 32px), a primary COPY CODE
  button (label flips to "COPIED ✓" for 1.5 s), and a status line that only
  ever shows state: "WAITING FOR OPPONENT…" → "OPPONENT CONNECTED — FIGHT!".
  The join input row is hidden.
- Join mode (default / JOIN WITH CODE / `?join=` deep link): the existing
  input row (unchanged behavior), tiles hidden.
- The 25 s `hostWaitHint` timer and its Cantonese relay-troubleshooting text
  are removed entirely.

**Non-goals.** No QR code, no protocol/code-length changes, no join-flow
behavior changes (validation, 20 s timeout, error surfacing all stay).

**Files.** `index.html` (panel HTML + tile CSS), `src/ui.ts`
(`showRoomCode`, `setRoomTiles`, drop `showOnlineCopy`), `src/main.ts`
(`hostOnline`, `leaveNet`, copy confirmation, deep link).
