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
3. Logic board sends reflected ESP-NOW pair message; scanner stores `pairedLogicMac` and stops advertising.

Manual fallback on scanner serial @ 115200:

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
