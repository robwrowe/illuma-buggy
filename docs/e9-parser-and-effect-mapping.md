# E9 Broadcast Packet Parser + WLED Effect Mapping — Implementation Instructions

## Context

Illuma Buggy passively scans MagicBand+/Starlight Wand BLE broadcast packets
(the `E9xx` "show codes" documented at emcot.world). Today, unknown/unhandled
opcodes and sub-modes are silently coerced to a single hardcoded fallback
example. This task replaces that with:

1. A real, byte-accurate parser for the confirmed opcodes (Tier 1).
2. A structured "unhandled" path for everything else (Tier 2) that still
   degrades gracefully and gets flagged for review in Wand Lab.
3. A user-facing mapping screen so the user can bind each known MagicBand+
   animation "shape" (Tier 1 opcode/sub-mode, or a Tier 2 fallback bucket)
   to a WLED preset/effect of their choosing, rather than hardcoding what
   WLED effect each MagicBand+ code should trigger.

This is additive work. It must not change existing behavior for anything
not explicitly covered below, and should follow the existing
non-destructive migration pattern already used for schema changes
(see project memory: additive-only, safe defaults, wired into all three
load paths).

---

## Part 1 — Confirmed byte-level decodes (Tier 1)

All of the below were derived from controlled single-byte mutation testing
against a real MagicBand+ and cross-checked against the emcot.world
documented structure for E905/E906/E908/E909. Implement these as literal,
confirmed logic — not heuristics.

### Shared building blocks

**5-bit color palette table** (already exists in the codebase per
`mbMapping.colors` — 32 entries). Reuse it. Do not hardcode a second copy.

```
index (5-bit) -> color
0x00 cyan            0x01 purple          0x02 blue           0x03 midnight blue
0x04 blue             0x05 bright purple   0x06 lavender       0x07 purple
0x08 pink             0x09 pink            0x0A pink           0x0B pink
0x0C pink             0x0D pink            0x0E pink           0x0F yellow orange
0x10 off yellow       0x11 yellow orange   0x12 lime           0x13 orange
0x14 red orange       0x15 red             0x16 cyan           0x17 cyan
0x18 cyan             0x19 green           0x1A lime green     0x1B White
0x1C white            0x1D off             0x1E unique         0x1F random
```

**Color byte structure** (confirmed for E909, E90C-palette-submode, E90E):

```
byte = MMM CCCCC
  bits 7-5 (MMM) = mask
  bits 4-0 (CCCCC) = 5-bit palette index (table above)
```

Known mask values: `101` is the standard "normal color" mask seen across
E909 and the E90C palette sub-mode. Do NOT assume other mask values are
invalid — flag them for logging but still decode the color index, since we
have not exhaustively tested what every mask value does.

### Opcode: E905 (single color from palette)

Already documented by emcot.world. Implement per their byte breakdown
(1 color byte with mask+index, 1 timing byte, 1 vibration byte). No new
research needed — reference implementation only.

### Opcode: E906 (dual color from palette)

Same — implement per emcot.world's documented breakdown (2 color bytes,
1 timing byte, 1 vibration byte).

### Opcode: E908 (single 6-bit color)

Same — implement per emcot.world's documented breakdown. Note the existing
`looksLikePaletteByte` / `applyUnknownE9Heuristic` draft mentions 6-bit
color scaling; use proper spread-bit scaling (not naive `*4`) per the
existing project note.

### Opcode: E909 (5-color palette) — CONFIRMED POSITION MAP

```
Frame: [prefix 2B] [e9 09] [00] [unk] [0f] [C1][C2][C3][C4][C5] [timing] [00] [vib]
```

Position order (confirmed against physical LEDs, same convention used for
E90E below — see that section for how this was derived): **Top Left,
Bottom Left, Bottom Right, Top Right, Center** per emcot.world's documented
layout. Implement per emcot's existing byte breakdown; this opcode was not
independently re-tested by us, we're taking emcot's documented order as
ground truth here since it was already fully specified.

### Opcode: E90C — TWO SUB-MODES, ONLY ONE CONFIRMED

**IMPORTANT: E90C is polymorphic.** The same opcode produces at least two
structurally different behaviors depending on the packet payload, and we
have NOT found a reliable byte-level discriminator between them. One
example (`8301e100e90c000f0f5d465bf00532374895` /
`...b0` — "blink" vs "rainbow") was sent as byte-identical except the
final (vibration) byte, and produced two different animation *shapes* on
separate test occasions (steady 4-corner strobe/fade vs. continuous
multi-color cycling — more than 5 distinct colors observed). This is
either a transcription issue, device-side internal state, or a dependency
on something outside the packet bytes (timing between packets, a
preceding ping, etc.) — root cause is UNRESOLVED.

**Because of this, DO NOT build a generic E90C parser that assumes one
fixed frame shape.** Instead:

- **Sub-mode A — "5 color palette" (CONFIRMED, Tier 1):** When byte index 6
  (0-indexed from `e1`) is `0x0f` AND bytes 7-11 all have mask bits `101`
  (top 3 bits), treat as a 5-color-palette frame — same decode as E909
  (same 5 color slots, same position order: Top Left, Bottom Left, Bottom
  Right, Top Right, Center). Confirmed example: `palette5` preset
  (`e100e90c000f0fb1b9b5b1a2307b7db0`) — all 5 slots decoded to distinct,
  plausible colors (yellow-orange, green, red, yellow-orange, blue) with
  mask=101 throughout.

- **Sub-mode B — animation/unknown (Tier 2, NOT decoded):** Any E90C
  packet that does not match the mask-101 signature above (e.g. the
  blink/rainbow example, where masks were `010`, `111`, `000`) should be
  routed to the Tier 2 fallback path (see Part 2). Do not attempt to
  extract colors from these — we don't have a validated model for what
  the bytes mean in this sub-mode.

### Opcode: E90E — CONFIRMED (most thoroughly tested opcode)

```
Frame: e1 00 | e9 0e | 00 | 01 | [structural] | C1 C2 C3 C4 C5 | [pattern/anim] [strobe] | 00 | ?? ?? | [vib]
idx:   0  1    2  3    4    5    6              7  8  9  10 11   12              13        14   15 16   17
```

**Byte 6 — structural, MUST remain `0x0f`.** Confirmed: corrupting this
byte (tested with `0xb2`) causes total frame failure — all LEDs off, only
vibration byte still processed. Any parser MUST validate this byte before
attempting to decode the rest of the frame as E90E; if it's not `0x0f`,
treat the whole packet as unparseable/Tier 2.

**Bytes 7-11 — 5 color slots, CONFIRMED position map (physical LED
mapping verified via isolated single-byte mutation tests against a real
band):**

| byte index | position   |
|---|---|
| 7  | Center       |
| 8  | Upper Right   |
| 9  | Bottom Right  |
| 10 | Bottom Left   |
| 11 | Upper Left    |

Each byte decodes via the standard `MMM CCCCC` structure and the shared
32-color palette table above.

**Byte 12 — pattern/subset selector + animate flag, CONFIRMED as a
two-part field, NOT the standard E905/E909 timing bitfield (that model was
tested and explicitly ruled out — flipping the always-on bit and changing
the time-value nibble both produced ~24s runtime with no measurable
difference).**

```
byte12 = PPPP AAAA
  PPPP (bits 7-4) = pattern ID
  AAAA (bits 3-0) = low nibble; low-nibble value 0x3 (vs baseline 0x9)
                     toggles animate -> static for a GIVEN pattern ID,
                     confirmed independently on pattern IDs 0x6 and 0x9
```

Confirmed pattern ID table (exhaustively tested 0x0–0xF):

| pattern ID (high nibble) | LEDs active | notes |
|---|---|---|
| 0x0–0x3 | none distinct / suppressed | static; needs cleaner isolated recheck before shipping as a named preset — treat as "off/minimal" for now |
| 0x4 | Upper Left, Upper Right, Bottom Left | ~2s |
| 0x5 | ALL 5 (Center, UR, BR, BL, UL) | ~24s — this is the reference/baseline pattern, notably longer duration than all others |
| 0x6 | Upper Right only | ~2s (flash) / static if low nibble = 0x3 |
| 0x7 | Upper Left, Upper Right | ~2s |
| 0x8–0xF | Upper Left, Upper Right, Bottom Right | ~2s — THIS IS A FIRMWARE FALLBACK/CLAMP, confirmed flat across all 8 values (0x8 through 0xF tested individually, byte-identical LED output for all). Implement this explicitly as "unknown pattern ID -> clamps to {UL, UR, BR} fallback" rather than as 8 separate cases.

**Byte 13 — strobe cadence/decay control. NOT fully modeled.** Confirmed
NOT to be a duration/timing value (ruled out via testing). Changing it
desyncs per-LED flash cadence (LEDs blink out of phase with each other
instead of in sync). Implement as an opaque "cadence" parameter passed
through to the animation renderer as a raw byte for now; do not attempt
to interpret its numeric meaning until further testing narrows it down.

**Bytes 12+13 combined = `0xFF 0xFF` — CONFIRMED special sentinel.**
This disables vibration (and likely the flash subsystem generally).
Implement as an explicit special case: if bytes 12-13 == `FFFF`, treat as
"disable timing/vibration" rather than running them through the normal
pattern/cadence decode.

**Byte 17 (last byte) — vibration byte.** Same vibration palette table
already documented by emcot.world / already used elsewhere in the
codebase. Reuse existing vibration decode logic.

**Bytes 14-16 — UNMAPPED. Do not guess.** Pass through as opaque/unknown
in the parsed output; do not attempt to interpret them.

### Opcode E910 (sparkle-style) — INVESTIGATED, PERMANENTLY TIER 2

Exhaustive single-byte mutation testing was performed across all 13
non-header bytes (indices 6-18) of a working baseline packet
(`e100e91000134897d00ea0d146060f30d04e07b0`). Unlike E909/E90E/E90C
sub-mode A, **no byte position produced a clean color change.** Every
mutation instead altered the overall *animation behavior class* — e.g.
switching between twinkle, chase, pulse+chase combo, hard-cut-then-fade,
circle/chase-then-pause, and multi-color cycling (observed cycling through
more than 5 distinct colors, which rules out a fixed 5-slot palette model
entirely). Two byte positions (idx 6, idx 7) produced `no_effect` when set
to the test marker value, which may indicate structural/validation bytes
similar to E90E's byte 6, or may simply mean the test marker value landed
on a no-op enum entry for those specific fields — not distinguished by
current testing.

**Conclusion: E910 does not use the same fixed
`[color][color][color][color][color][timing]` frame shape as E909/E90E/
E90C-sub-mode-A.** The payload appears to function as a parametric
animation descriptor where most/all bytes jointly determine behavior,
rather than independent per-LED color slots. This makes single-byte
mutation testing an unreliable method for further decoding — a different
approach (e.g. testing multi-byte field hypotheses, or grouping existing
notes by behavior family rather than byte position) would be needed to
make progress, and the effort-to-payoff ratio does not currently justify
it.

**Decision: E910 is permanently routed to the Tier 2 fallback path** (see
Part 2) unless a future investigation specifically revisits it with a new
methodology. Do not attempt a partial/heuristic color extraction for this
opcode.

### Opcode E913 (pulse-style) — INVESTIGATED, PERMANENTLY TIER 2

Same exhaustive single-byte sweep performed across all 16 non-header bytes
of a working baseline packet
(`e100e9130002d037f0d23d0505000efa8983510ee7a0b0`). Same conclusion as
E910: mutations altered pulse *rhythm/shape* (quick-then-long, heartbeat
double-beat, constant-on, fade-cut-fade) rather than isolating clean color
swaps. Four byte positions (idx 6, 8, 9, 14) produced `ignored`/no visible
change at the test marker value.

**Decision: E913 is permanently routed to the Tier 2 fallback path**
unless revisited, for the same reasons as E910.

### Known cross-device rendering behavior (NOT A BUG — do not "fix")

During E913 testing, the MagicBand+ and Starlight Wand were consistently
observed rendering **different colors from the identical packet** in a
stable, repeatable pairing (e.g. MagicBand+ purple / Starlight Wand lime,
across many separate tests with otherwise-unrelated byte changes). This is
almost certainly because each physical device applies its own
device-local color/calibration table when interpreting a shared palette
index — consistent with emcot.world's own documented note that raw color
values render with inconsistent relative brightness across R/G/B channels
due to uncalibrated LED voltages between units. **Do not attempt to find
a "MagicBand+ color byte" vs. "Starlight Wand color byte" in the
payload** — current evidence indicates this is a single shared color
index rendered differently per device, not two separate encoded values.
If exact color matching across both device types is ever required, it
will likely need a **per-device-type color correction table** applied at
render time (in the Android app, per the existing architecture
principle), not a change to how the palette index is parsed from the
packet.

### Opcodes E90F, E911, E912, E914, E91B

**Not yet investigated at all.** No isolated mutation testing has been
performed. All of these route to the Tier 2 fallback path until/unless
investigated.

---

## Part 2 — Tier 2 fallback path (unhandled opcodes/sub-modes)

For any E9xx packet that:
- Has an opcode not in the confirmed list above, OR
- Is E90C but fails the sub-mode-A structural check (mask != 101 across
  color slots), OR
- Fails a structural validation check (e.g. E90E byte 6 != 0x0f)

Do the following instead of attempting a partial/guessed decode:

1. Do NOT extract or apply colors from the raw bytes.
2. Look up the packet's opcode (and, if available, a normalized signature
   — e.g. opcode + byte length + a hash of the structural bytes) against
   the user's WLED-effect-mapping table (see Part 3). If the user has
   mapped this specific opcode/signature to a WLED preset, apply that
   preset directly — colors and all — ignoring the raw MagicBand+ payload
   entirely for rendering purposes.
3. If no mapping exists, fall back to the single hardcoded default preset
   (current behavior), but tag the event for the Android app's existing
   fuzzy/none match-quality flagging so it surfaces in Wand Lab review.
4. Always log the raw packet (opcode, full hex, timestamp) regardless of
   which path was taken, so it's available for later promotion to Tier 1
   if the user decodes it further.

This means Tier 2 is not "ignore unknown packets" — it's "let the user
assign a known WLED look to an opcode shape without needing us to solve
the byte encoding first."

---

## Part 3 — User-facing mapping UI

### Goal

Let the user say, in plain terms: "when the band sends an E910-shaped
packet [or: this specific unknown packet signature], run this WLED
preset" — without needing to understand bit layouts. Tier 1 opcodes get
richer options (since we can extract real color/timing data); Tier 2
opcodes get simpler "just run this preset" binding.

### Screen: "MagicBand+ Effect Mapping"

For each row, represent one **animation class**, not one raw opcode. An
animation class groups opcodes/sub-modes that behave the same way
structurally (a static multi-color layout vs. a cycling animation vs. a
pulse/fade). This keeps the UI from having 15 nearly-identical rows.

Confirmed animation classes to expose today:

| Animation class | Backing opcodes/sub-modes | What the user can configure |
|---|---|---|
| **Single Color** | E905 | WLED preset to run; color is taken from the decoded MagicBand+ byte (read-only, informational) or user can override with "always use this WLED preset's own colors instead" |
| **Dual Color** | E906 | Same pattern as above, 2 colors |
| **6-bit Color** | E908 | Same pattern, 1 RGB color |
| **5-Position Palette** | E909, E90C (sub-mode A) | WLED preset to run; user chooses whether decoded per-LED colors drive `seg.col`/`seg.i`, or the WLED preset's own colors are used unmodified |
| **5-Position Flash Pattern** | E90E | WLED preset to run; expose pattern ID (0-7, human labeled per the table above, e.g. "All 5 LEDs", "Upper Right Only") as informational context, since we don't yet know if pattern ID should influence WLED effect selection or just log for now |
| **Unclassified / Unknown** | Everything else (Tier 2), including E90C sub-mode B, E910 (investigated, permanently Tier 2 — see notes above), E913 (investigated, permanently Tier 2), E911, E912, E914, E90F, E91B (uninvestigated) | WLED preset to run (no color/timing extraction offered — bytes aren't decoded and, for E910/E913, are not expected to be decodable via this method). This is effectively "map this opcode blindly to a look you like." |

### Per-row UI elements

- Animation class name + short plain-language description (pull from this
  doc's "notes" language, not raw byte jargon)
  - e.g. for 5-Position Flash Pattern: "The band lights up in a
    changing subset of its 5 positions (all five, just one side, etc.)
    and can flash or hold steady."
- Dropdown: WLED preset to trigger (reuse existing preset picker component
  already used elsewhere in the app for zone-to-preset mapping)
- For Tier 1 classes with decoded color data: toggle — "Use MagicBand+
  colors" (drives `seg.col`/`seg.i` from decoded bytes) vs. "Always use
  preset's own colors" (ignore decoded bytes, just trigger the preset)
- Status badge: "Fully Decoded" (Tier 1) / "Partially Decoded" (if any
  sub-fields are still unknown, e.g. E90E's cadence byte) / "Unmapped
  Bytes — Preset Only" (Tier 2)
- For Unclassified rows specifically: since many different raw opcodes
  land here, allow the user to optionally narrow the mapping to a specific
  opcode (e.g. "only E913 packets" vs. "any unclassified packet") if they
  want per-opcode granularity even without a byte decode. Default is "any
  unclassified packet -> this preset" for simplicity.

### Non-UI requirement: expose the underlying signature for review

Alongside this screen (or accessible from it), surface a read-only list of
recently seen Tier 2 packets (opcode + raw hex + count seen + last seen
timestamp) sourced from the Android capture session logs already being
collected. This is not a new capture mechanism — just a view into data
already being gathered, to help the user notice patterns worth sending
through Wand Lab for further decoding.

---

## Implementation notes

- Follow the existing non-destructive migration pattern: new mapping data
  (animation-class -> WLED preset bindings) is new, additive config state.
  Default state for every animation class row should be "unmapped" and
  fall through to current hardcoded fallback behavior — do not change
  default rendering for anyone who hasn't configured mappings yet.
- Do not remove or rewrite the existing `applyUnknownE9Heuristic` /
  `looksLikePaletteByte` / `extractCandidatePalettes` functions. Instead,
  gate them behind the Tier 1 structural checks above — they should only
  run on packets that pass validation for a known opcode/sub-mode, not as
  a blind heuristic over arbitrary bytes.
- All parsing logic belongs in the Android app per the existing
  architecture principle (all API polling and protocol intelligence
  lives in the app; firmware stays BLE-command-driven only). Do not push
  any of this decode logic into firmware.
- New features must degrade gracefully across version mismatches per
  existing project principle — a firmware/app version that doesn't know
  about a given opcode should route it through Tier 2, not crash or
  silently drop it.
