# WandSimulator

ESP32 sketch that **broadcasts** Disney BLE manufacturer packets for bench and
in-home testing. IllumaBuggy (StrollerController) is the **receiver** for
stroller LEDs; **physical MagicBand+ bands** also listen to the same packets
in the parks.

Protocol builders match [Adafruit `magicband_protocol.py`](https://github.com/adafruit/Adafruit_Learning_System_Guides/blob/main/CLUE_BLE_Beacon_Remote/magicband_protocol.py).

**Connecting a client (web tool, script, agent)?** See [API.md](API.md) for
the full HTTP + Serial contract — endpoint shapes, the company-ID byte-prefix
rules, and batch/show playback for replaying a captured parade or fireworks
show.

## Setup

1. Flash `WandSimulator.ino` to a spare ESP32 (NimBLE 2.x).
   - Optional: **`build_opt.h`** in this folder (one line, no comments) passes `-DCONFIG_ESP_BROWNOUT_DET=0` at compile time for ESP32-S3 on arduino-esp32 v3. WiFi staying off at boot is the main brownout fix; skip this file if your toolchain rejects it.
2. Open Serial Monitor @ 115200.
3. Place the board within **0.5–2 m** of your MagicBands and/or StrollerController.

**Brownout (`E BOD`) when sending a command?**

The board is almost certainly **not dead**. Brownout means the **5 V USB supply dipped** when the BLE radio turned on — the MCU resets to protect itself. If you see the four-line `[WandSim]` banner and the prompt sits idle, the chip is fine.

Quick checks:

1. **Powered USB hub** or phone charger (not a laptop port) — this fixes most bench WandSim brownouts.
2. **Shorter / data-rated USB cable** — charge-only cables cause large voltage drop.
3. **Same board, StrollerController firmware** — if that connects over BLE, hardware is good; WandSim just needs more peak current at TX init.
4. **Plain ESP32 (not S3)** spare — less picky on USB; WandSim works on any ESP32 + NimBLE.

Software mitigations in this sketch: BLE lazy-init, 80 MHz during radio bring-up, lowest TX power, early brownout disable on S3. If it still resets on `mb red` after a powered supply, try a different devkit for the wand bench role.

## Testing MagicBands (two bands)

MagicBands only react when they receive a valid `8301…` advertisement. The
simulator **re-broadcasts every 200 ms** for several seconds so bands have
multiple chances to decode the packet.

| Command               | Packet      | Effect on band                                    |
| --------------------- | ----------- | ------------------------------------------------- |
| `mb red`              | E905 single | All 5 LEDs solid red                              |
| `mb cyan`             | E905 single | All LEDs cyan                                     |
| `mb 21`               | E905 single | Palette index 21 (red)                            |
| `mb dual 21 0`        | E906        | Inner red, outer cyan                             |
| `mb rgb 63 0 0`       | E908        | Raw 6-bit red                                     |
| `mb five 0 2 21 8 19` | E909        | Each LED its own palette color                    |
| `mb rainbow`          | E909        | Preset corner rainbow                             |
| `ping`                | CC03000000  | Park wake ping                                    |
| `mbsweep`             | E905 loop   | Cycle palettes 0–31 every 3s — good for two bands |
| `mbloop red`          | E905 loop   | Repeat one color every 3s                         |
| `stop`                | —           | Cancel loops                                      |

**Named colors:** palette index `0-31`, or hyphenated names — `red`, `midnight-blue`, `yellow-orange`, `lime-green`, `pink-3`, etc. (`help` in serial for full list). Short aliases: `cyan`, `purple`, `blue`, `pink`, `yellow`, `lime`, `orange`, `red`, `green`, `white`.

**LED mask** (single-color only): `mb red mask 1` — mask values from emcot wiki:
`0`=all, `1`=top-right only, `2`=bottom-right, `3`=bottom-left, `4`=top-left

### What to expect

- Bands should **light and vibrate** for a few seconds (timing byte defaults ~15s on-time in park math; bands may clip shorter at home).
- If nothing happens: move closer, try `ping` then `mb red`, or run `mbsweep`.
- Bands do **not** need the Disney app — these are broadcast packets, same as parade infrastructure.

## Testing StrollerController

On the stroller board you should see scan lines like:

```
[Scan:MB+] rssi=… NEW 8301e100e905…
[MB+] func=0xE905 …
```

Wand commands still work:

| Command    | Effect                    |
| ---------- | ------------------------- |
| `cast 4`   | WAND-CAST (CF0B00C42022)  |
| `legacy 4` | CF9B wiki format          |
| `idle`     | 0F11 idle beacon          |
| `loop 4`   | Repeat wand cast every 5s |

### Starlight effects (color + pattern / animation)

Wands listen to **MagicBand+ E9 packets** as well as CF0B color casts:

| Command                                                 | Effect                       |
| ------------------------------------------------------- | ---------------------------- |
| `sw list`                                               | List named animation presets |
| `sw cast red`                                           | CF0B wand-to-wand color      |
| `sw solid red`                                          | E905 solid color             |
| `sw pattern spin red`                                   | E909 color + spin pattern    |
| `sw fx rainbow`                                         | E90C Taste the Rainbow show  |
| `sw fx flash` / `sparkle` / `pulse` / `circle` / `fade` | Park animations              |
| `sw combo red sparkle`                                  | CF0B cast then animation     |
| `swfxloop`                                              | Cycle all presets every 4s   |

Pattern modes: `solid`, `spin`, `all`, `corners`, `middle`

StrollerController serial `sniff 30` captures unknown packets from a physical wand button.

## StrollerController wand TX (optional)

The logic board can also advertise as a wand for pairing tests — see StrollerController serial `tx on` / `tx cast 4`. WandSimulator is still useful as a dedicated second transmitter.
