# Field: Mask + Color

## Status

Not yet migrated

## Current Model

Not yet migrated into the field-based model. Current source of truth is the project-root
`color-and-mask-palette.md` reference doc (bits [7:3] = color palette index, bits [2:0] = mask
pattern). This file is a placeholder pointing to that existing doc until a dedicated migration
pass consolidates it here with anchor-relative position data and a findings trail.

## Position

Not yet documented anchor-relative in this system — see project-root `color-and-mask-palette.md`
and the relevant `../op-codes/` docs for current offset conventions.

## Findings

- (None filed yet under this system.)

## Open Questions

- Migrate the 5-bit color palette table and 3-bit mask table from project-root
  `color-and-mask-palette.md` into this file.
- Confirm whether the `bitCount: 8` full-byte treatment used by several shipped rules (e.g.
  `e9-0f/10_pulse_dual`'s colorSources) versus the 5-bit palette-index treatment described in
  `color-and-mask-palette.md` are two genuinely different color encodings in use across
  different fields, or one has been mis-modeled — this needs a dedicated finding.
