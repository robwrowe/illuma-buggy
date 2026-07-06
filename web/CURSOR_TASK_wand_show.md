# Wand Lab web refactor — show/batch playback

## Context

`firmware/WandSimulator/WandSimulator.ino` gained two new capabilities on top
of its existing command set (nothing was removed — an earlier size-reduction
pass turned out to be chasing the wrong cause of an unrelated board issue and
was rolled back): a `raw <hex>` serial command, and a `POST /show` HTTP
endpoint for full parade/fireworks show playback — built so an entire
captured show can be replayed and have physical MagicBand+ bands / wands
respond as if they were in the park.

**Full HTTP + Serial contract**: [`firmware/WandSimulator/API.md`](../firmware/WandSimulator/API.md)
is the source of truth — endpoint shapes, the company-ID byte-prefix rules
(important: `/send hex` and `/show` hex expect *different* things), error
responses, blocking behavior. Read that before wiring anything up; don't
duplicate the contract here since it'll drift.

`web/index.html` is a single-file React app (no build step) with a "Wand Lab"
tab that already talks to WandSimulator over `/send` — that still works
unchanged and needs no fixes. This doc is just the spec for the one new
feature: a show/batch playback panel.

Captures come from the phone app (`app/src/utils/bleCapture.ts`,
`BleCaptureScreen.tsx`) as tab-delimited `.txt` files, columns:
`ts_ms  rssi  tag  hint  quality  func  hex  note`. `hex` is the raw
manufacturer-data payload as scanned over the air — it **already includes the
`8301` company-ID prefix** (this is the "hex with prefix" case in API.md's
table). Every real advertisement shows up twice in a row (duplicate BLE
channels), so any consumer must dedupe consecutive identical `hex` values.
See `ble-capture-cap_*.txt` for a real sample.

## New feature: show/batch playback panel

Add a panel (new tab or section within Wand Lab) that:

1. Accepts a capture `.txt` file (file input or drag-drop) in the format
   produced by `app/src/utils/bleCapture.ts` — reuse its parsing logic if it
   exports a parser; otherwise it's tab-separated with `#`-prefixed metadata
   lines to skip, columns as listed above.
2. Parses rows, **dedupes consecutive rows with identical `hex`**, and
   converts timestamps to hold durations: `holdMs[i] = ts_ms[i+1] - ts_ms[i]`
   between consecutive *distinct* packets (give the last step a sensible
   default, e.g. 3000ms).
3. Builds the `/show` request body: one `${holdMs} ${hex}` line per step,
   joined with `\n`. Don't touch or re-derive the hex — it's already the full
   captured payload, prefix included.
4. `POST`s the body to `http://${lab.simIp}/show` as plain text (not JSON —
   see API.md).
5. While `showActive` is true, poll `GET /status` every ~1s to show progress
   (`showStep` / `showTotal`) and offer a Stop button wired to `POST /stop`.
6. Nice-to-haves, not required for v1:
   - Playback speed multiplier (scale all `holdMs`).
   - Filter by the capture's `tag` column before sending, so a user can
     replay just `WAND-IDLE` or `MB+` rows for a shorter bench test.
   - Reuse the existing `lab.simIp` + `fetch` pattern already used by
     `sendBytes` (~line 4812 in `index.html`) rather than inventing a new one.

### Out of scope

- `app/src/utils/bleCapture.ts` / `BleCaptureScreen.tsx` — capture format is
  already correct, just consume its output.
- StrollerController firmware — unrelated to this change.
- The rest of the Wand Lab tab (single MB command builder, byte editor, log,
  segment-mapping test hints) — all unchanged, all still work as-is against
  current firmware. Nothing there needs fixing.
