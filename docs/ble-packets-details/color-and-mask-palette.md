# Color and Mask Palette

This describes the color & mask palette used across packets.

```text
000 10010b
│││ │││││
│││ └┴┴┴┴─────── Bits [7-3] - Color Palette
│││
└┴┴───────────── Bits [2-0] - Mask Palette
```

## Bits Breakdown

### Bits [2-0] - Mask Pattern

These tell the device which LEDs to color

```text
000b ─ All LEDs
001b ─ Only top right LED
010b ─ Only bottom right LED
011b ─ Only bottom left LED
100b ─ Only top left LED
101b ─ All LEDs
110b ─ Only top right LED
111b ─ All LEDs
```

### Bits [7-3] - Color Palette

These are the pre-programmed colors, along with our "best guess" at the RGB values.

Bits | Dec | Hex | Color | Family | Description
-----|-----|-----|-------|--------|-------------
`00000` | `00` | `0x00` | #E0FFE6 | 🟩 Green | Very light mint green
`00001` | `01` | `0x01` | #99BDFF | 🔷 Blue | Light sky blue
`00010` | `02` | `0x02` | #576AFF | 🔷 Blue | Medium royal blue
`00011` | `03` | `0x03` | #5985FF | 🔷 Blue | Bright cornflower blue
`00100` | `04` | `0x04` | #1C33FF | 🔷 Blue | Deep vivid blue
`00101` | `05` | `0x05` | #E2A3FF | 🟪 Purple | Light lavender pink
`00110` | `06` | `0x06` | #D5BAFF | 🟪 Purple | Very light periwinkle
`00111` | `07` | `0x07` | #D7A6FF | 🟪 Purple | Light orchid
`01000` | `08` | `0x08` | #D470FF | 🟪 Purple | Bright purple-pink
`01001` | `09` | `0x09` | #FFA3FC | 🟪 Purple | Bright pink
`01010` | `10` | `0x0A` | #EC9EFF | 🟪 Purple | Soft bright pink
`01011` | `11` | `0x0B` | #F678FF | 🟪 Purple | Vibrant hot pink
`01100` | `12` | `0x0C` | #E485FF | 🟪 Purple | Bright pink-purple
`01101` | `13` | `0x0D` | #F86EFF | 🟪 Purple | Strong neon magenta
`01110` | `14` | `0x0E` | #FF3856 | 🟥 Red | Bright cherry red
`01111` | `15` | `0x0F` | #FFBB00 | 🟨 Yellow | Bright golden yellow
`10000` | `16` | `0x10` | #FFFF8E | 🟨 Yellow | Pale lemon yellow
`10001` | `17` | `0x11` | #FFDD00 | 🟨 Yellow | Strong golden yellow
`10010` | `18` | `0x12` | #CCFF00 | 🟨 Yellow | Electric chartreuse
`10011` | `19` | `0x13` | #FF9D00 | 🟧 Orange | Bright orange
`10100` | `20` | `0x14` | #FF7300 | 🟧 Orange | Vivid orange
`10101` | `21` | `0x15` | #FF2200 | 🟥 Red | Bright red-orange
`10110` | `22` | `0x16` | #00FFEA | 🩵 Teal | Bright cyan
`10111` | `23` | `0x17` | #66FFD1 | 🩵 Teal | Bright mint aqua
`11000` | `24` | `0x18` | #8FFFEE | 🩵 Teal | Light cyan
`11001` | `25` | `0x19` | #00FF26 | 🟩 Green | Bright lime green
`11010` | `26` | `0x1A` | #AFFF03 | 🟨 Yellow | Bright neon yellow-green
`11011` | `27` | `0x1B` | #ECEEFF | ⬜ White | Very light lavender blue
`11100` | `28` | `0x1C` | #FFFFFF | ⬜ White | Pure white
`11101` | `29` | `0x1D` | #000000 | ⬛ Black | Pure black
`11110` | `30` | `0x1E` | N/A | Unique | A color that is unique across all devices 
`11111` | `31` | `0x1F` | N/A | Random | A randomly selected palette color from 0-28 