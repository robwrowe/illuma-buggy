# Wave-classifier local backend

Thin FastAPI wrapper around [`tools/wave-classifier/`](../wave-classifier/) so
Wand Lab (Tail Builder, Packet Sequence, Analyzer bit-grid) can **Observe**
webcam captures without reimplementing classification in the browser.

This is a **LAN bench tool**. It talks to a local webcam and a WandSimulator
board. Do not expose it past localhost. The GitHub Pages build of the web tool
does not run this server — Observe controls disable with a tooltip when
`GET /health` is unreachable.

## Setup

```bash
cd tools/wave-classifier
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
# Optional: makes `import wave_classifier` work from any cwd.
# The server already puts this directory on sys.path, so it is not required
# just to run uvicorn. Old pip (21.x on macOS 3.9) needs the upgrade above
# or it will refuse `pip install -e .` even though pyproject.toml is present.
pip install -e .

cd ../wave-classifier-server
pip install -r requirements.txt
```

The server needs Python 3.9+. macOS Xcode Python 3.9 is fine; do not use
`str | None` in Pydantic models on 3.9 (PEP 604 is 3.10).

ROI sets still come from the CLI (one-time):

```bash
cd ../wave-classifier
python -m wave_classifier select-rois --zone-layout single
# and/or five-corner / inner-outer
```

Share the same `tools/wave-classifier/config.toml` for `[wandsim] base_url`
and `[capture.rois.*]`. Copy `config.example.toml` if you have not already.

## Run

From `tools/wave-classifier-server/`, with the wave-classifier venv active:

```bash
uvicorn server:app --port 8420 --reload
```

`GET http://localhost:8420/health` → `{"ok": true, "wave_classifier_version": "..."}`.

Then `cd web && npm run dev`. Wand Lab's Simulator IP field is the board;
**Wave-classifier backend** (default `http://localhost:8420`) is this process.

## Endpoints

| Method | Path | Role |
|---|---|---|
| GET | `/health` | Static-site fallback probe |
| POST | `/build` | Single-tail `build_payload()` |
| POST | `/build-batch` | `parse_tail_block()` + loop `build_payload()` (no files) |
| POST | `/show` | `wandsim_client.show_single()` + best-effort `stop()` |
| POST | `/observe` | Capture + classify ≤10 payloads (blocking). Writes `reports/observe-*.{csv,md,json}`. Paste the `.md` into Claude. 409 if no ROI. 400 if >10 (use the CLI). |
| POST | `/discover` | Rank bit-position candidates from existing `captures/` |

`/observe` does not pick ROIs. If the requested `zone_layout` has no saved
set, it returns 409 pointing at `select-rois --zone-layout …`.

Large sweeps still belong on the CLI: `build-batch` then
`run --builder-trials` (`--resume`, repeats). This backend is for a handful
of tails from the web UI.
