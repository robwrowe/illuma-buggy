# Webcam Waveform Classifier

Standalone batch CLI that drives [WandSimulator](../../firmware/WandSimulator/API.md)
through the labeled effect rows in `Op_Codes_Captured.xlsx`, records the resulting
light on a webcam, classifies the observed waveform (sine / sawtooth / triangle /
square / flat / irregular), detects two-color blend phase, and writes a triage
table. The point is to shrink the human-review set — not to replace the
byte-level analysis pipeline under `docs/ble-packets-details/`, and not to be
the source of truth.

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

## Quickstart

```bash
cd tools/wave-classifier

# 1. Frame the lit patch and save [capture] roi to config.toml
python -m wave_classifier select-roi

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

Hex from the xlsx `Hex` column is sent to `POST /show` **verbatim** (full
advertisement, `8301` included). The tool never strips or re-adds a company-ID
prefix — that off-by-one is the most likely bug in this API, and `/show` is
the path that takes capture bytes as-is.

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

`reports/triage-<timestamp>.csv` — every trial, machine-readable.

`reports/review-needed-<timestamp>.md` — only disagreements, capture failures,
inconsistent repeats, and low-confidence rows, grouped by xlsx **sheet** (the
human-assigned effect family) then `effect_label`. Evidence tables are shaped
to paste into `docs/ble-packets-details/findings/_template.md`.

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

Capture timing: `settle_margin_ms` (default 500), `gap_seconds` (default 1.5).

## Test plan

1. `select-roi` against a known-solid color (`POST /send {"line":"mb red"}` or
   `sw solid <color>`) to confirm framing and exposure lock visually.
2. `run --dry-run --sheet efx_pulse` — confirm trial count and hex strings.
3. `run --sheet efx_pulse --limit 3` — inspect the raw CSVs by eye before
   trusting the classifier.
4. `run --sheet efx_cross` — Cross-saw / Cross-fade ground truth; check
   agree / disagree counts in the printed summary.
5. `report-only` after editing `min_template_correlation` — threshold tuning
   must not require recapturing.
