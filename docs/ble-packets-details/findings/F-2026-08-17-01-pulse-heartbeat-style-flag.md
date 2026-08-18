---
id: F-2026-08-17-01
field: style-flags
date: 2026-08-17
status: Confirmed
confidence: High
supersedes: null
superseded_by: null
---

# Finding F-2026-08-17-01: Pulse vs. Heartbeat Style-Flag Bit

**Field:** [style-flags.md](../fields/style-flags.md)
**Date:** 2026-08-17
**Status:** Confirmed

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
| `E911000C0F 55555B F018 2037 4894D13D05 0B B0` | `0x18` | `0011000` | 0 | Heartbeat |
| `E91100010F 48485B F018 3437 4894D13D05 0A B0` | `0x18` | `0011000` | 0 | Heartbeat |
| `E91100020F 4E4D5B F031 3437 4894D13D05 07 B0` | `0x31` | `0110001` | 0 | Heartbeat |
| `E91100010F 54535B F040 4037 4894D13D09 05 B0` | `0x40` | `1000000` | 1 | Pulse |
| `E91100480F 43485B F040 3F37 4894D13D05 1E B0` | `0x40` | `1000000` | 1 | Pulse |
| `E91100660F 44445B F040 4037 4894D13D05 1E B0` | `0x40` | `1000000` | 1 | Pulse |

Zero counterexamples across the 6 samples. `<p2>` (the byte after `p1`) does **not** separate the
two groups on its own (Pulse shows `0x40`/`0x3F`/`0x40`, Heartbeat shows `0x20`/`0x34`/`0x34` —
no consistent threshold or bit) — ruled out as the discriminator, though its actual role is an
open question.

## Test

Ran as specified. Took a known Pulse sample (`p1 = 0x40`), flipped only bit 6 to 0 (matching
a Heartbeat sample's `p1 = 0x18`) while holding every other byte identical, and sent via
WandSimulator (`POST /send`).

## Suggested Test (to raise confidence)

Take one known Pulse sample (`p1 = 0x40`), flip only bit 6 to 0 (e.g. `p1 = 0x18`, matching a
Heartbeat sample's value) while holding every other byte identical, and send via WandSimulator
(`POST /send`). If playback switches to Heartbeat behavior, the discriminator is confirmed and
`status` should move to `Confirmed`. If it does not, `status` should move to a new finding that
supersedes this one.

Executed; see Result.

## Result

Playback switched to Heartbeat. Hypothesis confirmed — bit 6 (`0x40`) is the Pulse / Heartbeat
discriminator. Status moved to `Confirmed`.

## Confidence

**High** — clean, exceptionless separation across 6 independently field-labeled samples, plus a
controlled single-bit isolation test via WandSimulator that flipped only bit 6 and switched
playback as predicted.

## Supersedes / Superseded By

—
