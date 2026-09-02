"""Local FastAPI wrapper around wave_classifier. LAN bench tool — localhost only."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

SERVER_DIR = Path(__file__).resolve().parent
CLASSIFIER_ROOT = SERVER_DIR.parent / "wave-classifier"
if str(CLASSIFIER_ROOT) not in sys.path:
    sys.path.insert(0, str(CLASSIFIER_ROOT))

from wave_classifier import __version__ as WC_VERSION  # noqa: E402
from wave_classifier.cli import (  # noqa: E402
    CAPTURES_DIR,
    DEFAULT_CONFIG,
    EXAMPLE_CONFIG,
    REPORTS_DIR,
    load_config,
    rois_from_config,
    default_xlsx_path,
)
from wave_classifier.discover import discover_candidates  # noqa: E402
from wave_classifier.payload_builder import (  # noqa: E402
    build_payload,
    built_payload_to_json,
    parse_tail_block,
)
from wave_classifier.triage import (  # noqa: E402
    build_reports,
    classify_trial,
    trial_report_to_dict,
    write_observe_bundle,
)
from wave_classifier.xlsx_loader import ZoneLayoutHint, load_trials, trial_from_dict  # noqa: E402
from wave_classifier.zones import preferred_capture_layout  # noqa: E402
from wave_classifier.wandsim_client import WandSimError  # noqa: E402

app = FastAPI(title="wave-classifier-server", version=WC_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"https?://("
        r"localhost|127\.0\.0\.1"
        r"|192\.168\.\d{1,3}\.\d{1,3}"
        r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
        r")(:\d+)?"
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OBSERVE_MAX_PAYLOADS = 10

# One logical Observe run may span several ≤10-payload HTTP calls. Process-local
# only — this is a single-operator LAN bench tool (one uvicorn process).
_PENDING_RUNS: Dict[str, list] = {}


def accumulate_observe_run(pending, run_id, seq, total, report_objs):
    """Append this chunk. Returns ('pending', acc) or ('write', acc) for the last chunk."""
    acc = pending.setdefault(run_id, [])
    acc.extend(report_objs)
    last_chunk = total is None or (seq is not None and int(seq) >= int(total))
    if last_chunk:
        return "write", pending.pop(run_id)
    return "pending", acc


def discard_observe_run(pending, run_id):
    if run_id:
        pending.pop(run_id, None)


def safe_report_path(filename: str, reports_dir: Path = REPORTS_DIR) -> Path:
    """Resolve a path inside reports_dir. Allows one nested folder; rejects .."""
    name = (filename or "").strip().replace("\\", "/")
    if not name or name.startswith("/") or ".." in Path(name).parts:
        raise HTTPException(400, "invalid filename")
    root = reports_dir.resolve()
    path = (root / name).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        raise HTTPException(400, "invalid filename") from None
    if not path.is_file():
        raise HTTPException(404, "report not found")
    return path


def _cfg():
    path = DEFAULT_CONFIG if DEFAULT_CONFIG.is_file() else EXAMPLE_CONFIG
    return load_config(path if path.is_file() else None)


def _intish(value: Any) -> int:
    if isinstance(value, int):
        return value
    text = str(value).strip().lower()
    if text.startswith("0x"):
        return int(text, 16)
    return int(float(text)) if text else 0


def _wandsim_url(explicit: Optional[str] = None) -> str:
    url = (explicit or "").strip() or (_cfg().get("wandsim") or {}).get("base_url") or ""
    if not url:
        raise HTTPException(
            400,
            "WandSimulator base_url missing — pass it or set [wandsim] base_url in "
            "tools/wave-classifier/config.toml",
        )
    return url.rstrip("/")


def _build_kwargs(body: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "timing_byte": _intish(body["timing_byte"]),
        "color_format": str(body["color_format"]),
        "colors": list(body.get("colors") or []),
        "vibration": None if body.get("vibration") is None else _intish(body["vibration"]),
        "envelope": str(body.get("envelope") or "e1"),
    }


class BuildBody(BaseModel):
    tail: str
    timing_byte: Any
    color_format: str
    colors: List[Dict[str, Any]] = Field(default_factory=list)
    vibration: Any = None
    envelope: str = "e1"


class BuildBatchBody(BaseModel):
    tails_text: str
    timing_byte: Any
    color_format: str
    colors: List[Dict[str, Any]] = Field(default_factory=list)
    vibration: Any = None
    envelope: str = "e1"
    label_prefix: Optional[str] = None


class ShowBody(BaseModel):
    hex_full: str
    hold_ms: int = 4000
    base_url: Optional[str] = None


class ObservePayload(BaseModel):
    hex_full: str
    label: Optional[str] = None
    tail_index: Optional[int] = None
    color_count: Optional[int] = None
    expected_colors: Optional[List[Dict[str, Any]]] = None


class ObserveBody(BaseModel):
    payloads: List[ObservePayload]
    hold_ms: int = 4000
    repeat: int = 1
    # "auto" = richest configured ROI set. Do not require the operator to
    # classify inner/outer vs five-corner — those share 2-color sawtooth.
    zone_layout: Optional[str] = "auto"
    base_url: Optional[str] = None
    run_id: Optional[str] = None
    run_seq: Optional[int] = None  # 1-indexed chunk number
    run_total_chunks: Optional[int] = None
    timeline: bool = False
    hz: Optional[float] = None
    calibrate: bool = False
    black_flash_ms: int = 0
    also_classify: bool = False


@app.get("/health")
def health():
    return {"ok": True, "wave_classifier_version": WC_VERSION}


@app.post("/build")
def api_build(body: BuildBody):
    built = build_payload(tail_bytes=body.tail, **_build_kwargs(body.model_dump()))
    return built_payload_to_json(built)


@app.post("/build-batch")
def api_build_batch(body: BuildBatchBody):
    tails, skipped = parse_tail_block(body.tails_text)
    kwargs = _build_kwargs(body.model_dump())
    items = []
    for i, tail in enumerate(tails, start=1):
        built = build_payload(tail_bytes=tail, **kwargs)
        rec = built_payload_to_json(built)
        rec["line"] = i
        rec["tail_hex"] = " ".join(f"{b:02X}" for b in tail)
        if body.label_prefix:
            rec["label"] = f"{body.label_prefix}-{i:03d}"
        items.append(rec)
    return {"payloads": items, "skipped_line_numbers": skipped, "count": len(items)}


@app.post("/show")
def api_show(body: ShowBody):
    from wave_classifier.wandsim_client import show_single, stop

    url = _wandsim_url(body.base_url)
    show_single(url, body.hex_full, body.hold_ms)
    time.sleep(max(0, body.hold_ms) / 1000.0)
    try:
        stop(url)
    except Exception:
        pass
    return {"ok": True}


@app.post("/observe")
def api_observe(body: ObserveBody):
    from wave_classifier.capture import MissingRoiSet, run_captures

    run_id = (body.run_id or "").strip() or None
    try:
        if len(body.payloads) > OBSERVE_MAX_PAYLOADS:
            raise HTTPException(
                400,
                f"{len(body.payloads)} payloads exceeds /observe's small-batch limit "
                f"({OBSERVE_MAX_PAYLOADS}). Use `python -m wave_classifier run --builder-trials` "
                "for large sweeps (resumable, --repeat).",
            )
        if not body.payloads:
            raise HTTPException(400, "payloads is empty")
        cfg = _cfg()
        rois_by_layout = rois_from_config(cfg)
        requested = (body.zone_layout or "auto").strip().lower()
        auto_layout = requested not in {"single", "five-corner", "inner-outer"}
        if auto_layout:
            layout = preferred_capture_layout(rois_by_layout).layout
        else:
            layout = requested
        if layout not in rois_by_layout and not (
            layout == "five-corner" and "inner-outer" in rois_by_layout
        ):
            raise HTTPException(
                409,
                f"no ROI configured for zone_layout={layout} — run "
                f"`python -m wave_classifier select-rois --zone-layout {layout}` first",
            )
        url = _wandsim_url(body.base_url)
        capture = cfg.get("capture") or {}
        classify = cfg.get("classify") or {}
        device = int(capture.get("device_index", 0))
        settle = int(capture.get("settle_margin_ms", 500))
        gap = float(capture.get("gap_seconds", 1.5))
        noise = float(classify.get("noise_floor_pct", 0.03))
        min_corr = float(classify.get("min_template_correlation", 0.6))

        trials = []
        for i, p in enumerate(body.payloads):
            hint = ZoneLayoutHint()
            if layout == "five-corner":
                hint.five_zones = "Y"
            elif layout == "inner-outer":
                hint.layout = "Inner/Outer"
            else:
                hint.five_zones = "N"
            rec = {
                "sheet": "observe",
                "row_id": p.label or f"observe:{i + 1}",
                "row_index": i + 1,
                "hex_full": p.hex_full,
                "effect_label": p.label,
                "source_sheet_kind": "builder",
            }
            if p.color_count is not None:
                rec["color_count"] = int(p.color_count)
            if p.expected_colors:
                rec["expected_colors"] = list(p.expected_colors)
            row = trial_from_dict(rec, source_kind="builder")
            row.zone_layout_hint = hint
            if auto_layout:
                row.notes.append(
                    f"zone_layout_auto: captured as {layout} (richest configured ROIs; "
                    "not a packet classification of inner/outer vs five-corner)"
                )
            trials.append(row)

        cap_kw = {
            "off_confirm_timeout_ms": int(capture.get("off_confirm_timeout_ms", 5000)),
            "off_max_brightness": float(capture.get("off_max_brightness", 25)),
            "lit_timeout_ms": int(
                capture.get("lit_timeout_ms", max(4000, int(body.hold_ms) // 2))
            ),
            "use_timing_hold": True,
            "calibrate_black_flash_ms": int(capture.get("calibrate_black_flash_ms", 500)),
            "calibrate_color_hold_ms": int(capture.get("calibrate_color_hold_ms", 3000)),
        }
        try:
            cap_results = run_captures(
                trials,
                base_url=url,
                captures_dir=CAPTURES_DIR,
                device_index=device,
                rois_by_layout=rois_by_layout,
                hold_ms=body.hold_ms,
                settle_margin_ms=settle,
                gap_seconds=gap,
                repeats=max(1, body.repeat),
                macos_uvc=(cfg.get("capture") or {}).get("macos_uvc") or {},
                black_flash_ms=max(0, int(body.black_flash_ms or 0)),
                calibrate=bool(body.calibrate),
                **cap_kw,
            )
        except MissingRoiSet as exc:
            raise HTTPException(409, str(exc)) from exc
        except WandSimError as exc:
            raise HTTPException(
                502,
                f"{exc} — check Wand Lab Simulator IP (sent as base_url) and that the board is on WiFi.",
            ) from exc

        by_hex = {r.trial.hex_key: r for r in cap_results}
        extra = {
            "captures_dir": str(CAPTURES_DIR / "observe"),
            "capture_layout": layout,
            "capture_layout_auto": auto_layout,
        }
        if body.timeline:
            from wave_classifier.capture import parse_capture_stem, read_samples_csv
            from wave_classifier.palette import load_calibration
            from wave_classifier.timeline import build_timeline_report
            from wave_classifier.timeline_report import (
                timeline_report_to_dict,
                write_timeline_bundle,
            )
            from wave_classifier.triage import timestamp_slug

            cal = load_calibration()
            extra["calibration_source"] = cal.source
            extra["calibration_age_s"] = cal.age_s
            report_objs = []
            reports = []
            for trial in trials:
                cr = by_hex.get(trial.hex_key)
                paths = list(getattr(cr, "csv_paths", None) or [])
                series = {}
                for p in paths:
                    zone, _rep = parse_capture_stem(p.stem, trial.row_id_safe)
                    series[zone] = read_samples_csv(p)
                fps = getattr(cr, "measured_fps", None) if cr else None
                baseline = getattr(cr, "baseline_frame_range", None) if cr else None
                tl = build_timeline_report(
                    trial,
                    series,
                    trial.expected_colors,
                    cal,
                    hz=body.hz,
                    measured_fps=fps,
                    baseline_tick_range=baseline,
                )
                report_objs.append(tl)
                reports.append(timeline_report_to_dict(tl))
            extra["report_kind"] = "timeline"

            def _write_tl(objs):
                return write_timeline_bundle(REPORTS_DIR, objs, stamp=timestamp_slug())

            write_fn = _write_tl
        else:
            report_objs = []
            reports = []
            for trial in trials:
                cr = by_hex.get(trial.hex_key)
                paths = list(getattr(cr, "csv_paths", None) or [])
                status = getattr(cr, "capture_status", "ok") if cr else "missing_csv"
                err = getattr(cr, "error", None) if cr else None
                report = classify_trial(
                    trial,
                    paths,
                    noise_floor_pct=noise,
                    min_template_correlation=min_corr,
                    capture_status=status,
                    capture_error=err,
                )
                report_objs.append(report)
                reports.append(trial_report_to_dict(report, capture_paths=paths))
            extra["report_kind"] = "classify"
            write_fn = lambda objs: write_observe_bundle(REPORTS_DIR, objs)

        if run_id:
            action, accumulated = accumulate_observe_run(
                _PENDING_RUNS, run_id, body.run_seq, body.run_total_chunks, report_objs
            )
            if action == "write":
                paths_out = write_fn(accumulated)
            else:
                return {
                    "reports": reports,
                    "count": len(reports),
                    "report_csv": None,
                    "report_md": None,
                    "report_json": None,
                    "run_pending": True,
                    **extra,
                }
        else:
            paths_out = write_fn(report_objs)
        out = {
            "reports": reports,
            "count": len(reports),
            "report_csv": str(paths_out["csv"]),
            "report_md": str(paths_out["md"]),
            "report_json": str(paths_out.get("json") or ""),
            "run_pending": False,
            **extra,
        }
        if body.also_classify and body.timeline:
            class_objs = []
            class_reports = []
            for trial in trials:
                cr = by_hex.get(trial.hex_key)
                paths = list(getattr(cr, "csv_paths", None) or [])
                status = getattr(cr, "capture_status", "ok") if cr else "missing_csv"
                err = getattr(cr, "error", None) if cr else None
                report = classify_trial(
                    trial,
                    paths,
                    noise_floor_pct=noise,
                    min_template_correlation=min_corr,
                    capture_status=status,
                    capture_error=err,
                )
                class_objs.append(report)
                class_reports.append(trial_report_to_dict(report, capture_paths=paths))
            class_paths = write_observe_bundle(REPORTS_DIR, class_objs)
            out["classify_reports"] = class_reports
            out["classify_report_md"] = str(class_paths["md"])
        return out
    except Exception:
        discard_observe_run(_PENDING_RUNS, run_id)
        raise


@app.get("/reports/{filename:path}")
def api_report(filename: str):
    path = safe_report_path(filename)
    suffix = path.suffix.lower()
    if suffix == ".md":
        media = "text/markdown"
    elif suffix == ".csv":
        media = "text/plain"
    elif suffix == ".json":
        media = "application/json"
    else:
        media = "text/plain"
    return FileResponse(path, media_type=media, filename=path.name)


@app.post("/discover")
def api_discover(min_group: int = Query(3)):
    xlsx = default_xlsx_path()
    if not xlsx.is_file():
        return {"candidates": [], "note": f"xlsx not found at {xlsx}; nothing to classify"}
    cfg = _cfg()
    classify = cfg.get("classify") or {}
    trial_set = load_trials(xlsx)
    reports = build_reports(
        trial_set,
        captures_dir=CAPTURES_DIR,
        noise_floor_pct=float(classify.get("noise_floor_pct", 0.03)),
        min_template_correlation=float(classify.get("min_template_correlation", 0.6)),
    )
    cands = discover_candidates(reports, min_group=min_group)
    out = []
    for c in cands:
        bits = f"[{c.bit_start + c.bit_width - 1}:{c.bit_start}]" if c.bit_width > 1 else f"[{c.bit_start}]"
        out.append({
            "tail_index": c.tail_index,
            "group_name": c.group_name,
            "bit_range": bits,
            "outcome": c.outcome,
            "score": c.score,
            "n_trials": c.n_trials,
            "groups": {str(k): v for k, v in c.groups.items()},
            "confirmed_match": c.confirmed_match,
            "unfiled_overlap": c.unfiled_overlap,
        })
    return {"candidates": out, "count": len(out)}
