---
id: F-2026-08-26-01
title: E9-0B chase — bits[6:4] of trailing timing byte is a speed/step-rate value; apparent zone count is a per-zone dwell-time threshold effect, not a direct field
opcode: E9 (sub 0x0B, chase family)
tags: [e9_0b, chase, timing-byte, zone-count]
confidence: confirmed
---

## Hypothesis

An earlier working hypothesis was that "zone count" (3 vs. 4 vs. 5 visually
distinct chase zones) is encoded as a discrete value somewhere in the E9-0B
chase payload — either as its own field or as a sub-field of the trailing
timing byte.

## Evidence

### Round 1 — confounded field samples (rejected)
Six field-captured E9-0B/E9-0C packets, labeled 3-zone / 5-zone from
observation, were compared. Every byte except the trailing timing byte
varied in lockstep with color choice and show, so no single byte or bit
cleanly separated the two groups — multiple "clean" bit separators appeared
by chance on this small N and did not replicate.

### Round 2 — same-payload, different-outcome (disproved "static field" theory)
A prior bench-test finding (`mt9i102yvqzl` / `mt9i1884adp6`) showed the
**exact same hex payload** (`e91100020f5d555bf03134374894d13d0507b0`)
producing an observed 4-zone result in one capture and a 3-zone result in
another. This proved that for that family, zone count as strictly counted
by eye is not always deterministic from the static payload alone —
motivating a real single-variable sweep rather than further comparison of
uncontrolled field logs.

### Round 3 — controlled single-variable sweep (confirmed)
Rob ran a bench sweep holding every byte constant except the trailing
timing byte, decrementing it by `0x10` each step:

| Hex  | Binary     | bits[6:4] | Observed |
|------|------------|-----------|----------|
| `7D` | `01111101` | `111` = 7 | color visible in 3 of 5 zones, equally |
| `6D` | `01101101` | `110` = 6 | color visible in 4 of 5 zones (4th is short) |
| `5D` | `01011101` | `101` = 5 | color visible in 4 of 5 zones, equally |
| `4D` | `01001101` | `100` = 4 | color visible in 5 of 5 zones (5th is short) |
| `3D` | `00111101` | `011` = 3 | color visible in 5 of 5 zones, equally |

Note: all 5 physical LED zones are driven throughout the sweep. What
varies is how many of those 5 zones register a given color for a
consistent duration versus a foreshortened one — not which zones are
active, and not brightness (brightness is consistent across the sweep).

`timeval` (bits [3:0]) was held constant at `13 (0xD)` across the whole
sweep, confirming the sweep was genuinely single-variable.

Per `timing-byte.md`, bits [6] and [5:4] are separately documented as
"Timing Scaler" and "Fade-out Time." Read individually, `03D`'s scaler bit
flips to `0` while its 2-bit fade-out value wraps back to `3`, which looked
like a discontinuity. Read together as one 3-bit value spanning bits
[6:4], the sweep is a clean monotonic countdown: `7, 6, 5, 4, 3` — with no
discontinuity.

## Interpretation

Bits [6:4] of the E9-0B trailing byte behave as a single 3-bit
speed/step-rate value (0–7), not as two independently meaningful sub-fields
in this context. The existing per-bit documentation in `timing-byte.md`
(scaler / fade-out as separate fields) may still be correct for the *fade*
opcode families (E9-11) where it was originally derived — this finding
does not contradict that reading for those families, only for the E9-0B
chase context, where it currently makes more sense as one combined field.

**Apparent "zone count" (3-of-5, 4-of-5, 5-of-5) is not itself a payload
field, and it is not which physical zones are active.** All 5 physical
zones are driven at every step rate in this sweep. What changes is the
per-zone dwell time for a given color as the chase cycles through: at
faster step rates (bits[6:4] = 7, 6) the chase advances through the cycle
fast enough that some zones only catch a foreshortened, easy-to-miss dose
of a given color, so only 3 (or 4) of the 5 zones read as clearly showing
that color. As the step rate slows (bits[6:4] = 5, 4, 3), each zone holds
the color long enough to register clearly, so all zones read as "equal" —
moving the apparent count up from 3-of-5 to 4-of-5 to 5-of-5. This also
explains why the elusive "4-zone" case was hard to reproduce earlier —
`6D` and `5D` both read as "4 of 5" but are visually distinct (short 4th
vs. equal 4th), so slight timing/observation differences could easily tip
a capture into reading as 3-of-5 or 5-of-5 instead.

## Result

- Zone-count-as-payload-field hypothesis (i.e. a field that selects which
  or how many of the 5 physical zones are active): **rejected** — all 5
  zones are driven at every step rate tested; a same-byte, different-
  outcome case in earlier field logs first flagged this, and the
  controlled sweep confirms zone activity is constant while only dwell
  time changes.
- bits[6:4]-as-3-bit-speed-value hypothesis: **confirmed** for E9-0B chase,
  based on a controlled 5-point single-variable sweep with zero exceptions.
  Apparent "N of 5 zones showing a color" is a downstream visual effect of
  this speed value, not a separately encoded count.

## Open questions / next test

- Sweep has only been run from `0x7D` down to `0x3D` (speed values 7→3).
  Extend to `0x2D`, `0x1D`, `0x0D` (speed values 2, 1, 0) to see whether
  apparent zone count continues climbing past 5, plateaus, or wraps.
- Confirm whether this 3-bit-combined-field reading also holds for E9-0C
  (same chase family, one byte longer) and whether it holds for non-chase
  E9 sub-opcodes (e.g. E9-11 fade family) where the original scaler/fadeout
  split was documented, or whether the split-field reading still applies
  there specifically.
- Once the top end of the range is mapped, confirm whether "zone count"
  should be renamed in documentation as a derived/computed property rather
  than continuing to track it as if it were a distinct wire field.
