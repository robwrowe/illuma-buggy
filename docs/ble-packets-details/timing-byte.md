# Timing Byte

This describes the timing scaler / mechanism

```text
0000 00 0 0b
││││ ││ │ │
││││ ││ │ └─ Bit    [7] - Always on flag
││││ ││ │
││││ ││ └─── Bit    [6] - Timing scaler
││││ ││
││││ └┴───── Bits [5-4] - Fade-out time value
││││
└┴┴┴──────── Bits [3-0] - Time value
```

## Bits Breakdown

### Bit [7] - Always On Flag (confirmed misnomer — see below)

- `0b` = normal timing behavior, uses the scaler formula (bit 6)
- `1b` = **confirmed real effect**, but not literal "always-on": on_time = `7.6 × t` instead
  of the normal scaler formulas — a much longer timeout, not an indefinite one. Only tested
  with the scaler bit (bit 6) at 0 so far; the scaler=1 combination is untested. Fade behaves
  normally under this mode. "Extended-timeout mode" is a more accurate name than "always-on."

### Bit [6] - Timing Scaler

- `0b` = on_time ≈ `1.6 × t` (good fit, small residuals)
- `1b` = on_time = `3.0 × t` (confirmed exact, zero error across 3 points)

### Bits [5-4] - Fade-out Time

The total time for the light to fade off.

- `00b` = no fade (confirmed)
- `01b` = 0.5s fade (confirmed)
- `10b` = 1.0s fade (untested, but fits the ×0.5s pattern)
- `11b` = 1.5s fade (confirmed)

### Bits [3-0] - Time Value

`0000b` - `1111b`, feeds the `on_time` formula above (0-15)

**CAUTION**
t=0 does NOT mean "0 seconds on."

Confirmed to produce a flat 3-second on-time instead (tested at scaler=0, fade=0) —
looks like a reserved fallback value rather than a literal zero
in the formula.

Not yet confirmed whether this fallback holds
under other scaler/fade combinations — if you need a short but
nonzero on-time, prefer t=1 (1.5s or 3s depending on scaler)
over t=0 until that's settled.

## Examples

### `0x09`

```text
0000 1001b
││││ ││││
││││ │└┴┴─── Bit    [7] - Always on flag        = 0b (normal timing)
││││ │
││││ └────── Bit    [6] - Timing scaler         = 0b (on_time ≈ 1.6×t)
││││
││└┴──────── Bits [5-4] - Fade-out time value   = 00b (no fade)
││
└┴────────── Bits [3-0] - Time value            = 1001b (9 decimal)
```

Time Value: `9`

Fade-out Time: `0s` (none)

Timing Scale: `0` (1.6×t)

Predicted on-time: `1.6 × 9 = 14.4s`

**Confirmed real-world match:** this is the exact byte from the "Purple" test packet
(`0x8301 E100 E905 00 09 0E ED B0`), which was observed on for **14.5s** — a 0.1s difference
from prediction, well within the small residual margin seen across every scaler=0 test.

---

### `0x11`

```text
0001 0001b
││││ ││││
││││ │└┴┴─── Bit    [7] - Always on flag        = 0b (normal timing)
││││ │
││││ └────── Bit    [6] - Timing scaler         = 0b (on_time ≈ 1.6×t)
││││
││└┴──────── Bits [5-4] - Fade-out time value   = 01b (0.5s fade)
││
└┴────────── Bits [3-0] - Time value            = 0001b (1 decimal)
```

Time Value: `1`

Fade-out Time: `0.5s`

Timing Scale: `0` (1.6×t)

Predicted on-time: `1.6 × 1 = 1.6s`

**Confirmed real-world match:** this byte was used in both the "Teal" and "Blue" test
packets (`0x8301 E100 E905 00 11 0E F7 B0` and `0x8301 E200 E905 00 11 0E E4 B0`) — same
timing byte, different colors, both independently observed at **1.5s on, 0.5s fade**. The
fade time matches the formula exactly; the on-time is 0.1s under prediction, consistent with
the small residuals seen elsewhere at scaler=0.

---

### `0x33`

```text
0011 0011b
││││ ││││
││││ │└┴┴─── Bit    [7] - Always on flag        = 0b (normal timing)
││││ │
││││ └────── Bit    [6] - Timing scaler         = 0b (on_time ≈ 1.6×t)
││││
││└┴──────── Bits [5-4] - Fade-out time value   = 11b (1.5s fade)
││
└┴────────── Bits [3-0] - Time value            = 0011b (3 decimal)
```

Time Value: `3`

Fade-out Time: `1.5s`

Timing Scale: `0` (1.6×t)

Predicted on-time: `1.6 × 3 = 4.8s`

**Confirmed real-world match:** this is the "Green" test packet
(`0x8301 E100 E905 00 33 0E E0 BD`), observed at **5.0s on, 1.5s fade**. Fade matches the
formula exactly; on-time is 0.2s over prediction — the largest of the scaler=0 residuals
seen so far, still small relative to the total duration.

---

### `0x12`

```text
0001 0010b
││││ ││││
││││ │└┴┴─── Bit    [7] - Always on flag        = 0b (normal timing)
││││ │
││││ └────── Bit    [6] - Timing scaler         = 0b (on_time ≈ 1.6×t)
││││
││└┴──────── Bits [5-4] - Fade-out time value   = 01b (0.5s fade)
││
└┴────────── Bits [3-0] - Time value            = 0010b (2 decimal)
```

Time Value: `2`

Fade-out Time: `0.5s`

Timing Scale: `0` (1.6×t)

Predicted on-time: `1.6 × 2 = 3.2s`

**Confirmed real-world match:** this is the "Red" test packet
(`0x8301 E200 E905 00 12 0E F5 BB`), observed at **3.0s on, 0.5s fade**, plus a 1-second
vibration (carried in the separate vibration byte, `0xBB`, not this timing byte). Fade
matches exactly; on-time is 0.2s under prediction.

---

### `0xBB`

```text
1011 1011b
││││ ││││
││││ │└┴┴─── Bit    [7] - Always on flag        = 1b (extended-timeout mode — CONFIRMED, see below)
││││ │
││││ └────── Bit    [6] - Timing scaler         = 0b (extended-mode formula applies instead of 1.6×t)
││││
││└┴──────── Bits [5-4] - Fade-out time value   = 11b (1.5s fade)
││
└┴────────── Bits [3-0] - Time value            = 1011b (11 decimal)
```

Time Value: `11`

Fade-out Time: `1.5s`

Extended-timeout mode: `1` (on_time = 7.6×t, not the normal 1.6×t/3.0×t scaler formulas)

Predicted on-time: `7.6 × 11 = 83.6s`

**Confirmed real-world result:** this exact byte was tested twice. First test: 90s on, no
fade observed. Retest: 84s on, 1.5s fade — matching the fade formula exactly and landing
close to the 83.6s prediction. The first test's "no fade" reading and slightly longer 90s
duration don't match the retest or the formula, and are best explained as an observation
slip rather than a real effect — every other byte tested under this mode (including several
with the same fade_bits) faded normally and fit the 7.6×t formula within 0.6s. **Bit 7 is
confirmed to be real** — it substantially extends the on-time using its own formula — but it
is **not** a literal "stays on forever" flag as the name suggests; it still times out, just
much later than normal. "Extended-timeout mode" is a more accurate name than "always-on."
