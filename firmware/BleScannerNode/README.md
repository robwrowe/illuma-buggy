# BleScannerNode — Disney BLE scanner relay

Forwards `ParsedDisneyPacket` structs to the logic board over **UART**.
Shares portable modules with `StrollerController/` via symlinks.

## Libraries

NimBLE-Arduino (h2zero) >= 2.0.0

## Arduino IDE settings

Classic ESP32 scanner (DevKitC-32 / ESP-32D):

- Board: **ESP32 Dev Module**
- Flash Size: match your chip
- Partition Scheme: default / Huge APP as needed

ESP32-S3 scanner variant: same as StrollerController for that hardware.

## Wiring (UART)

Cross-wire + common ground (no wireless pairing):

| Scanner | Logic (S3) |
|---------|------------|
| TX GPIO **17** | RX GPIO **18** |
| RX GPIO **16** | TX GPIO **17** |
| GND | GND |

Heartbeats every ~2s keep the logic board's link-alive timer fresh when Disney
air is quiet. Classified Disney packets are always forwarded.

Healthy session serial cues:

- Scanner: `[UART] forwarding scan packet #N …` / `[UART] heartbeat #N`
- Logic: `[UART] recv packet #N …` — amber status LED clears to green when link is alive

Logic board Dual-Board mode does **not** fall back to local NimBLE scan after
UART silence (protects phone BLE in parks). STANDALONE still uses local scan.

### Serial (@ 115200)

```
status
sniff [seconds]
scanlog on|off
help
```

## Symlinked modules (from StrollerController)

- Config.h, Types.h
- DisneyBleFilter, MbPacketDecode

Do not edit symlinks in-place; change the source under StrollerController.
