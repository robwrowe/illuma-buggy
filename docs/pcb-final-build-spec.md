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

Compile flag: `USE_UART_SCANNER_LINK` (currently `1` in `Config.h` for UART bench).
Set to `0` to fall back to ESP-NOW. **Part 3 deletes ESP-NOW only after UART is
field-proven.** SD init is non-fatal — UART/OLED can be tested with no card.

---

## Build order & implementation status

### Hardware / firmware (Parts 1–6)

| Part | Topic | Status |
|---|---|---|
| 1 | Shared USB-C power | Hardware — not coded |
| 2 | UART inter-board link | **Implemented** (`UartLink.h`, both boards; default on) |
| 3 | Remove ESP-NOW | **Deferred** until Part 2 field-proven |
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

1. Wire UART cross-over: Logic TX17↔Scanner RX8, Logic RX8↔Scanner TX17, shared GND.
2. Flash both boards with `USE_UART_SCANNER_LINK=1` (default).
3. Confirm `[UART] forwarding` / `[UART] recv` serial lines under WandSimulator traffic.
4. Keep ESP-NOW code until Part 3 — do not delete yet.
| Color | Scanner meaning |
|---|---|
| Blue blink | Boot (~3s) |
| Amber fast | ESP-NOW unpaired (UART mode skips this) |
| Amber slow | Quiet — no recent Disney / forward |
| Cyan blink | Disney seen, not forwarding (e.g. unpaired ESP-NOW) |
| Green solid | Recently forwarded packets |
