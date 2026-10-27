# Tekken Web Netplay — Regression & Failure Log

This log records major past bugs, regressions, and root causes to prevent repeating previous mistakes. Every developer or AI agent modifying `web/multiplayer.js` or related netplay components must review these invariants before writing code.

---

### Incident 1: 10-Frame Barrier Drop (Guest Stuck in `AWAITING HOST`)
- **Symptoms:** Host enters fight, knocks down opponent, finishes round. Guest is stuck with badge `READY... AWAITING HOST`, never moves, and Anna remains standing idle.
- **Root Cause:** Host only broadcast `start_fight` during `fightFrame <= 10` (~160ms). If Guest took slightly longer to load the stage, Guest missed the window and Host stopped sending `start_fight` forever.
- **Rule / Invariant:** Host must continuously heartbeat `start_fight` (every 15 frames) until Guest explicitly acknowledges receipt via `fight_ack`.

---

### Incident 2: Rigid Gatekeeper Dropping 100% of Combat Sync
- **Symptoms:** Host sends 60Hz camera and 4Hz full-actor sync (`combat_sync`), but Guest state never updates.
- **Root Cause:** `applyCombatSync(data)` had the guard:
  ```javascript
  if (!this.fightActive || this.screen !== 8) return;
  ```
  If Guest missed the initial `start_fight` trigger, `fightActive` remained `false`. As a result, every recovery state packet was discarded.
- **Rule / Invariant:** Systems must self-heal through state reconciliation. If Guest receives active combat data (`combat_sync` or `frame_input`) while on Screen 8, Guest must auto-promote itself to `startFight()`, align its frame counter, and apply the authoritative state.

---

### Incident 3: Round Start PRNG Seed Divergence
- **Symptoms:** Inputs are sent identically, but characters randomly perform different moves, camera rolls to different angles, or hitboxes diverge.
- **Root Cause:** Tekken 3's engine uses PSX PRNG state at `0x800a39b8` (`PSX_RNG_SEED_OFFSET = 0x0a39b8`). When a round starts, both instances must have identical PRNG state seed; otherwise, subsequent frame calculations diverge independently.
- **Rule / Invariant:** Host must read and synchronize `0x0a39b8` in `start_fight` and `combat_sync`, and Guest must clamp its local PRNG seed to Host.

---

### Incident 4: Screen Transition Disconnect (Post-Match Freeze)
- **Symptoms:** Host returns to Screen 9 (`VS BATTLE SELECT`), but Guest remains stuck in Screen 8 with remaining time on clock.
- **Rule / Invariant:** Screen state transitions (e.g. Screen 8 -> Screen 13 Match Results -> Screen 9 Fighter Select) must be synchronized between peers so neither side is stranded in combat mode.
