# Field: Style Flags

## Status

Working Theory

## Current Model

Within the `5B F0`-marked trailer skeleton, the byte immediately following the `5B F0` marker
pair contains at least one confirmed bit:

```text
p1 byte
xxx0 000b
    │
    └─ Bit [6] (0x40) - Pulse / Heartbeat selector
           0 = Heartbeat
           1 = Pulse
```

All other bits of this byte: role unconfirmed.

## Position

- **Anchor-relative (primary):** 3 bytes after the first `5B` marker byte (i.e. immediately
  after the `5B F0` pair).
- **Absolute offset table (cross-check only — do not treat as authoritative):**

  | Payload length | Absolute offset |
  |---|---|
  | 18 (E9 10-length payloads) | 9 |
  | 19 (E9 11-length payloads) | 9 |

## Findings

- [F-2026-08-17-01](../findings/F-2026-08-17-01-pulse-heartbeat-style-flag.md) — Pulse vs.
  Heartbeat selector on bit 6 — **Confidence: High** (Confirmed)

## Open Questions

- What do bits 0–5 and 7 of this byte control?
- Does this bit hold the same meaning outside the `5B F0` skeleton (e.g. under the `58 F4`
  skeleton)?
- Does the `<sub>` (length) byte interact with this flag, or is it fully independent? Only
  `<sub> = 0x05` has been tested so far.
- What does `<p2>` (the byte immediately after this one) actually control, now that it's ruled
  out as the Pulse/Heartbeat discriminator?
