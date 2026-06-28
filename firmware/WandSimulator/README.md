# WandSimulator

ESP32 sketch that **broadcasts** Disney BLE manufacturer packets for bench and
in-home testing. IllumaBuggy (StrollerController) is the **receiver** for
stroller LEDs; **physical MagicBand+ bands** also listen to the same packets
in the parks.

Protocol builders match [Adafruit `magicband_protocol.py`](https://github.com/adafruit/Adafruit_Learning_System_Guides/blob/main/CLUE_BLE_Beacon_Remote/magicband_protocol.py).

## Setup

1. Flash `WandSimulator.ino` to a spare ESP32 (NimBLE 2.x).
2. Open Serial Monitor @ 115200.
3. Place the board within **0.5–2 m** of your MagicBands and/or StrollerController.

## Testing MagicBands (two bands)

MagicBands only react when they receive a valid `8301…` advertisement. The
simulator **re-broadcasts every 200 ms** for several seconds so bands have
multiple chances to decode the packet.

| Command | Packet | Effect on band |
|---------|--------|----------------|
| `mb red` | E905 single | All 5 LEDs solid red |
| `mb cyan` | E905 single | All LEDs cyan |
| `mb 21` | E905 single | Palette index 21 (red) |
| `mb dual 21 0` | E906 | Inner red, outer cyan |
| `mb rgb 63 0 0` | E908 | Raw 6-bit red |
| `mb five 0 2 21 8 19` | E909 | Each LED its own palette color |
| `mb rainbow` | E909 | Preset corner rainbow |
| `ping` | CC03000000 | Park wake ping |
| `mbsweep` | E905 loop | Cycle palettes 0–31 every 3s — good for two bands |
| `mbloop red` | E905 loop | Repeat one color every 3s |
| `stop` | — | Cancel loops |

**Named colors:** `cyan`, `purple`, `blue`, `pink`, `yellow`, `lime`, `orange`, `red`, `green`, `white`

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

| Command | Effect |
|---------|--------|
| `cast 4` | WAND-CAST (CF0B00C42022) |
| `legacy 4` | CF9B wiki format |
| `idle` | 0F11 idle beacon |
| `loop 4` | Repeat wand cast every 5s |

StrollerController serial `sniff 30` captures unknown packets from a physical wand button.

## StrollerController wand TX (optional)

The logic board can also advertise as a wand for pairing tests — see StrollerController serial `tx on` / `tx cast 4`. WandSimulator is still useful as a dedicated second transmitter.
