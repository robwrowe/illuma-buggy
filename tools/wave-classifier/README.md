# Webcam Waveform Classifier

Standalone batch CLI that drives [WandSimulator](../../firmware/WandSimulator/API.md)
through labeled effect rows, records the resulting light on a webcam **per LED
zone**, classifies the observed waveform (sine / sawtooth / triangle / square /
flat / irregular), detects two-color blend phase and cross-zone relationship,
and writes a triage table. The point is to shrink the human-review set — not to
replace the byte-level analysis pipeline under `docs/ble-packets-details/`, and
not to be the source of truth.

This tool does not touch firmware, the phone app, or the Vite web tool.

## Setup

```bash
cd tools/wave-classifier
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp config.example.toml config.toml # then set [wandsim] base_url
```

- Point a Logitech (or any UVC) webcam at a **fixed** wand / LED patch in a
  **dim room**, not daylight. Lock the framing; don't chase the light with the
  camera.
- Flash and connect WandSimulator per its own [API.md](../../firmware/WandSimulator/API.md)
  (`wifi <ssid> <password>`, then `http://illuma-wandsim.local` or the printed
  IP). WiFi/IP is **not** persisted across board reboots.

Python 3.11+ is preferred (`tomllib`). 3.10 works via a small TOML fallback.

## Framing: one ROI per LED, not one blob

The physical device has 5 independently addressable LED positions
(`topLeft`, `bottomLeft`, `bottomRight`, `topRight`, `center` — same names as
`web/src/lib/ble/mbConstants.ts`). Averaging the whole wand into one rectangle
muddies chase vs inner/outer cross-fade. Use a **slightly wider shot** with the
whole wand/band in frame so all 5 ROI boxes can be placed without overlapping.
Accept a lower per-zone pixel count in exchange for separability. Validate with
`select-rois`' composite preview: each box should land on a **single** LED, not
straddle two.

If the device is too small for 5 non-overlapping ROIs at the available
resolution/distance, `inner-outer` (2 ROIs: center vs the four corners as one
`outer` box) is a reasonable fallback even for nominally 5-corner rows — better
a coarser zone split than falling back to `single` and losing the distinction.
That fallback is recorded as `zone_layout_downgraded: true` on the trial's
report row, never silently substituted.

```bash
# Pick ROIs for each layout you will actually run (layouts are not shared)
python -m wave_classifier select-rois --zone-layout single
python -m wave_classifier select-rois --zone-layout five-corner
python -m wave_classifier select-rois --zone-layout inner-outer
```

Before trusting five-corner captures, white-highlight one LED at a time with
WandSimulator's `test topLeft` / `test center` / `test inner` / `test outer`
and confirm each saved box lands on the correct single LED.

`run` refuses to start if a trial in the filtered set needs a layout with no
saved ROI set, and prints the `select-rois --zone-layout …` command to fix it.

## Quickstart

```bash
cd tools/wave-classifier

# 1. Frame the zones (see above)
python -m wave_classifier select-rois --zone-layout single

# 2. Confirm the xlsx parse before burning camera time
python -m wave_classifier run \
  --xlsx ../../Op_Codes_Captured.xlsx \
  --sheet efx_pulse \
  --dry-run

# 3. Capture a small slice, then the Cross-saw / Cross-fade ground-truth sheet
python -m wave_classifier run \
  --xlsx ../../Op_Codes_Captured.xlsx \
  --base-url http://illuma-wandsim.local \
  --sheet efx_pulse --limit 3 --hold-ms 4000

python -m wave_classifier run \
  --xlsx ../../Op_Codes_Captured.xlsx \
  --base-url http://illuma-wandsim.local \
  --sheet efx_cross --hold-ms 4000
```

Re-classify existing CSVs after tweaking thresholds (no board/camera):

```bash
python -m wave_classifier report-only \
  --xlsx ../../Op_Codes_Captured.xlsx \
  --min-template-correlation 0.55
```

Hex from `Op_Codes_Captured.xlsx`'s `Hex` column is sent to `POST /show`
**verbatim** (full advertisement, `8301` included). Payload-only hex from a
second labeled sheet (no `8301` prefix) is **not** sent to `/send` — that
endpoint blocks for the hold, so the webcam would start after the effect ended.
Those rows get `8301E100` prepended (`envelope_assumed: true`) and go through
`/show` like everything else.

## Extra ground-truth sources

`--groundtruth-tsv` accepts a 3-column TSV/CSV (`Effective Code`, `Effect`,
`Description`) whose hex is payload-only. The same shape is also auto-detected
if it appears as a new worksheet in the xlsx (header match, not a fixed sheet
name). Duplicate hex across sources is captured once; both labeled rows are
kept in the report (`source_sheet_kind`).

**Keyed notes are the preferred path.** Re-export field notes with at least a
hex or row-id column and pass `--keyed-notes`. Unkeyed one-note-per-line files
(`--notes-file`) cannot be joined to trials — they only feed
`reports/groundtruth-vocabulary.csv` and `reports/unfiled-byte-hypotheses.md`.

Known vocabulary gap vs `blend.py`'s closed labels: field notes often say
`ping-pong` and `twinkle` (`SW Twinkle` is now in the closed list; bare
`ping-pong` is not). Extend the classifier labels only if you decide those are
first-class effect families.

```bash
python -m wave_classifier groundtruth \
  --xlsx ../../Op_Codes_Captured.xlsx \
  --groundtruth-tsv path/to/second-sheet.tsv \
  --notes-file path/to/unkeyed-notes.txt
```

## Build a hypothesized tail

`build` ports Wand Lab's `assembleTailPayload()` so a tail that doesn't exist
in either labeled corpus can still be broadcast or captured:

```bash
python -m wave_classifier build \
  --tail "30 7B 00" \
  --timing-byte 0x64 \
  --color-format 0f \
  --color 0x12 --mask 0 \
  --color 0x04 --mask 0

# Fire it once (no capture)
python -m wave_classifier build ... --show --base-url http://illuma-wandsim.local

# Emit a TrialRow JSON, then capture/classify it with the normal pipeline
python -m wave_classifier build ... --label "hyp-chase" --emit-trial-row builder/hyp.json
python -m wave_classifier run --builder-trials builder/ --base-url http://illuma-wandsim.local
```

## Webcam auto-exposure / auto-white-balance actively fights this tool

A 30 fps webcam is plenty to separate a linear ramp+reset (sawtooth) from a
smooth rounded peak (sine) on sub-5 Hz effects — **unless the camera is
riding its own gain**. Auto-exposure and auto-WB reshape the trace into
something that is no longer the LED's waveform.

`capture.py` attempts to disable both (`CAP_PROP_AUTO_EXPOSURE`,
`CAP_PROP_AUTO_WB`), reads the values back, and prints a one-line warning if
the set didn't take:

> Auto-exposure could not be disabled on this camera/OS — waveform shape may
> be distorted by the camera's own gain-adjustment; on Linux try
> `v4l2-ctl -d /dev/videoN -c auto_exposure=1`

If you see that warning, fix exposure at the OS/driver before trusting
classifications. Dim room + fixed target + locked exposure is the whole
optical setup.

## What the reports are (and aren't)

`reports/triage-<timestamp>.csv` — every trial, machine-readable, including
per-zone waveform/blend columns, `zone_layout`, `zone_relationship`,
`outer_chase_direction`, `zone_relationship_status`, and estimated
period/frequency/amplitude/cycle count.

`reports/review-needed-<timestamp>.md` — disagreements (including
`zone_relationship_status == disagree`), capture failures, inconsistent
repeats, and low-confidence rows, grouped by xlsx **sheet** then
`effect_label`. Multi-zone entries include a per-zone breakdown table.
Evidence tables are shaped to paste into
`docs/ble-packets-details/findings/_template.md`.

`reports/discovered-patterns-<timestamp>.md` — **candidates worth testing**,
not findings. Hedged language only. This tool never writes into
`docs/ble-packets-details/findings/` or `fields/`.

`op_code` appears as a **display label only**. It is a length-derived artifact
(`payload_length = length_byte + 2`), not a behavior family — see
[length-byte.md](../../docs/ble-packets-details/fields/length-byte.md). Do not
treat E9-0B vs E9-11 as effect categories.

**Confidence scores are a triage aid, not a finding.** Any row that moves from
`reports/review-needed-*.md` into an actual
`docs/ble-packets-details/findings/F-YYYY-MM-DD-NN-*.md` still needs a human
to fill in `Status` / `Confidence` per that template's own rules. This tool
does not auto-file findings.

Repeats (`--repeat N`) that disagree with each other are flagged
`inconsistent_repeats` and listed under **Re-run recommended** rather than
averaged away — same-payload / different-outcome is a real case
([F-2026-08-26-01](../../docs/ble-packets-details/findings/F-2026-08-26-01-e90b-chase-speed-byte.md)).

Pulse vs Heartbeat is a style-flag bit
([F-2026-08-17-01](../../docs/ble-packets-details/findings/F-2026-08-17-01-pulse-heartbeat-style-flag.md)),
not something a webcam brightness trace reliably separates. Expect those two
labels to collide; that's a review row, not a classifier bug.

## Config knobs

See `config.example.toml`. CLI flags override TOML. The ones that change
classification without a recapture:

| Key | Default | Meaning |
|---|---|---|
| `classify.noise_floor_pct` | 0.03 | Below this fraction of 0–255 → `flat` |
| `classify.min_template_correlation` | 0.6 | Below this → `irregular` (review), not a forced fit |
| `classify.review_confidence_threshold` | 0.6 | Agreeing rows below this still go to review-needed |
| `classify.cycle_tolerance_pct` | 0.25 | Measured period vs xlsx Cycle Length; above this → disagree |
| `discover.min_group` | 3 | Min trials per bit-group value before a discovery candidate is surfaced |

Capture timing: `settle_margin_ms` (default 500), `gap_seconds` (default 1.5).

## Test plan

1. `select-rois --zone-layout five-corner`, then WandSimulator `test <segment>`
   (`test topLeft`, `test center`, …) to confirm each box is the correct single
   LED. Repeat for `inner-outer` with `test inner` / `test outer`.
2. `run --dry-run --sheet efx_pulse` — confirm trial count and hex strings.
3. `run --sheet efx_pulse --limit 3` — inspect the raw per-zone CSVs by eye
   before trusting the classifier.
4. `run --sheet efx_cross` — check both `agree`/`disagree` label counts **and**
   `zone_relationship_status` counts (`Sync?` / `5-Zones?` live on this sheet).
5. `run --sheet efx_chase` — five-corner path; check `outer_chase_direction`
   against the sheet's `Direction` column.
6. `report-only` after editing `min_template_correlation` — threshold tuning
   must not require recapturing.
7. `groundtruth --dry-run --groundtruth-tsv <path>` — payload-only hex detected,
   length-byte check passes for every E9-leading row.
8. `build --tail "30 7B 00" --timing-byte 0x64 --color-format 0f --color 0x12 --mask 0 --color 0x04 --mask 0`
   — printed hex starts `8301E100E9` and the derived length byte matches part count.
9. `discover.py` against a captured `efx_cross`/`efx_chase` set should re-surface
   the already-confirmed F-2026-08-17-01 (style-flag bit 6) and F-2026-08-26-01
   (speed bits[6:4]) as high-separation candidates — if it doesn't, tune ranking
   before trusting unknown positions.
