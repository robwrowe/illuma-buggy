---
id: F-2026-08-17-01
field: style-flags
date: 2026-08-17
status: Working Theory
confidence: Medium-High
supersedes: null
superseded_by: null
---

# Finding F-2026-08-17-01: Pulse vs. Heartbeat Style-Flag Bit

**Field:** [style-flags.md](../fields/style-flags.md)
**Date:** 2026-08-17
**Status:** Working Theory

## Hypothesis

Within the `5B F0`-marked trailer skeleton (`... 0F <c1> <c2> 5B F0 <p1> <p2> 37 48 94 D1 3D
<fade> <cyc> B0`, observed under both the E9 10-length and E9 11-length payloads), the byte
immediately following the `5B F0` marker pair (`<p1>` above, anchor: `deltaBytes: 3` from the
`5B` byte, or equivalently `deltaBytes: 7` from the leading `E9`) contains a single bit flag at
bit position 6 (`0x40`) that selects between two named playback behaviors:

- Bit 6 = 0 → **Heartbeat**
- Bit 6 = 1 → **Pulse**

## Evidence

Six field-labeled samples (3 Heartbeat, 3 Pulse), same opcode/color/trailer shape, `<sub>` byte
constant at `0x05` across all six:

| Sample (full hex) | `p1` | Binary | Bit 6 | Label |
|---|---|---|---|---|
| `E910000505 0F4E59 5BF0 1820 374894D13D 05 0B` | `0x18` | `0011000` | 0 | Heartbeat |
| `E910000505 0F4E59 5BF0 1834 374894D13D 05 0A` | `0x18` | `0011000` | 0 | Heartbeat |
| `E910000505 0F4E59 5BF0 3134 374894D13D 05 07` | `0x31` | `0110001` | 0 | Heartbeat |
| `E910000505 0F4E59 5BF0 4040 374894D13D 09 05` | `0x40` | `1000000` | 1 | Pulse |
| `E910000505 0F4E59 5BF0 403F 374894D13D 05 1E` | `0x40` | `1000000` | 1 | Pulse |
| `E910000505 0F4E59 5BF0 4040 374894D13D 05 1E` | `0x40` | `1000000` | 1 | Pulse |

Zero counterexamples across the 6 samples. `<p2>` (the byte after `p1`) does **not** separate the
two groups on its own (Pulse shows `0x40`/`0x3F`/`0x40`, Heartbeat shows `0x20`/`0x34`/`0x34` —
no consistent threshold or bit) — ruled out as the discriminator, though its actual role is an
open question.

## Test

Not yet run. Evidence above is field-sample-only — six naturally-occurring captures with
consistent human-applied labels, not a controlled single-variable isolation test.

## Suggested Test (to raise confidence)

Take one known Pulse sample (`p1 = 0x40`), flip only bit 6 to 0 (e.g. `p1 = 0x18`, matching a
Heartbeat sample's value) while holding every other byte identical, and send via WandSimulator
(`POST /send`). If playback switches to Heartbeat behavior, the discriminator is confirmed and
`status` should move to `Confirmed`. If it does not, `status` should move to a new finding that
supersedes this one.

## Result

Pending.

## Confidence

**Medium-High** — clean, exceptionless separation across 6 independently field-labeled samples
spanning both the E9 10-length and E9 11-length payload shapes, but no controlled isolation test
has been run yet, so it remains one step short of `Confirmed`.

## Supersedes / Superseded By

—
