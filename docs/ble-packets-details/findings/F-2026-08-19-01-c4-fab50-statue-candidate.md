---
id: F-2026-08-19-01
field: null
date: 2026-08-19
status: Unconfirmed
confidence: Low
supersedes: null
superseded_by: null
---

# Finding F-2026-08-19-01: 0xC4 payload may be Fab 50 statue beacons

**Field:** — (opcode-family flag, not a byte-field model yet)
**Date:** 2026-08-19
**Status:** Unconfirmed

## Hypothesis

Disney manufacturer packets whose payload **starts with `0xC4`** are Fab 50 statue BLE markers, distinct from MagicBand+ envelopes (`0xE0–E3`), show `0xE9`, wand casts, and other unclassified `"DISNEY"` traffic.

This is a **family identification hypothesis only**. No byte map, length rule, or behavior decode is claimed.

## Evidence

Field observation from park use (payload-leading `0xC4`), not yet attached as a hex sample table in this finding. Firmware previously lumped these into the generic Disney-CID catch-all (`tag=DISNEY`, `kind=UNKNOWN`), which is why they did not stand out in CSV captures.

## Test

Not yet run. Flag pass only (`STATUE?` / `C4_STATUE_CANDIDATE`) so subsequent captures can be isolated and sweep-tested.

## Suggested Test (to raise confidence)

1. Capture a known C4-leading packet at a Fab 50 statue (phone BLE capture + logic-board serial / `sw_debug` `c4_statue_candidate`).
2. Confirm the same leading byte is absent (or rare) away from statues on the same walk.
3. Replay via WandSimulator `/show` with the captured hex and record whether any LED / show-system reaction exists (none expected on Illuma until a decode exists).
4. Collect ≥10 distinct C4 payloads before proposing a structure.

## Result

Pending.

## Confidence

**Low** — field-sample-only hypothesis; no controlled test; no attached hex corpus in this finding.

## Supersedes / Superseded By

—
