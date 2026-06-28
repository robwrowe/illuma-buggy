# WandSimulator

Second ESP32 sketch that **broadcasts** Disney BLE packets for bench testing.
IllumaBuggy (StrollerController) is the **receiver** — it only scans, it does not
need to pretend to be a wand.

## Setup

1. Flash `WandSimulator.ino` to a **spare** ESP32 (Arduino IDE, NimBLE 2.x, any ESP32 board).
2. Flash latest `StrollerController.ino` to the stroller logic board.
3. Open Serial Monitor on **both** boards @ 115200.
4. Place boards within ~1–2 m of each other.

## StrollerController — catch real wand button

On the stroller board Serial Monitor:

```
sniff 30
```

Press the wand button repeatedly during those 30 seconds. Look for **`[Sniff]`** lines
that are **not** the usual 21-byte `0F11` idle packet — that reveals what the button
actually broadcasts.

## WandSimulator — mock casts

On the simulator Serial Monitor:

| Command | Effect |
|---------|--------|
| `cast 4` | Adafruit **WAND-CAST** (CF0B00C42022), palette 4 |
| `legacy 4` | Older **CF9B** wiki format |
| `mb 21` | MagicBand+ single color (red) |
| `idle` | Same **0F11** idle beacon your wand sends constantly |
| `loop 4` | Repeat `cast 4` every 5s |

On StrollerController you should see:

```
[Scan:WAND-CAST] rssi=… len=15 NEW 8301cf0b00c42022…
[Wand] CAST palette=4 …
```

…and the stroller LEDs should change.

## Does the real wand need a handshake?

No. There is no listen-mode or pairing step on the receiver. If the wand button
does not produce `WAND-CAST` or `WAND-CF9B` lines (only `WAND-IDLE`), the button
may not be emitting a cast packet we recognize yet — use `sniff` to capture it.
