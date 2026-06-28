Disney's Starlight wand was release on July 18th during the soft open of the Disney Starlight parade in the magic kingdom. It is a bluetooth bubblewand with the ability to transmit codes to other Starlight wands. Those codes only affect other Starlight wands at this time.

== Bluetooth Codes ==

The wands operate using a similar broadcast code system like the [[Disney MagicBand+ Bluetooth Codes]]. In fact, they are able to "hear" magicband codes as well as codes from other wands. The last 5 bits appear to be the palette based color code just like the Magicbands+.

Reference implementation: [Adafruit CLUE BLE Beacon Remote](https://github.com/adafruit/Adafruit_Learning_System_Guides/tree/main/CLUE_BLE_Beacon_Remote) (`magicband_protocol.py`).

==== Packet types ====

| Tag | Length (after 0x8301) | Signature | Meaning |
|-----|----------------------|-----------|---------|
| **WAND-IDLE** | 19 bytes | `0F 11 …` | Constant identity beacon while wand is on. **Not a color cast.** Repeats identically. |
| **WAND-CAST** | 13 bytes | `CF 0B 00 C4 20 22` | Color effect broadcast. Bytes 6–11 are rolling auth (change every advert). Byte 12 = palette index. |

==== WAND-CAST byte breakdown (13-byte payload) ====

<pre>
8301 CF0B00C42022 4D143EFC72A7 1C
     ││││││││││││  ││││││││││││  └─ palette index (5-bit, same table as MB+)
     ││││││││││││  └─ rolling code (changes every broadcast)
     └─ 6-byte wand cast signature (CF0B00C42022)
└┴┴ 0x8301 Disney company ID (BLE manufacturer data prefix)
</pre>

==== Legacy / community docs (CF9B) ====

Older community captures used a `CF9B` marker instead of `CF0B00C42022`:

<pre>
0x8301CF9B00C42922EFD819F22A6204
  ││││└┴┴┴────────────────────── 0xCF9B - older marker
  └┴┴┴────────────────────────── 0x8301 - Disney specifier
</pre>

Firmware accepts the Adafruit **CF0B00C42022** 13-byte cast format (verified April 2026).

==== Observed 0F11 idle beacon (home testing) ====

While powered on, the wand continuously broadcasts this **21-byte** manufacturer packet (unchanging):

```
8301 0F11 014B729908830A66D485CD9F9575A8A321
```

This is **not** an effect packet. When casting a color, look for a **NEW** 15-byte packet (`8301` + 13-byte WAND-CAST) in Serial logs tagged `WAND-CAST`.
