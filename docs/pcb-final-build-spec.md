# Final Build Spec: Illuma Buggy PCB — UART, OLED, SD, Power, ESP-NOW Removal

Authoritative consolidated build spec for the combined PCB + firmware/app work.
**Full protocol snippets, pin tables, and verification checklists** live in the
session document that produced this file; this copy is the repo index and build
order. Implementation status is tracked below.

**Scope boundary:** WLED/GLEDOPTO stays on its own board over WiFi HTTP.

---

## Pin assignment (provisional — datasheet-verify before PCB)

| Function | GPIO | Board(s) |
|---|---|---|
| UART1 TX | 17 | Both |
| UART1 RX | **18** (logic) / **16** (classic scanner) | Crossed + common GND |
| SD CS / SCK / MOSI / MISO | 10 / 12 / 11 / 13 | Both (S3; skipped on classic) |
| I2C SDA / SCL (OLED) | 21 / **47** | Logic only |
| Status RGB | **38** | Logic DevKitC-1 v1.3 |
| Power in | `5V`/`VIN` | Both |

UART is the only scanner↔logic link (ESP-NOW removed in Part 3). SD init is
non-fatal — UART/OLED can be tested with no card.

---

## Build order & implementation status

### Hardware / firmware (Parts 1–6)

| Part | Topic | Status |
|---|---|---|
| 1 | Shared USB-C power | Hardware — not coded |
| 2 | UART inter-board link | **Implemented** (`UartLink.h`, both boards) |
| 3 | Remove ESP-NOW | **Done** (UART-only; no local-scan fallback on logic) |
| 4 | SD logging (both boards) | **Implemented** (`SdRawLogger`, `SdRuleLogger`) |
| 5 | OLED status (logic) | **Implemented** (`StatusDisplay` + Adafruit SSD1306) |
| 6 | `set_field` / `list_fields` | **Implemented** (`RuntimeFields`) |

### Software / protocol (Parts 7–13)

| Part | Topic | Status |
|---|---|---|
| 7 | `set_rule_enabled` / `list_rules` | **Implemented** |
| 8 | `set_segment_field` / `list_segments` | **Implemented** (+ skip `enabled:false` in seed) |
| 9 | Embedded rules (`embed_rules.py`) | **Implemented** (seed + `forceOverride`) |
| 10 | Preset-over-segment precedence | **Implemented** (web already correct; app fixed) |
| 11 | Rules-cache deserialize fix | **Implemented** (scratch doc + retry + `cacheApplied`) |
| 12 | BLE connection hardening | **Implemented** (MTU 247, preferred params, MTU log) |
| 13 | Park Mode (app) | **Implemented** (toggle, hide setup tabs, skip bootstrap push, disconnect) |

---

## Key files

- `firmware/StrollerController/UartLink.h` + `firmware/BleScannerNode/UartLink.h`
- `firmware/StrollerController/RuntimeFields.{h,cpp}`
- `firmware/StrollerController/StatusDisplay.{h,cpp}`
- `firmware/StrollerController/SdRuleLogger.{h,cpp}`
- `firmware/BleScannerNode/SdRawLogger.{h,cpp}`
- `firmware/StrollerController/EmbeddedRules.h` (generated)
- `scripts/embed_rules.py` — run before flash if `embedded_rules.json` changed
- [rules-psram-runbook.md](./rules-psram-runbook.md) — how to BLE-push or embed/flash rules
- `docs/README.md` — links here

### Libraries to install (Arduino Library Manager)

See `firmware/StrollerController/LIBRARIES.txt` — now includes Adafruit SSD1306 + GFX.
SD/SPI/Wire are core.

### Bench notes

1. Wire UART cross-over: **scanner TX17 → logic RX18**, **logic TX17 → scanner RX16**, shared GND.
2. Flash both boards (UART always on for dual-board; no `USE_UART_SCANNER_LINK` flag).
3. Confirm `[UART] forwarding` / `[UART] recv` / heartbeat serial lines under WandSimulator traffic.
4. Logic board in Dual-Board mode must **not** start local Disney NimBLE scan when UART is silent — link lost only (protects phone BLE).

| Color | Scanner meaning |
|---|---|
| Blue blink | Boot (~3s) |
| Amber slow | Quiet — no recent Disney / forward |
| Cyan blink | Disney seen, no recent UART forward |
| Green solid | Recently forwarded packets |

| Color | Logic (dual-board) meaning |
|---|---|
| Amber fast | UART silent / waiting for scanner |
| Green solid | UART link alive (packets or heartbeats) |
