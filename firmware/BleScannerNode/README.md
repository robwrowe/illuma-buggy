# BleScannerNode — Disney BLE scanner relay

Forwards `ParsedDisneyPacket` structs to the logic board over **UART**.
Shares portable modules with `StrollerController/` via symlinks.

## Libraries

- NimBLE-Arduino (h2zero) >= 2.0.0
- Adafruit SSD1306 >= 2.5.0 (optional status OLED)
- Adafruit GFX >= 1.11.0

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
air is quiet. Logic **replies** to those heartbeats so the scanner can show
`Link:OK` on its OLED. Classified Disney packets are always forwarded.

Healthy session serial cues:

- Scanner: `[UART] forwarding scan packet #N …` / `[UART] heartbeat #N`
- Logic: `[UART] recv packet #N …` — amber status LED clears to green when link is alive
- Scanner OLED: `Link:OK` within a few seconds of heartbeats (needs RX wired)

Logic board Dual-Board mode does **not** fall back to local NimBLE scan after
UART silence (protects phone BLE in parks). STANDALONE still uses local scan.

## Wiring (OLED — optional, classic ESP32)

128×64 SSD1306 I2C (soft-fail if absent):

| OLED | Scanner |
|------|---------|
| SDA | GPIO **21** |
| SCL | GPIO **22** |
| VCC | **3.3V** |
| GND | GND |

Address **0x3C** (fallback **0x3D**). Do not reuse UART 16/17 or SD 5/18/23/19.

Display layout: `Link` + `SD`, then `Heap` + `pps`, then a rolling list of
post-`8301` hex (up to 16 chars) with RSSI in the last 5 columns.

## Wiring (SD — optional)

| SD | Scanner (classic) |
|----|-------------------|
| CS | GPIO **5** |
| SCK | GPIO **18** |
| MOSI | GPIO **23** |
| MISO | GPIO **19** |

FAT32 microSD; soft-fail if missing. Logs to `/scan_<millis>.jsonl` (new file each boot).

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
- UartLink.h

Do not edit symlinks in-place; change the source under StrollerController.
