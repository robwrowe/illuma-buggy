# Rule engine — anchor-relative offsets

## Why

Some captured Disney packets omit the `8301` / E1 / E2 prefix (typically 2 bytes). That
shifts every **fixed** byte offset in the payload by a constant amount — but only for
*that* capture, not predictably across all packets of a given type. A per-rule constant
offset correction is therefore unreliable.

**Anchor-relative offsets** locate a structural marker byte (Nth occurrence of value `X`,
optionally within a search window) and then apply a signed delta. The same rule then works
whether or not the prefix is present.

## Schema

Every place a rule currently accepts `"offset": N` may also carry an optional `anchor`:

```jsonc
// Absolute (unchanged — default for all existing rules):
{ "offset": 9 }

// Anchor-relative (wins over offset when present):
{
  "offset": 9,          // kept for UI toggle; ignored when anchor is set
  "anchor": {
    "byte": "0F",       // hex string, 1 byte, required
    "occurrence": 2,    // 1-based; which match to use (default 1)
    "searchFrom": 0,    // start scanning at this payload index (default 0)
    "searchLen": 0,     // max bytes to scan; 0 = to end of payload (default 0)
    "deltaBytes": 1     // add to found index → final offset (default 0)
  }
}
```

**Resolution rule:** if `anchor` is present and valid, it wins over `offset`. Existing
rules without `anchor` are byte-for-byte unchanged.

When an anchor is present but the marker is not found (or the result index is out of
range), firmware and the web preview treat that as “value unavailable”:

| Call site | Not-found behavior |
|-----------|--------------------|
| Condition leaves | condition → `false` |
| Extracts / color channels | value → `0` |
| Blend ratio extract | ratio → `0.5` |
| Timing byte | derived value → `0` / no strobe |

## Worked example

An E9-0C-style 5-zone rule previously hardcoded `colorSources[0].channelGroup.r.offset: 9`.
With the prefix sometimes stripped, the real color start shifts to offset `7`.

New config:

```jsonc
{
  "anchor": { "byte": "0F", "occurrence": 2, "deltaBytes": 1 }
}
```

This finds the 2nd `0x0F` (a zone-layout selector constant in this family) and reads the
byte immediately after it, regardless of prefix presence.

## Hypothesis status of marker values

The **anchor mechanism** itself is confirmed-by-construction (a search loop in firmware and
the JS mirror in `web/src/lib/ble/e9Decode.js`).

Which `byte` / `occurrence` / `deltaBytes` values are *correct* for a given opcode family
is **research / hypothesis status** — validate per-opcode via Wand Lab → Analyze (byte
tagging) and packet sweeps. Do not assume marker constants from this doc without capture
evidence.
