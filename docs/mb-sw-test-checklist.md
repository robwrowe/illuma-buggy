# MagicBand+ & Starlight Wand — Test Checklist

Bench and in-park verification for Illuma Buggy BLE → WLED behavior.

**References:** [disney-ble-protocol.md](./disney-ble-protocol.md) · [starlight-wand-codes.md](./starlight-wand-codes.md) · [firmware/WandSimulator/README.md](../firmware/WandSimulator/README.md)

---

## Before you start

| Step | Check |
|------|--------|
| Firmware | Latest `StrollerController.ino` flashed to logic board |
| WLED | GLEDOPTO on `StrollerNet`, reachable at `4.3.2.1`, master power on |
| WiFi | Logic board serial shows WiFi connected |
| BLE | App connected **or** web tool **📡 Board** sync completed |
| Mapping | Settings → map SW animations + MB animations/patterns to presets (or confirm built-in fallbacks) |
| Timeouts | Set **MB+ auto-clear** and **SW auto-clear** (web Settings → BLE device settings, or app Settings). Push to board — stored value on ESP32 wins until re-synced |
| Simulator | Second ESP32 with `WandSimulator.ino` @ 115200, within 0.5–2 m of stroller |
| Logging | App Home event feed **or** StrollerController serial monitor open |

### Timeout test setup

1. Set **MB+ auto-clear** to **15** sec (web or app).
2. **📡 Board** sync (web) or reconnect app (pushes `mb_config`).
3. Confirm on connect: status shows `mb_timeout_ms: 15000` (app) or serial `[MB] Timeout after 15000ms` after idle.
4. Trigger `mb red`, wait **without** sending another command — strip should restore ~15 s later; app shows `MB+: timeout`.
5. Repeat: trigger again, then trigger a **second** command at 10 s — timer should **reset** (full 15 s from second command).

---

## Priority & override behavior

Test that higher-priority sources win and timeouts restore the previous zone/preset state.

| # | Test | How | Pass criteria |
|---|------|-----|---------------|
| P1 | Starlight > MagicBand+ | SW enabled + MB enabled. `sw fx sparkle` then `mb red` within 5 s | Sparkle preset stays (SW wins) |
| P2 | MB+ when SW off | Disable Starlight on board, sync. `sw fx sparkle` | No stroller change (or `sw_event: disabled`) |
| P3 | MB+ when SW on, unmatched E9 | `mb red` (E905, not a named SW fx) | MB color/chase applies |
| P4 | Zone vs override | Enter a GPS zone while MB effect active | Per **Override kill on zone** setting |
| P5 | Manual preset vs BLE | Apply preset from app, then `mb blue` | MB override; clears on timeout |
| P6 | Timeout restore | Any BLE effect, wait full timeout | Strip returns to pre-override state; `ble_event` / `sw_event: timeout` |
| P7 | Timeout reset | `mb red`, wait 10 s, `mb cyan`, wait 15 s from **second** command | Clears ~15 s after cyan, not 5 s after first |

---

## Starlight Wand — color cast (CF0B / CF9B)

Requires **Starlight Wand enabled**. Map **Color cast** under SW Animations if using a custom preset.

| # | Command / action | Pass criteria |
|---|------------------|---------------|
| SW-C1 | `sw cast red` or `cast 21` | Serial `[Wand] CAST palette=21`, `sw_color` in app, strip changes |
| SW-C2 | `sw cast cyan` (palette 0) | Correct hue on full strip |
| SW-C3 | `legacy red` (CF9B) | Same as cast — legacy path works |
| SW-C4 | Physical wand button cast | `sniff 30` on stroller serial, then cast at stroller | `[Scan:WAND-CAST]` + color |
| SW-C5 | `idle` / wand powered on | `[Scan:WAND-IDLE]` only — **no** WLED change |
| SW-C6 | Dedupe | Hold cast / rapid repeat | One effect per press (no flicker storm) |
| SW-C7 | Custom preset | Map **Color cast** to a chase/sparkle preset, sync, `sw cast blue` | Preset runs, not flat solid |

---

## Starlight Wand — named animations (SW priority)

Map each under **Settings → Starlight Wand → Preset**. Test with **Starlight on**, **MB+ on** (SW should still win on fingerprint match).

| # | WandSimulator | Packet | Pass criteria |
|---|---------------|--------|---------------|
| SW-A1 | `sw fx rainbow` | E90C | Mapped preset or built-in rainbow chase |
| SW-A2 | `sw fx blink` | E90C (white blink signature) | Distinct from rainbow — white blink behavior |
| SW-A3 | `sw fx palette5` | E90C (five-palette cycle) | Five-color cycle |
| SW-A4 | `sw fx flash` | E90E | Flash preset / fallback |
| SW-A5 | `sw fx sparkle` | E910 | Sparkle + app `sw_event: fx (sparkle)` if firmware sends name |
| SW-A6 | `sw fx pulse` | E913 | Pulse animation |
| SW-A7 | `sw fx circle` | E912 | Circle animation |
| SW-A8 | `sw fx fade` | E911 (cyan→pink signature) | Fade variant 1 |
| SW-A9 | `sw fx fade2` | E911 (pink→green signature) | Different from fade |
| SW-A10 | `swfxloop` | Cycles all | Each animation distinguishable on strip |
| SW-A11 | `sw combo blue pulse` | Cast + E913 | Color cast then pulse sequence |

---

## Starlight Wand — E9 color & pattern (guest commands)

These use the **MB command path** but work on wands. With Starlight on, E90x **animations** still prefer SW mapping; E905/E909 use MB mapping / built-ins.

| # | Command | Opcode | Pass criteria |
|---|---------|--------|---------------|
| SW-E1 | `sw solid red` | E905 | Full-strip solid red |
| SW-E2 | `sw solid cyan` | E905 | Palette 0 |
| SW-E3 | `sw pattern spin red` | E909 pattern `3` | Pattern mapping or segment layout |
| SW-E4 | `sw pattern solid blue` | E909 pattern `4` | Solid pattern |
| SW-E5 | `sw pattern corners green` | E909 pattern `8` | Corner emphasis |
| SW-E6 | `sw pattern all yellow` | E909 pattern `B` | All segments on |

Pattern keys in mapping: `3` spin, `4` solid, `5` all on, `8` corners, `B` all palette B.

---

## MagicBand+ — single & multi color

Requires **MagicBand+ enabled**. Disable Starlight for isolated MB tests, or use commands that are not SW fingerprinted.

| # | Command | Opcode | Pass criteria |
|---|---------|--------|---------------|
| MB-C1 | `ping` then `mb red` | CC03 + E905 | `[Scan:MB+]`, `[MB+] func=0xE905`, strip red |
| MB-C2 | `mb cyan` | E905 | Palette 0 |
| MB-C3 | `mb 21` | E905 | Palette index 21 (red) |
| MB-C4 | `mb dual 21 0` | E906 | Inner/outer colors (full-strip mapping on stroller) |
| MB-C5 | `mb rgb 63 0 0` | E908 | Raw RGB red |
| MB-C6 | `mb five 0 2 21 8 19` | E909 | Five palette slots on strip |
| MB-C7 | `mb rainbow` | E909 preset | Corner rainbow layout |
| MB-C8 | `mb red mask 1` | E905 masked | Segment/band mapping if configured |
| MB-C9 | `mbsweep` | E905 loop | Cycles palettes — good for two physical bands |
| MB-C10 | `mbloop red` / `stop` | Loop | Repeats until stop |

### Palette color sanity (spot-check)

Pick a few indices from the 32-color table; confirm strip matches **Settings → MB → WLED Colors** mapping:

| Indices to test | Names |
|-----------------|-------|
| 0, 2, 21 | cyan, blue, red |
| 8, 18 | pink, lime |
| 27, 29 | white, off/black |

---

## MagicBand+ — show / animation opcodes

Map under **MB Animations → Preset**. Test with Starlight **disabled** first, then confirm SW **priority** when both enabled.

| # | Command / source | Opcode | Mapping key |
|---|------------------|--------|-------------|
| MB-A1 | `sw fx rainbow` (MB path) | E90C | E90C / SW `rainbow` |
| MB-A2 | Park-style flash | E90E | E90E / SW `flash` |
| MB-A3 | Animation F | E90F | E90F (MB only — no SW fingerprint) |
| MB-A4 | `sw fx sparkle` | E910 | E910 |
| MB-A5 | `sw fx fade` / `fade2` | E911 | E911 |
| MB-A6 | `sw fx circle` | E912 | E912 |
| MB-A7 | `sw fx pulse` | E913 | E913 |

---

## MB segment mapping (optional)

If using custom **MB Segments → WLED Segments** layout:

| # | Test | Pass criteria |
|---|------|---------------|
| S1 | Settings → segment **Test** button per region | Black + white highlight on correct LED % range |
| S2 | **Preview 5 corners** | R/G/B/W/Y regions visible |
| S3 | `mb five 0 2 21 8 19` with custom layout | Colors land in mapped segments |

---

## App & web integration

| # | Test | Pass criteria |
|---|------|---------------|
| I1 | App connect | `mb_timeout_ms`, `sw_timeout_ms` match settings |
| I2 | Web **📡 Board** | All presets + `mb_mapping_config` + timeouts pushed |
| I3 | Home event feed | `MB+ color`, `Wand: …`, `MB+: timeout` appear |
| I4 | Override indicator | Shows Starlight / MagicBand+ / Zone / Manual |
| I5 | Export / import JSON | `magicBandTimeoutSec`, `mbMapping`, `swAnimations` preserved |
| I6 | Custom palette presets | Palettes synced to WLED (**↑ WLED**), preset test shows correct colors |

---

## Physical in-park (when available)

| # | Scenario | Notes |
|---|----------|-------|
| PK1 | Guest MB+ interaction | E905/E909 from own band |
| PK2 | Parade / show E9 | Direct `E9 xx` infrastructure packets |
| PK3 | Starlight wand cast | Real CF0B at stroller |
| PK4 | Wand park FX button | Capture with `sniff 30` if unknown |
| PK5 | Zone entry during show | Override kill behavior |
| PK6 | Indoor zone brightness | Unrelated but often tested same trip |

---

## Known limitations (not failures)

- **Wand cast (CF0B)** carries **palette index only** — tube animation on the wand is local; stroller mirrors color or your mapped preset.
- **Vibration** (band buzz) is not replicated on the stroller.
- **E90F** and some park-only payloads may only have built-in fallback until captured and mapped.
- **Five-point mode** flag is retained in NVS; stroller uses full-width chase for MB colors unless segment mapping overrides.
- **CC03 ping** is logged but does not change WLED by itself.

---

## Quick smoke test (~5 min)

```
ping
sw cast red          → wand color, timeout resets
sw fx sparkle        → SW animation
mb cyan              → MB color (if SW not blocking)
sw fx rainbow        → SW wins over MB mapping
(wait timeout)       → restore + timeout event
```

Mark date, firmware version, and any failures in your trip notes.
