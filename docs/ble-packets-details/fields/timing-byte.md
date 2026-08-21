# Field: Timing Byte

## Status

Not yet migrated

## Current Model

Not yet migrated into the field-based model. Current source of truth is the project-root
`timing-byte.md` reference doc (bit layout: bits [3:0] time value, bits [5:4] fade-out time,
bit [6] timing scaler, bit [7] always-on flag). This file is a placeholder pointing to that
existing doc until a dedicated migration pass consolidates it here with anchor-relative position
data and a findings trail.

## Position

Not yet documented anchor-relative in this system — see project-root `timing-byte.md` for the
current offset conventions used per opcode doc in `../op-codes/`.

## Findings

- (None filed yet under this system.)

## Open Questions

- Migrate bit layout and confirmed examples from project-root `timing-byte.md` into this file.
- Establish anchor-relative position (this byte's offset appears to vary consistently relative
  to the `0F` marker across observed samples — confirm and document the anchor rule here rather
  than per-opcode).
