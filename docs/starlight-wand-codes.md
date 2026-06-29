# Starlight Bubble Wand — BLE Protocol

Interactive bubble wand sold at Magic Kingdom (Disney Starlight parade, July 2025). It broadcasts Disney **`0x0183`** manufacturer data like MagicBand+ and can **receive** wand casts and E9 effect commands.

**Canonical protocol reference:** [disney-ble-protocol.md](./disney-ble-protocol.md)  
**Adafruit implementation:** [CLUE_BLE_Beacon_Remote](https://github.com/adafruit/Adafruit_Learning_System_Guides/tree/main/CLUE_BLE_Beacon_Remote) (`magicband_protocol.py`)

---

## Packet types

All lengths are **payload bytes after `8301`**.

| Tag | Length | First bytes | Meaning |
|-----|--------|-------------|---------|
| **WAND-IDLE** | 19 | `0F 11 …` | Identity beacon while powered on. **Not an effect.** |
| **WAND-CAST** | 13 | `CF 0B 00 C4 20 22` | Wand-to-wand **color cast** (Adafruit, April 2026) |
| **WAND-CF9B** | 12+ | `CF 9B …` | Legacy emcot/wiki format; palette in **last byte** |

IllumaBuggy scan logs: `[Scan:WAND-IDLE]`, `[Scan:WAND-CAST]`, `[Scan:WAND-CF9B]`.

---

## WAND-CAST (13 bytes)

```
8301  CF0B00C42022  4D143EFC72A7  1C
      └─ signature   └─ rolling    └─ palette (5-bit, MB+ table)
```

| Offset | Field |
|--------|--------|
| 0–5 | Fixed signature `CF 0B 00 C4 20 22` |
| 6–11 | Rolling code (changes every advertisement; anti-replay on real wands) |
| 12 | Palette index `& 0x1F` |

**Illuma receiver:** matches signature + length; ignores rolling bytes for effect trigger.  
**Illuma transmitter:** random bytes 6–11 (WandSimulator `cast`, StrollerController `tx cast`).

### Observed idle beacon (home testing)

While on, the wand repeats this **21-byte** packet (unchanging):

```
8301 0F11 014B729908830A66D485CD9F9575A8A321
```

Pressing the cast button should produce a **different** 15-byte advert (`8301` + 13-byte WAND-CAST). If you only see `WAND-IDLE`, run StrollerController **`sniff 30`** while pressing the button to capture the real format.

---

## Legacy CF9B format

```
8301 CF9B 00 C4 29 22 … <serial/unknown> … <palette>
```

Examples from emcot:

- `cf9b00c42922efd819f22a62` **`04`**
- `cf9b00c420224d143efc72a7` **`1c`**

Illuma accepts CF9B with palette in the last byte as a fallback cast.

---

## Effects: color + pattern

Wands do **not** only use CF0B. They also listen to **MagicBand+ E9** broadcasts (same as bands).

| Goal | Mechanism | WandSimulator |
|------|-----------|---------------|
| Transfer color to another wand | WAND-CAST / CF9B | `cast red`, `sw cast red` |
| Solid color | E905 | `sw solid red`, `mb red` |
| Color + LED pattern | E909 (pattern nibble + palette) | `sw pattern spin red` |
| Park animation | E90C / E90E / E911 / E912 / E913 | `sw fx rainbow`, `sw fx sparkle` |
| Color then animation | Sequence | `sw combo blue pulse` |

### E909 pattern modes (`sw pattern <mode> <color>`)

Pattern is the top 3 bits of each E909 color byte (see emcot wiki):

| Mode | Nibble | Typical look |
|------|--------|--------------|
| `solid` | `0x04` | Steady |
| `spin` | `0x03` | Rotating / spin |
| `corners` | `0x08` | Corner emphasis |
| `all` | `0x0B` | All segments |
| `middle` | `0x02` | Center emphasis |

### Named animations (`sw fx <name>`)

From Adafruit `command_library.py` captures:

| Name | Description |
|------|-------------|
| `rainbow` | E90C Taste the Rainbow |
| `blink` | E90C white blink |
| `palette5` | E90C five-palette cycle |
| `flash` | E90E flash |
| `sparkle` | E910 blue sparkle (+ ping) |
| `pulse` | E913 purple pulse |
| `circle` | E912 blue circle (+ ping) |
| `fade` / `fade2` | E911 cross-fades |

Run **`sw list`** on WandSimulator for the live list.

---

## Testing at home

### Physical wand → IllumaBuggy

1. Flash latest `StrollerController.ino`
2. Enable **Starlight Wand** in app Settings
3. Serial: confirm `[Scan:WAND-IDLE]` when wand is on
4. Cast at another wand or use button + **`sniff 30`** to capture cast packets
5. On success: `[Scan:WAND-CAST]`, `[Wand] CAST palette=N`, stroller WLED changes

### WandSimulator → wand / bands / stroller

Flash `WandSimulator.ino` on a second ESP32 (~0.5–2 m away):

```
ping
sw pattern spin red
sw fx sparkle
mb red
```

See [firmware/WandSimulator/README.md](../firmware/WandSimulator/README.md).

### StrollerController as fake wand (pairing theory)

Serial on logic board:

```
tx on          # broadcast WAND-IDLE — another wand may think a peer is present
tx cast 4      # WAND-CAST palette 4 for 3s
tx off
```

---

## Illuma stroller WLED behavior (today)

| Wand packet | Stroller response |
|-------------|-------------------|
| WAND-CAST / CF9B | Full-strip solid color from palette |
| E9 (if MB+ enabled) | Chase / animation per [disney-ble-protocol.md](./disney-ble-protocol.md) |

Starlight-specific WLED usermod effect (chase/sparkle matching wand tube) is planned; wand casts currently use solid fill across **100 LEDs**.
