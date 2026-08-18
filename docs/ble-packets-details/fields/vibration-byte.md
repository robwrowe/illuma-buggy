# Field: Vibration Byte

## Status

Unconfirmed

## Current Model

Identified structurally by a high nibble of `0xB` in the last byte position, per prior bulk
capture analysis (see project memory). No bit-level layout confirmed yet — unlike the timing
byte or mask+color field, the individual bits within this byte have not been isolated.

## Position

- **Anchor-relative (primary):** Last byte of the payload (trailer terminator position) —
  working assumption based on prior bulk analysis, not yet confirmed via a dedicated anchor
  test against a marker byte.
- **Absolute offset table (cross-check only):**

  | Payload length | Absolute offset |
  |---|---|
  | N | (last byte, i.e. `N - 1`) |

## Findings

- (None filed yet under this system — the high-nibble-0xB identification pre-dates the findings
  system. Backfill a proper finding entry here if/when that original analysis is reconstructed
  as a dated finding.)

## Open Questions

- What do the low nibble bits actually encode (intensity? pattern? duration?)?
- Is "last byte of payload" the correct anchor, or does it coincidentally line up with a
  different, more meaningful marker-relative position?
