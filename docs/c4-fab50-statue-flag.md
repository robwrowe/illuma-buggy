# 0xC4 — candidate Fab 50 statue beacon (unconfirmed)

**Status:** Hypothesis / flag-only. Not a decode.  
**Date:** 2026-08-19  
**Finding:** [F-2026-08-19-01](./ble-packets-details/findings/F-2026-08-19-01-c4-fab50-statue-candidate.md)

## What this is

Field observation (not a lab-confirmed decode): Disney-CID packets whose **payload leads with `0xC4`** may be Fab 50 statue beacons (park sculptures with embedded BLE markers).

Until this flag pass, those frames fell through `classifyScanPacket()` to generic `"DISNEY"` and `decodeDisneyPayload()` to `UNKNOWN` — same buckets as every other unclassified CID packet — so they did not stand out in CSV `tag`/`hint` columns.

## What firmware does now

| Layer | Behavior |
|---|---|
| Scanner / logic `isDisneyMfr()` | Bare `0xC4` is a recognized payload signature (same treatment as bare `0xE9` / `0xCD`) |
| `classifyScanPacket()` | Tag `"STATUE?"` — the `?` marks unconfirmed classification |
| `decodeDisneyPayload()` | `DisneyPacketKind::C4_STATUE_CANDIDATE`, `hasRawFallback=1`, opcode = first two payload bytes |
| `applyParsedDisneyPacket()` | Rate-limited `sw_debug` notify `reason: "c4_statue_candidate"` (400 ms) |

No palette/mask/timing structure is invented. Rule matching uses the raw fallback path like other undecoded-but-recognized families.

## Phone capture

`app/src/utils/phoneBleScan.ts` mirrors the firmware classifier so phone-side CSVs / Sheets `tag` show `STATUE?` (hint: `STATUE? (Fab 50 candidate, unconfirmed)`). Dual-board field captures are primarily phone-native scan; the scanner does not BLE-notify the app.

## Out of scope

- No rule-engine JSON / `findMatchingRule` special case
- No WandLab / web-tool changes
- No payload-structure decode — sweep-test after enough samples (WandSimulator)
