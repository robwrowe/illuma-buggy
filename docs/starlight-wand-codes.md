Disney's Starlight wand was release on July 18th during the soft open of the Disney Starlight parade in the magic kingdom. It is a bluetooth bubblewand with the ability to transmit codes to other Starlight wands. Those codes only affect other Starlight wands at this time.

== Bluetooth Codes ==

The wands opperate using a similar broadcast code system like the [[Disney MagicBand+ Bluetooth Codes]]. In fact, they are able to "hear" magicband codes as well as codes from other wands. The last 5 bits appear to be the pallete based color code just like the Magicbands+.

The structure of the codes being sent by the wands appears as follows:

==== Byte Breakdown ====

<pre>
0x8301CF9B00C42922EFD819F22A6204 
  ││││││││││││││││││││││││││││└┴ Pallet Based Color Codes (Same Color Table as MB+)
  ││││││││└┴┴┴┴┴┴┴┴┴┴┴┴┴┴┴┴┴┴┴── Unknown, Device Serial Number?
  ││││└┴┴┴────────────────────── 0xCF9B - Marker for Starlight Wand Transmitters.
  └┴┴┴────────────────────────── 0x8301 - Disney specifier
</pre>

Two Example Codes:

- cf9b00 c42922efd819f22a62 04
- cf9b00 c420224d143efc72a7 1c
