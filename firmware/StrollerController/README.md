# StrollerController — Logic board

ESP32-S3 logic board firmware. Runs the MB rule engine, BLE peripheral (app link), WiFi
station to the WLED LED controller, and (in dual-board mode) receives scanner events over
UART. See [`PROTOCOL.md`](./PROTOCOL.md) for the app ↔ board BLE protocol and
[`../../docs/pcb-final-build-spec.md`](../../docs/pcb-final-build-spec.md) for the dual-board
build spec.

## Arduino IDE settings

- Board: **ESP32S3 Dev Module**
- PSRAM: **OPI PSRAM**
- CPU Frequency: **240 MHz**
- Flash Size: **16MB** (N16R8)

## Status LED

Onboard RGB status LED, GPIO 38 (DevKitC-1 v1.3/v1.1; also pulses GPIO 48 in case of a
v1.0 board). Reflects `HAS_STATUS_NEOPIXEL` in `Config.h` — soft-disabled if the board
variant doesn't have one.

| Color | Pattern | Meaning |
|-------|---------|---------|
| Blue | Blink (~0.8 Hz / 600 ms) | WiFi down — not connected to the GLEDOPTO AP |
| Magenta | Blink (fast / 400 ms) | WiFi connected, but WLED HTTP is unreachable |
| Amber | Blink (fast / 125 ms) | Dual-board mode: UART link to scanner is silent — waiting for packets/heartbeats |
| Green | Solid | Dual-board mode: UART link alive (recent scanner packets or heartbeats) |
| Dim green | Solid | Standalone mode (no scanner board) — expected steady state, not an error |

There is no local-BLE-scan fallback state — in dual-board mode, if the UART link goes
silent, the board simply reports "link wait" (amber) and waits; it never falls back to
scanning for Disney packets itself, to protect the phone BLE connection's radio time.
Only `STANDALONE` role runs a local scan.

Source of truth: `StatusLed.cpp` (`computeState()` / `statusLedTick()`) — re-check there
if this table and firmware ever disagree.

## Related

- [`PROTOCOL.md`](./PROTOCOL.md) — app ↔ board BLE protocol
- [`../BleScannerNode/README.md`](../BleScannerNode/README.md) — scanner board wiring, status LED/OLED, and UART link behavior from the other side
- [`../../docs/pcb-final-build-spec.md`](../../docs/pcb-final-build-spec.md) — pin maps, UART framing, dual-board build order
