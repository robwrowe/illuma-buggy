# Rule engine — anchor-relative offsets

## Why

Some captured Disney packets omit the `8301` / E1 / E2 prefix (typically 2 bytes). That
shifts every **fixed** byte offset in the payload by a constant amount — but only for
*that* capture, not predictably across all packets of a given type. A per-rule constant
offset correction is therefore unreliable.

**Anchor-relative offsets** locate a structural marker byte (Nth occurrence of value `X`,
optionally within a search window) and then apply a signed delta. The same rule then works
whether or not the prefix is present.

## How to use (authoring)

### 1. Find a stable marker

In Wand Lab → **Analyze**, paste several captures of the same effect (with and without
`8301` if you have both). Tag:

- **Anchor** on the marker byte (e.g. a repeated `0x0F` layout selector)
- **Color** / **Param** / **Timing** on the bytes you care about *relative to* that marker

Prefer a byte whose **value and occurrence** stay the same across variants, even when
absolute indices shift.

### 2. Wire the rule (Rules editor)

On any extract, color channel, palette color source, blend-ratio extract, or timing byte:

1. Switch **Fixed → Anchor**
2. Set **Marker byte** (hex), **Occurrence** (1 = first match), optional search window
3. Set **Δ bytes after match** — `0` = the marker itself, `+1` = next byte, `-1` = previous, etc.
4. Optional:
   - **Fallback** if the marker is missing — **Number** (0–255 raw / palette index / channel) or **Color** (`#rrggbb` for color extracts/sources; on an RGB channel, the matching R/G/B component is used)
   - **Fail rule match if marker not found** (`requireAnchor`) — skip this rule instead of using the fallback

Conditions (byte / bits) can also use Anchor mode; a missing marker makes the condition
false (no separate fallback UI).

### 3. Generate from Analyze

If you tagged **Anchor** plus colors/params, **Generate new rule** from a Log finding emits
`anchor` + `deltaBytes` on those extracts (nearest preceding anchor tag). Review in Rules
before pushing to the board.

### 4. Verify

Use Rules coverage / packet preview with both prefixed and stripped hex. Confirm colors and
params still resolve. If the marker is sometimes absent, choose fallback vs `requireAnchor`
deliberately.

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
  },
  // Optional — extracts / color channels / blend ratio / timing only
  // (not condition leaves; those already fail the condition when the marker is missing):
  "fallbackValue": 0,        // number 0–255, OR "#rrggbb" color string
  "requireAnchor": false     // if true, skip this rule entirely when marker not found
}
```

**Resolution rule:** if `anchor` is present and valid, it wins over `offset`. Existing
rules without `anchor` are byte-for-byte unchanged.

When an anchor is present but the marker is not found (or the result index is out of
range), firmware and the web preview treat that as “value unavailable”:

| Call site | Default not-found behavior | With `requireAnchor: true` |
|-----------|----------------------------|----------------------------|
| Condition leaves | condition → `false` | n/a (extras not used) |
| Palette / color extract | number → raw/palette index; `#rrggbb` → that RGB | rule skipped |
| RGB channel | number → channel value; `#rrggbb` → that channel’s component | rule skipped |
| Blend ratio extract | ratio from numeric `fallbackValue` / bitCount max | rule skipped |
| Timing byte | derived from numeric `fallbackValue` | rule skipped |

## Worked example

An E9-0C-style 5-zone rule previously hardcoded `colorSources[0].channelGroup.r.offset: 9`.
With the prefix sometimes stripped, the real color start shifts to offset `7`.

New config:

```jsonc
{
  "anchor": { "byte": "0F", "occurrence": 2, "deltaBytes": 1 },
  "fallbackValue": "#000000",
  "requireAnchor": false
}
```

This finds the 2nd `0x0F` and reads the byte immediately after it. If that marker is
missing, the channel falls back to black (or skip the rule if `requireAnchor` is true).

## Hypothesis status of marker values

The **anchor mechanism** itself is confirmed-by-construction (a search loop in firmware and
the JS mirror in `web/src/lib/ble/e9Decode.js`).

Which `byte` / `occurrence` / `deltaBytes` values are *correct* for a given opcode family
is **research / hypothesis status** — validate per-opcode via Wand Lab → Analyze (byte
tagging) and packet sweeps. Do not assume marker constants from this doc without capture
evidence.
