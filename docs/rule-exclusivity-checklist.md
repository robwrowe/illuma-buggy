# Rule exclusivity — bench checklist

Verify `ignoreLowerPriority` and `ignoreAllOtherRules` before relying on them in-park.

**Refs:** web Rule Editor flags · firmware `exclusiveActiveBlocksRule()` ·
[`mb-sw-test-checklist.md`](./mb-sw-test-checklist.md)

Lifecycle reminder (timed rules): **ON → DIP → FADE → COOLDOWN (black hold) → restore / IDLE**.
Exclusivity holds for the whole window until IDLE — including while the strip is black.

Exact re-match of the **active rule id** must still behave normally (ON slack, DIP/FADE re-apply,
COOLDOWN re-apply unless fixed cooldown mode).

---

## Setup

| Step | Detail |
|------|--------|
| Firmware | Logic board with exclusivity support flashed |
| Rules | Push three test rules via **📡 Board** (see table below) |
| Timing | Give each rule a short ON (~3–5 s) + short COOLDOWN (~2–3 s) so phases are visible |
| Logging | Serial open **or** Board modal → **Pull log** (filter `match` / `suppressed`) |
| Trigger | Wand Lab / WandSimulator packets that uniquely match each rule |

### Suggested rules

| Id | Priority | Flags | Match | Look |
|----|----------|-------|-------|------|
| `ex-high` | 0 | none | unique payload A | solid color A |
| `ex-mid` | 10 | **ignore lower** | unique payload B | solid color B |
| `ex-lock` | 20 | **ignore all other** | unique payload C | solid color C |
| `ex-low` | 30 | none | unique payload D | solid color D |

Lower priority number = runs first / higher precedence.

---

## Matrix

| # | Case | How | Pass |
|---|------|-----|------|
| E1 | Ignore-lower blocks worse prio | Fire `ex-mid`, while ON/COOLDOWN fire `ex-low` | Strip stays on mid; log `suppressed` for low; no apply of low |
| E2 | Ignore-lower allows better prio | Fire `ex-mid`, while ON fire `ex-high` | High preempts / applies; mid exclusivity does not block higher prio |
| E3 | Ignore-all blocks any other | Fire `ex-lock`, while ON fire `ex-high` then `ex-low` | Both suppressed; strip stays on lock look |
| E4 | Exact re-match still works | Fire `ex-lock`, re-send **same** lock payload during ON | Slack extends (no full rebuild spam); during DIP/FADE/COOLDOWN re-apply restores effect |
| E5 | Black hold still exclusive | Fire `ex-lock`, wait until black COOLDOWN, fire `ex-high` | Still suppressed until restore/IDLE; strip may be black |
| E6 | After IDLE, others fire | Complete lock lifecycle to IDLE, then fire `ex-high` | High applies normally |
| E7 | Disable active exclusive rule | Fire `ex-lock`, disable via `set_rule_enabled` / Settings | Forces restore; exclusivity clears; other rules can fire |
| E8 | Same payload, different rule | If two rules could match one packet, ensure exclusivity uses **winning** match id vs active id | Suppressed when ids differ; never blocks same active id |

---

## Log grepping

Serial / SD / BLE pull events:

- `match` — rule accepted for apply
- `suppressed` — exclusivity blocked a different rule (`active`, `matched`)
- `marker` — phone/web log marker
- `lifecycle` — phase transitions

Example pull (web): **📡 Board → Pull log**, allow-list `suppressed,match,marker`.

App (when wired): `{"type":"get_rule_log","limit":50,"events":["suppressed","match"]}` → chunked `rule_log` → `rule_log_done`.

---

## Sign-off

| # | Pass? | Notes |
|---|-------|-------|
| E1 | | |
| E2 | | |
| E3 | | |
| E4 | | |
| E5 | | |
| E6 | | |
| E7 | | |
| E8 | | |
