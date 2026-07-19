# BleScannerNode — Disney BLE scanner relay (ESP32-S3)

Forwards `ParsedDisneyPacket` structs to the logic board over ESP-NOW.
Shares portable modules with `StrollerController/` via symlinks.

## Libraries

NimBLE-Arduino (h2zero) >= 2.0.0

## Arduino IDE settings

Same as StrollerController on this hardware:

- Board: **ESP32S3 Dev Module**
- Flash Size: **4MB (32Mb)** (match your chip probe at boot)
- Partition Scheme: **Huge APP (3MB No OTA/1MB SPIFFS)**
- PSRAM: OPI PSRAM if present

## Pairing

1. Flash scanner node — it advertises as `IllumaScan` (manufacturer data `49 53` + MAC) until paired.
2. On logic board (Dual-Board mode): use app discovery or `set_scanner_mac` with scanner MAC.
3. Logic board re-sends a reflected ESP-NOW pair message (its MAC + **Wi-Fi channel**) for ~8s.
   While unpaired the scanner **sweeps Wi-Fi channels** (1–13) so it catches that message
   regardless of the router/AP channel, then locks onto the logic board's channel, persists
   `pairedLogicMac` + `pairedChan` to NVS, and stops advertising.

ESP-NOW only works when both radios share a Wi-Fi channel. The logic board follows its AP's
channel (STA); the scanner has no AP, so it locks onto the channel from the pair message and
restores it on boot. Caveat: if the AP uses auto-channel and later changes, re-pair (or pin
the AP to a fixed channel).

### Scanner-alive keepalives

Classified Disney packets (`MB+`, wand casts, etc.) are always forwarded. Unclassified frames
tagged `[Scan:DISNEY]` / `PING` / `WAND-IDLE` decode as `UNKNOWN` — these are still forwarded
(rate-limited ~2s) with raw payload so the logic board's scanner-alive watchdog advances.
Without that, pairing beacons alone leave `lastScannerPacketMs` at 0 and the logic board
falls back to local BLE scan (re-introducing NimBLE contention).

Healthy session serial cues:

- Scanner: `[ESP-NOW] forwarding scan packet #N …` then `send cb: SUCCESS`
- Logic: `[ESP-NOW] recv from … type=scan` — **no** `[Fallback] Scanner silent`

Manual fallback on scanner serial @ 115200 (note: manual `pair` does not carry a channel —
use app discovery so the channel is synced):

```
pair AA:BB:CC:DD:EE:FF
status
help
```

Clear pairing: `unpair`

## Symlinked modules (from StrollerController)

- Config.h, Types.h
- DisneyBleFilter, MbPacketDecode

Do not edit symlinks in-place; change the source under StrollerController.
