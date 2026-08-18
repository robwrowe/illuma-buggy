# Field: Length Byte (Retired Opcode Theory)

## Status

Confirmed

## Current Model

The byte immediately following the Disney identifier and the two purpose-unknown bytes (the
byte previously read as an "E9 sub-opcode," e.g. the `0F`/`10`/`11`/`13` in `E9 0F`/`E9 10`/
`E9 11`/`E9 13`) is a **length byte**, not a behavior-category selector:

```text
payload_length = sub_opcode_byte + 2
```

Confirmed with zero exceptions across 4,779 captured packets. This retires the earlier "E9 11 =
base+chase 3-zone effect" style category theory used throughout `../op-codes/` — those groupings
reflected payload length, not a designed behavior family. Behavior is instead governed by the
independent fields documented elsewhere in this folder (mask+color, timing, vibration, style
flags), addressed anchor-relative to markers rather than to this byte's value.

## Position

- **Anchor-relative (primary):** Immediately follows the two purpose-unknown bytes after the
  Disney identifier prefix (i.e. the byte at `deltaBytes: 3` from the leading `E9`).
- **Absolute offset table (cross-check only):**

  | Payload length | Absolute offset |
  |---|---|
  | all observed lengths | 3 |

## Findings

- (Pre-dates the findings system — established via bulk structural analysis across the full
  4,779-packet capture set, referenced in project memory. Backfill a proper finding entry here
  if/when the original analysis is reconstructed as a dated finding.)

## Open Questions

- None outstanding on the length-byte behavior itself. Open question is downstream: which
  opcode docs' category framing needs the disclaimer/migration first.
