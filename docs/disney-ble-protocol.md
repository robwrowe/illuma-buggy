# Disney BLE Protocol (0x0183)

Illuma Buggy summary aligned with [Adafruit `magicband_protocol.py`](https://github.com/adafruit/Adafruit_Learning_System_Guides/blob/main/CLUE_BLE_Beacon_Remote/magicband_protocol.py) and [emcot community captures](https://emcot.world/Disney_MagicBand%2B_Bluetooth_Codes).

Park infrastructure, MagicBand+, and Starlight wands all use **BLE manufacturer-specific data** with Disney’s SIG company ID **`0x0183`**. On the wire this appears as bytes **`83 01`** (little-endian CID) at the start of the manufacturer field.

```
BLE advertisement manufacturer data:
  83 01  <payload…>
  └─┴─ Disney CID (0x0183)
```

Payload bytes below are **after** the `8301` prefix unless noted.

---

## Who listens to what

| Device | Listens for |
|--------|-------------|
| MagicBand+ | E9 show/guest commands, CC03 ping, parade infrastructure |
| Starlight wand | CF0B/C F9B wand casts **and** E9 commands (same family as bands) |
| IllumaBuggy (StrollerController) | All of the above (passive scanner) — drives WLED on the stroller |

There is **no pairing handshake** for broadcast effects. Devices react to advertisements they decode.

---

## Wake ping (CC03)

Adafruit and park beacons send a short ping before some commands to improve latch reliability:

```
CC 03 00 00 00
```

WandSimulator: `ping` · StrollerController logs: `[Scan:PING]`

---

## 32-color palette (5-bit index)

Shared by MagicBand+, Starlight wand casts, and Illuma firmware. RGB values below are Adafruit’s NeoPixel-calibrated approximations (`PALETTE_RGB` in `magicband_protocol.py`).

| Idx | Name | Idx | Name |
|-----|------|-----|------|
| 0 | Cyan | 16 | Off yellow |
| 1 | Purple | 17 | Yellow orange 2 |
| 2 | Blue | 18 | Lime |
| 3 | Midnight blue | 19 | Orange |
| 4 | Blue 2 | 20 | Red orange |
| 5 | Bright purple | 21 | Red |
| 6 | Lavender | 22 | Cyan 2 |
| 7 | Deep purple | 23 | Cyan 3 |
| 8 | Pink | 24 | Cyan 4 |
| 9–14 | Pink variants | 25 | Green |
| 15 | Yellow orange | 26 | Lime green |
| | | 27–28 | White |
| | | 29 | Off |
| | | 30 | Unique |
| | | 31 | Random / magenta |

Illuma named-color aliases in WandSimulator serial: `cyan`, `purple`, `blue`, `pink`, `yellow`, `lime`, `orange`, `red`, `green`, `white`.

---

## MagicBand+ E9 commands

Most guest/show commands use an **E1/E2 wrapper** then **`E9 xx`** function code:

```
E1 00  E9 05  …   (single color)
E2 00  E9 06  …   (dual color — inner + outer ring)
```

Direct **`E9 xx`** (no E1/E2) also appears in park show infrastructure.

### E905 — single palette color

```
E1 00 E9 05  00  <timing>  0E  <color>  <vib>
                              │           └─ 0xB0 | vibration (0–F)
                              └─ mask[7:5] | palette[4:0]
```

- **Mask** (bits 7–5 of color byte): which of the 5 band LEDs light (see emcot mask table). `000` = all.
- **Vibration**: low nibble OR’d with `0xB0` base (`0xB` = 1s buzz per Adafruit).

Adafruit builder: `build_single_color(palette_idx, mask=0, vibration=0, timing=0x09)`

### E906 — dual palette (inner + outer)

```
E2 00 E9 06  00  <timing>  0F  <inner>  <outer>  <vib>
```

**Important (Adafruit):** working captures use **`0x40 | palette`** for inner/outer bytes, not `0x80` as the emcot wiki text suggests.

### E908 — 6-bit RGB

```
E1 00 E9 08  00  <timing>  D2  55  <R>  <G>  <B>  <vib>
```

Each RGB byte: `(value & 0x3F) << 1` (6-bit channel, bit 0 unused). Illuma scales to 8-bit: `* 4`.

### E909 — five palette slots (color + pattern)

Five color bytes — byte order per Adafruit: **TL, BL, BR, TR, center**:

```
E1 00 E9 09  00  <timing>  0F  <TL>  <BL>  <BR>  <TR>  <C>  <vib>
```

Each slot: **`(pattern << 5) | (palette & 0x1F)`**. Pattern nibble (top 3 bits) controls LED animation mode on the band (emcot / wiki):

| Pattern | Behavior (approx.) |
|---------|-------------------|
| `0x04` | Solid palette A |
| `0x03` | Palette B spin |
| `0x08` | 4/5 corners |
| `0x0B` | All on palette B |
| `0x05` | All LEDs (common in captures) |

WandSimulator: `sw pattern spin red` · `mb five …` · `mb rainbow`

### Show / animation opcodes (fixed captures)

Adafruit [`command_library.py`](https://github.com/adafruit/Adafruit_Learning_System_Guides/blob/main/CLUE_BLE_Beacon_Remote/command_library.py) ships hex payloads for park animations. Examples:

| Label | Func | Notes |
|-------|------|-------|
| Taste the Rainbow | E90C | Show FX |
| Purple Flash | E90E | White/purple flash + vibe |
| Cross-fade | E911 | Two-palette fade |
| Blue Circle | E912 | Circle animation + vibe |
| Purple Pulse | E913 | Firmware-baked pulse |

WandSimulator: `sw fx rainbow`, `sw fx flash`, `sw list` · Some presets send `ping` first.

### Timing byte

```
bit 7: always-on
bit 6: scaler (0 → 1.5×tv+6.5s, 1 → 3.1×tv+5.5s)
bits 5–4: fade-out code
bits 3–0: time value
```

See emcot wiki for full timing tables.

---

## Starlight Bubble Wand

See [starlight-wand-codes.md](./starlight-wand-codes.md) for wand-specific detail.

| Packet | Len | Signature | Meaning |
|--------|-----|-----------|---------|
| **WAND-IDLE** | 19 | `0F 11 …` | Powered-on identity beacon — **not an effect** |
| **WAND-CAST** | 13 | `CF 0B 00 C4 20 22` | Wand-to-wand color cast |
| **WAND-CF9B** | 12+ | `CF 9B …` | Legacy community format; palette in last byte |

**WAND-CAST layout:**

```
CF 0B 00 C4 20 22   <6 rolling bytes>   <palette>
└─ 6-byte signature  anti-replay/auth    5-bit palette idx
```

Adafruit only **recognizes** casts by the 6-byte signature; rolling bytes change every advert and are not replayed by third-party transmitters. For testing, random rolling bytes work on receivers that only check the signature (IllumaBuggy).

**Effects on wands** combine:

1. **CF0B cast** — color transfer to another wand  
2. **E9 commands** — solid, pattern (E909), and show animations (same as bands)

---

## Illuma Buggy implementation

### Override priority (StrollerController)

1. Starlight Wand (`BLE_STARLIGHT`)  
2. MagicBand+ (`BLE_MAGIC`)  
3. Manual preset apply  
4. Zone / GPS preset  

Each BLE source has `enabled` + `timeout_ms` (0 = never auto-clear). App: Settings → Starlight Wand / MagicBand+.

### WLED mapping (100-LED strip)

| Source | WLED behavior |
|--------|----------------|
| MB+ palette / E905 / E906 | Full-strip **Chase** (`fx:28`) with 5-color custom palette (`pd` slot 0), `sx` = speed, `grp` = block thickness |
| MB+ E909 / E908 | Chase with packet colors |
| MB+ animations (E90C, E912, …) | Full-strip effect ID from opcode (e.g. `fx:42` fireworks) |
| Starlight wand cast | Full-strip **solid** (`fx:0`) — custom wand WLED effect TBD |

Config: `mb_chase_config` BLE `{ "speed": 0–255, "thickness": 1–50 }` · Serial: `chase speed 128`, `chase thick 4`

### Scanner log tags

| Tag | Payload hint |
|-----|----------------|
| `WAND-IDLE` | `0F11…` 19 bytes |
| `WAND-CAST` | `CF0B00C42022…` 13 bytes |
| `WAND-CF9B` | `CF9B…` |
| `MB+` | `E1/E2 … E9 …` |
| `PING` | `CC03…` |
| `SHOW` | bare `E9 …` |

Serial **`sniff 30`** logs all manufacturer data (including unknown wand button formats).

### Wand TX beacon (StrollerController serial)

For pairing tests — advertise as another wand:

| Command | Effect |
|---------|--------|
| `tx on` | Continuous WAND-IDLE (`0F11`) |
| `tx off` | Normal IllumaBuggy advertising |
| `tx cast 4` | WAND-CAST 3 seconds |

### Bench testing (WandSimulator)

Second ESP32 broadcasts packets — see [firmware/WandSimulator/README.md](../firmware/WandSimulator/README.md).

---

## Payload builder cheat sheet (C / Python)

Ported from Adafruit in `firmware/WandSimulator/WandSimulator.ino`:

```cpp
// E905 single — buildMbSingle(out, palette, mask, timing, vibration)
// E906 dual   — buildMbDual(out, inner, outer, …)
// E908 rgb    — buildMbRgb(out, r, g, b, …)   // 6-bit 0–63
// E909 five   — buildMbFive(out, tl, bl, br, tr, center, …, patternNibble)
// Ping        — CC 03 00 00 00
// Wand cast   — CF0B00C42022 + 6 random + palette
```

Python equivalents: `build_single_color`, `build_dual_color`, `build_six_bit_color`, `build_five_color` in `magicband_protocol.py`.
