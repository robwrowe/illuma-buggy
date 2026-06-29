# MagicBand+ Bluetooth Codes (community wiki archive)

> **Illuma Buggy canonical reference:** [disney-ble-protocol.md](./disney-ble-protocol.md) — Adafruit-aligned summary, palette table, Illuma firmware behavior.  
> **Adafruit source:** [magicband_protocol.py](https://github.com/adafruit/Adafruit_Learning_System_Guides/blob/main/CLUE_BLE_Beacon_Remote/magicband_protocol.py) · [command_library.py](https://github.com/adafruit/Adafruit_Learning_System_Guides/blob/main/CLUE_BLE_Beacon_Remote/command_library.py)  
> **Starlight wand:** [starlight-wand-codes.md](./starlight-wand-codes.md)

The content below is imported from the [emcot.world MagicBand+ wiki](https://emcot.world/Disney_MagicBand%2B_Bluetooth_Codes) for detailed byte-level breakdowns (timing, vibration, mask palettes, show captures). Where Adafruit and emcot disagree (notably **E906 dual-color** top bits: use **`0x40`** per Adafruit working captures), prefer Adafruit + our `disney-ble-protocol.md`.

---

Disney's MagicBand+ makes use of various BLE features to achieve the things it does.

== Opening Knowledge ==
Direct communication with the magicband appears to be done as an "Alexa Gadget". This is how the app communicates with the phone it seems, but that has yet to be 100% confirmed.

For shows, Disney's Magicband's seem to rely on modified broadcast messages to trigger activity in the magicbands. This appears to be similar in design to how they were using bluetooth in the [[Made With Magic Gen 3 Bluetooth]] ears. The identify codes and commands however are vastly different and the two are not interchangable.

Statues have their own codes. Bounty hunting in Batuu also seems to rely on beacons.

Codes all appear to come from Disney on the 83 01 code.

== Other Tips For Those Getting Started ==
Adafruit has put out a tutorial that is a bit more complete in terms of getting started with making your own magic items. https://learn.adafruit.com/ble-beacon-neopixels

== Alexa Gadget Functions ==

See [[Magicband+ Pairing Details]] (Updated 5/15, older info below for now)

- Communication to the device appears to happen over F04EB177-3005-43A7-AC61-A390DDF83076. This lines up with what NB found in the android app:
  ** serviceUUID = UUID.fromString("0000FE03-0000-1000-8000-00805F9B34FB");
  ** characteristicTXUUID = UUID.fromString("F04EB177-3005-43A7-AC61-A390DDF83076");
  ** characteristicRXUUID = UUID.fromString("2BEEA05B-1879-4BB4-8A2F-72641F82420B");
  ** amazonCharacteristicsDescriptorUUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
- There appears to be a wakeup/connect sequence (haven't fully figured this out yet)
- Something called Hawkeye Headless is also activated.
  \*\* [[HawkeyeHeadless]] Appears to be a codename for the "fake" Alexa Echo running within the Disney App
- Appears to be an Alexa Gadget [https://github.com/alexa-samples/Alexa-Gadgets-Embedded-Sample-Code] (0xFD03)
- Appears to also have Alexa Sidewalk Support (0xFD98)
- Silicon Labs DFU OTA at 0x1D14D6EE-FD63-4FA1-BFA4-8F47B42119F0 (For firmware updates).
- Alexa Commands Possibly:
  ** Alexa.Discovery..Discover \*** Alexa.Discovery..Discover.Response
  ** Alexa.Gadget.StateListener (alarms, timers, etc)
  ** Alexa.Gadget.Connectivity
  ** Custom.DisneyMagicBand.SessionLifeCycle
  ** Custom.DisneyMagicBand.CustomAnimation
  **_ Seems to require SetBLETokens which comes from http://disneyworld.disney.go.com/mb-vas/api/v1/products/ble-tokens
  _** Appears to take in an "animagic" data source, which appears to be a frame based animation. Stucture: \***\* word: animagic
  \*\*** 4 bytes (possibly a length value or count value) \***\* word: fram
  \*\*** 4 bytes (possibly a timing or length value) \***\* 3 bytes, possibly 2 byte per channel (6 bit color?) OR palette, not sure yet, likely LED 0
  \*\*** 3 bytes, possibly 2 byte per channel (6 bit color?) OR palette, not sure yet, likely LED 1 \***\* 3 bytes, possibly 2 byte per channel (6 bit color?) OR palette, not sure yet, likely LED 2
  \*\*** 3 bytes, possibly 2 byte per channel (6 bit color?) OR palette, not sure yet, likely LED 3 \***\* 3 bytes, possibly 2 byte per channel (6 bit color?) OR palette, not sure yet, likely LED 4
  \*\*** [Repeat from fram]
  ** Custom.DisneyMagicBand.Asset
  ** Custom.DisneyMagicBand.Gesture
  ** Custom.DisneyMagicBand.System
  ** Custom.DisneyMagicBand.InPark
- During the discovery response, the ID for the MagicBand is also returned.

== CF0B - Starlight Wand Codes ==

See: [starlight-wand-codes.md](./starlight-wand-codes.md) and [disney-ble-protocol.md](./disney-ble-protocol.md)

== The cc Broadcast Advertising Codes ==
Codes starting with cc03 seem to be quite prevalent in the recordings made in the park. Our first guess was that it was an "off" command, however, it's believed that this may be some sort of general "ping" request, to which the magicbands reply with their own CC code (albeit longer). Further recordings will need to be made to figure out what the additional data is coming from the band, and being sent to the band. It could be some sort of location ID to have it ping back with. The CC codes may also be used to put them into high-response mode for more effective shows.

Codes and there locations:

- cc03000000 - Seen everywhere. Causes magicband to "ping"
- cc03000100 - Seen during Frozen shown. Possibly "Fast Mode Ping"
- cc03132000 - Rocken Roller Coaster Possibly?
-

== The e9 Broadcast Advertising Codes ==
These appear to be the show codes, and can be used to trigger LED's and vibration in the Magicband. We will break this code down further.

=== E9 05 - Single Color From Palette Function ===
==== Byte Breakdown ====

<pre>
0x8301E100E90500090EEDB0
  │││││││││││││││││││││└ Vibration - see vibration palette below
  ││││││││││││││││││││└─ 0xB - vibration and color enable (others disable vibration or mess with color selection)
  ││││││││││││││││││└┴── Bits [7-5] - see mask palette below
  ││││││││││││││││││     Bits [4-0] - see color palette below
  ││││││││││││││││└┴──── 0x0E - purpose unknown
  ││││││││││││││└┴────── Timing - Bit [7] - always on flag (0b means normal timing, 1b means always-on)
  ││││││││││││││                - Bit [6] - see timing scaler below
  ││││││││││││││                - Bits [5-4] - fade-out time (00b means no fade-out up to 11b means 3 second fade-out)
  ││││││││││││││                - Bits [3-0] - time value (passed into timing scaler function to determine true on-time)
  ││││││││││││└┴──────── 0x00 - spacer
  ││││││││└┴┴┴────────── 0xE905 - single color from palette function
  ││││└┴┴┴────────────── 0xE100 or 0xE200 - purpose unknown (not necessary)
  └┴┴┴────────────────── 0x8301 - Disney specifier
</pre>

Timing scaler:

<pre>
0b - (on time seconds) = 1.5*(time value) + 6.5
1b - (on time seconds) = 3.1*(time value) + 5.5

Note: when the (on time seconds) is below a certain length (unsure exact number), it will break up the on-time into two short flashes ~3 seconds on, ~2 seconds off, ~3 seconds on, then off.
</pre>

=== E9 06 - Dual Color Palette Colors ===

==== Byte Breakdown ====

<pre>
0x8301E200E90600220F4441B0
  │││││││││││││││││││││││└ Vibration - see vibration palette below
  ││││││││││││││││││││││└─ 0xB - vibration and color enable (others disable vibration or mess with color selection)
  ││││││││││││││││││││└┴── Color outer - Bits [7-5] - 100b (others cause unexpected output)
  ││││││││││││││││││││                 - Bits [4-0] - see color palette below
  ││││││││││││││││││└┴──── Color inner - Bits [7-5] - 100b (others cause unexpected output)
  ││││││││││││││││││                   - Bits [4-0] - see color palette below
  ││││││││││││││││└┴────── 0x0F - purpose unknown
  ││││││││││││││└┴──────── Timing - Bit [7] - always on flag (0b means normal timing, 1b means always-on)
  ││││││││││││││                  - Bit [6] - see timing scaler below
  ││││││││││││││                  - Bits [5-4] - fade-out time (00b means no fade-out up to 11b means 3 second fade-out)
  ││││││││││││││                  - Bits [3-0] - time value (passed into timing scaler function to determine true on-time)
  ││││││││││││└┴────────── 0x00 - spacer
  ││││││││└┴┴┴──────────── 0xE906 - dual color from palette function
  ││││└┴┴┴──────────────── 0xE100 or 0xE200 - purpose unknown (not necessary)
  └┴┴┴──────────────────── 0x8301 - Disney specifier
</pre>

=== E9 07 - Unknown / Not Yet Seen ===

Seems possible to craft valid packets, e.g. <pre>0x8301E200E90700220F434341B0</pre> and <pre>0x8301E200E90700220F444441B0</pre>

=== E9 08 - Single 6-bit color ===
==== Byte Breakdown ====

<pre>
0x8301E100E908000ED2557C7C7CB0
  │││││││││││││││││││││││││││└ Vibration - see vibration palette below
  ││││││││││││││││││││││││││└─ 0xB - vibration and color enable (others disable vibration or mess with color selection)
  ││││││││││││││││││││││││└┴── Color blue - Bit [7] - flashing enable (causes this color to flash)
  ││││││││││││││││││││││││                - Bits [6-1] - 6-bit color value
  ││││││││││││││││││││││││                - Bit [0] - purpose unknown
  ││││││││││││││││││││││└┴──── Color green - Bit [7] - flashing enable (causes this color to flash)
  ││││││││││││││││││││││                   - Bits [6-1] - 6-bit color value
  ││││││││││││││││││││││                   - Bit [0] - purpose unknown
  ││││││││││││││││││││└┴────── Color red - Bit [7] - flashing enable (causes this color to flash)
  ││││││││││││││││││││                   - Bits [6-1] - 6-bit color value
  ││││││││││││││││││││                   - Bit [0] - purpose unknown
  ││││││││││││││││││└┴──────── 0x55 - purpose unknown (other values affect color)
  ││││││││││││││││└┴────────── 0xD2 - purpose unknown (other values affect color)
  ││││││││││││││└┴──────────── Timing - Bit [7] - always on flag (0b means normal timing, 1b means always-on)
  ││││││││││││││                      - Bit [6] - see timing scaler below
  ││││││││││││││                      - Bits [5-4] - fade-out time (00b means no fade-out up to 11b means 3 second fade-out)
  ││││││││││││││                      - Bits [3-0] - time value (passed into timing scaler function to determine true on-time)
  ││││││││││││└┴────────────── 0x00 - spacer
  ││││││││└┴┴┴──────────────── 0xE908 - single color from palette function
  ││││└┴┴┴──────────────────── 0xE100 or 0xE200 - purpose unknown (not necessary)
  └┴┴┴──────────────────────── 0x8301 - Disney specifier
</pre>

Notes: When selecting low values for colors, you may notice that colors are not the same brightness across red, green, and blue. This can be seen when the value for color is set to one with red (0x8301E100E908000ED255020000B0) and blue (0x8301E100E908000ED255020000B0) but seemingly absent with green (0x8301E100E908000ED255000200B0). This is because different color LEDs have different on-voltages and this does not seem to be calibrated across battery voltages on the MagicBand+. Feel free to calibrate this yourself by adjusting the values to get the exact color you want.

=== E9 09 - 5 Color Palette ===
==== Byte Breakdown ====

<pre>
0x8301E100E909000E0FBCB5B9A4A7B0
  │││││││││││││││││││││││││││││└ Vibration - see vibration palette below
  ││││││││││││││││││││││││││││└─ 0xB - vibration and color enable (others disable vibration or mess with color selection)
  ││││││││││││││││││││││││││└┴── Color top left - Bits [7-5] - 101b (others affect color and mask)
  ││││││││││││││││││││││││││                    - Bits [4-0] - see color palette below
  ││││││││││││││││││││││││└┴──── Color bottom left - Bits [7-5] - 101b (others affect color and mask)
  ││││││││││││││││││││││││                         - Bits [4-0] - see color palette below
  ││││││││││││││││││││││└┴────── Color bottom right - Bits [7-5] - 101b (others affect color and mask)
  ││││││││││││││││││││││                            - Bits [4-0] - see color palette below
  ││││││││││││││││││││└┴──────── Color top right - Bits [7-5] - 101b (others affect color and mask)
  ││││││││││││││││││││                           - Bits [4-0] - see color palette below
  ││││││││││││││││││└┴────────── Color center - Bits [7-5] - 101b (others affect color and mask)
  ││││││││││││││││││                          - Bits [4-0] - see color palette below
  ││││││││││││││││└┴──────────── 0x0F - purpose unknown (other values affect color)
  ││││││││││││││└┴────────────── Timing - Bit [7] - always on flag (0b means normal timing, 1b means always-on)
  ││││││││││││││                        - Bit [6] - see timing scaler below
  ││││││││││││││                        - Bits [5-4] - fade-out time (00b means no fade-out up to 11b means 3 second fade-out)
  ││││││││││││││                        - Bits [3-0] - time value (passed into timing scaler function to determine true on-time)
  ││││││││││││└┴──────────────── 0x00 - spacer
  ││││││││└┴┴┴────────────────── 0xE908 - single color from palette function
  ││││└┴┴┴────────────────────── 0xE100 or 0xE200 - purpose unknown (not necessary)
  └┴┴┴────────────────────────── 0x8301 - Disney specifier
</pre>

A full command might look like this: e9 08 00 f4 0f a0 a4 b9 b9 a4
Let's break that down tuple by tuple. All of this is "best guess" and by no means official. More research to be done on next trip.

- e9 - Identifier for magic band
- e8 - Unknown, likely a function call within the magicband
- 00 - Unknown
- f4 - Unknown - Possibly Time Related
- 0f - Partially Unknown - May be partially "Pattern"
- a0 - Partially Pattern and First color
- a4 - Second Color
- b9 - Third Color
- b9 - Fourth Color
- a4 - Fifth Color

Using anything other than an A or a B in the first slot color slot will have an impact on the PATTERN (likely only 1 bit is being used for additional colors.. Bringing the total "color palette" on the device up to 32 colors, with only about 20 of them being used so far. It's possible that 2 bits are used bringing the total to 64 colors, however, the second bit seems to affect pattern in the lower numbers. Likely more colors could be added to the palette via firmware updates.

It's possible the same 32 color pallete is used in multiple "functions" but uses the leading bits to achieve more with each color. Unsure at this time.

Pattern Codes with the first letter appear to do the following:

- 0 = Nothing
- 1 = Nothing
- 2 = 0010 - Middle Only Whitesh
- 3 = 0011 - Palette B Spin
- 4 = 0100 - Palette A
- 5 = 0101 - Palette B
- 6 = 0110 - Nothing
- 7 = 0111 - Right Side - Palette B
- 8 = 1000 - 4/5 - Palette A
- 9 = 1001 - 4/5 - Palette B
- a = 1010 - Palette A
- b = All On - Palette B
- c = 1100 - Palette A
- d = All On - Palette B
- e = 1110 - Palette A
- f = All On - Palette B

=== E9 0b - Circle Animation ===
Example Code: e9 0b 0b 0f 0f 5c 5d 48 a5 d1 45 32 05

=== E9 0c - Animation Codes ===
There is a lot going on with this code... Seen twice in Fantasimic. Twice in Happily Ever After. Possibly Multiple Animations. Some interesting codes:

- 8301e100e90c 000f 0f 5d465bf00532374895 - Blink White (lightning?)
- 8301e100e90c 00ef 0f 4f4f5bf0fb14374895 - Orange Blink
- 8301e100e90c 000f 0f b1b9b5b1a2307b7db0 - 5 Pallete Color Cycle
- 8301e100e90c 000f 0f 5d465bf005323748b0 - Taste the Rainbow

=== E9 0e - ===

- e100e90e00010fbda0a0bda059070048aeb5
- e100e90e00020fbca0bca0bc5917fb48aebb
- e100e90e00110fbca7b9a7b959190248aeb0
- e100e90e00150fbbbbbbbbbb59190248aeb0
- e100e90e00830fb5b9b2adb659190b48aeb0

=== E9 0F ===

- e100e90f00110f4f425807488dd2462a0717b8
- e100e90f002a0f46435812488dd246021200b0
-

=== E9 10 - Alternating Colors? ===

- e9 10 00 0f 0f 54 5d 58 f4 48 82 d1 46 09 0a d0 65 28 2102
- e100e91000134897d00ea0d146060f30d04e07b0
-

=== E9 11 - Palette Cross Fade (Center Opposite Outer Ring) ===

- e100e911006f0f564858f44882d1460208d06500b0
- e200e911004f0f444f58f44882d1460607d06543b0
- e100e911000f0f485958f44882d146020dd06505b0
- e200e911004f0f4f5558f44882d146022ad06501b0
- e100e91100010f5a475bf03134374894d13d0507b0
- e100e91100070f555d58f44882d1460508d06500b0
- e100e91100440f514258f44882d146050fd06500b0

2 Palette Colors follow the 0f.

=== E9 12 - Circle With Vibration ===
Cross fade with 2 colors?
Example Code: e9 12 00 01 0f bc bd bd bd bd 30 d0 37 f4 d2 46 00 00 fc bb

- e100e91200012904020211114896d00effd1460707b0
- e200e91200030fa2a2a4a4a230d037f4d2460064fcb0

=== E9 13 - Another Animation ===
\*e9 13 00 b6 0f 40 44 58 f4 48 82 d0 65 19 d1 46 06 0a 30 7b ff

- e100e9130002d037f0d23d0505000efa8983510ee7a0b0
- e200e91300650fbdb5bcb5bc7aec5c0a2915291548abb0

=== E9 14 - ===

- e100e914000cd037f0d23d050c0c0eec8983510eee0c3db0
- e200e914002cd037f0d23d0212000eea8983510ee30c1eb0
- e200e91400420f555b58f44882d0651bd1462a02307b5db0

=== E9 1B - Unknown ===

== Palettes ==

=== Vibration Palette ===

<pre>
0x0 = no vibration
0x1 = - (6s break) -
0x2 = -- (6s break) --
0x3 = --- (6s break) ---
0x4 = --* (4s break) --*
0x5 = ----*- (3s break) ----*-
0x6 = ---***--- (3s break) ---***---
0x7 = # (4s break) #
0x8 = '''''' (6s break) ''''''
0x9 = - (6s break) -
0xA = * (6s break) *
0xB = % (5s break) %
0xC = no vibration
0xD = no vibration
0xE = no vibration
0xF = no vibration
</pre>

Legend:

<pre>
' = 0.125s
- = 0.25s
* = 0.5s
% = 1s
# = 2s
</pre>

=== Mask Palette ===

<pre>
000b = All LEDs
001b = Only top right LED
010b = Only bottom right LED
011b = Only bottom left LED
100b = Only top left LED
101b = All LEDs
110b = Only top right LED
111b = All LEDs
</pre>

=== Color Palette (5-bit) ===

<pre>
00000b = cyan
00001b = purple
00010b = blue
00011b = midnight blue
00100b = blue
00101b = bright purple
00110b = lavender
00111b = purple
01000b = pink
01001b = pink
01010b = pink
01011b = pink
01100b = pink
01101b = pink
01110b = pink
01111b = yellow orange
10000b = off yellow
10001b = yellow orange
10010b = lime
10011b = orange
10100b = red orange
10101b = red
10110b = cyan
10111b = cyan
11000b = cyan
11001b = green
11010b = lime green
11011b = White
11100b = white
11101b = off
11110b = unique
11111b = random
</pre>
