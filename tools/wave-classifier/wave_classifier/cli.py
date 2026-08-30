"""CLI: `python -m wave_classifier run|select-roi|report-only`."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .triage import (
    build_reports,
    summarize,
    timestamp_slug,
    write_review_markdown,
    write_triage_csv,
)
from .xlsx_loader import TrialSet, filter_trials, load_trials

TOOL_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = TOOL_ROOT.parent.parent
CAPTURES_DIR = TOOL_ROOT / "captures"
REPORTS_DIR = TOOL_ROOT / "reports"
EXAMPLE_CONFIG = TOOL_ROOT / "config.example.toml"
DEFAULT_CONFIG = TOOL_ROOT / "config.toml"


def _load_toml(path: Path) -> dict[str, Any]:
    try:
        import tomllib
    except ImportError:  # Python < 3.11
        return _load_toml_minimal(path)
    with path.open("rb") as fh:
        return tomllib.load(fh)


def _load_toml_minimal(path: Path) -> dict[str, Any]:
    """Tiny subset parser for this tool's config (tables + string/int/float/array)."""
    data: dict[str, Any] = {}
    section: str | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip()
            data.setdefault(section, {})
            continue
        if "=" not in line or section is None:
            continue
        key, val = [p.strip() for p in line.split("=", 1)]
        data[section][key] = _parse_toml_value(val)
    return data


def _parse_toml_value(val: str) -> Any:
    if val.startswith('"') and val.endswith('"'):
        return val[1:-1]
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        if not inner:
            return []
        return [_parse_toml_value(p.strip()) for p in inner.split(",")]
    if val.lower() in {"true", "false"}:
        return val.lower() == "true"
    if re.fullmatch(r"-?\d+", val):
        return int(val)
    if re.fullmatch(r"-?\d+\.\d+", val):
        return float(val)
    return val


def default_xlsx_path() -> Path:
    for candidate in (
        Path("Op_Codes_Captured.xlsx"),
        REPO_ROOT / "Op_Codes_Captured.xlsx",
        Path.cwd() / "Op_Codes_Captured.xlsx",
    ):
        if candidate.is_file():
            return candidate.resolve()
    return Path("Op_Codes_Captured.xlsx")


def load_config(path: Path | None) -> dict[str, Any]:
    cfg: dict[str, Any] = {}
    if EXAMPLE_CONFIG.is_file():
        cfg = _load_toml(EXAMPLE_CONFIG)
    chosen = path or (DEFAULT_CONFIG if DEFAULT_CONFIG.is_file() else None)
    if chosen is not None and chosen.is_file():
        overlay = _load_toml(chosen)
        for section, values in overlay.items():
            if isinstance(values, dict):
                cfg.setdefault(section, {}).update(values)
            else:
                cfg[section] = values
    return cfg


def save_roi(config_path: Path, roi: tuple[int, int, int, int]) -> None:
    line = f"roi = [{roi[0]}, {roi[1]}, {roi[2]}, {roi[3]}]"
    if config_path.is_file():
        text = config_path.read_text(encoding="utf-8")
        if re.search(r"^roi\s*=", text, flags=re.M):
            text = re.sub(r"^roi\s*=\s*\[[^\]]*\]", line, text, count=1, flags=re.M)
        else:
            if "[capture]" in text:
                text = text.replace("[capture]", f"[capture]\n{line}", 1)
            else:
                text += f"\n[capture]\n{line}\n"
        config_path.write_text(text, encoding="utf-8")
        return
    if EXAMPLE_CONFIG.is_file():
        text = EXAMPLE_CONFIG.read_text(encoding="utf-8")
        text = re.sub(r"^roi\s*=\s*\[[^\]]*\]", line, text, count=1, flags=re.M)
        config_path.write_text(text, encoding="utf-8")
        return
    config_path.write_text(
        "[capture]\n"
        f"{line}\n"
        "device_index = 0\n"
        "settle_margin_ms = 500\n"
        "gap_seconds = 1.5\n",
        encoding="utf-8",
    )


def _cfg_get(cfg: dict[str, Any], section: str, key: str, default: Any) -> Any:
    return cfg.get(section, {}).get(key, default)


def _add_shared_args(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--config",
        type=Path,
        default=None,
        help=f"TOML config (default: {DEFAULT_CONFIG} if present, else config.example.toml)",
    )
    p.add_argument(
        "--xlsx",
        type=Path,
        default=None,
        help="Op_Codes_Captured.xlsx path (default: repo root or cwd)",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m wave_classifier",
        description=(
            "Drive WandSimulator through labeled xlsx effect rows, record webcam "
            "waveforms, and write a triage table of low-confidence / disagreeing rows."
        ),
    )
    parser.add_argument("--version", action="version", version=f"wave_classifier {__version__}")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="load xlsx, optionally capture, classify, write reports")
    _add_shared_args(run)
    run.add_argument(
        "--base-url",
        default=None,
        help="WandSimulator base URL (required unless --dry-run). Not persisted across board reboots.",
    )
    run.add_argument("--sheet", default=None, help="Only this xlsx sheet (e.g. efx_cross, efx_pulse)")
    run.add_argument("--limit", type=int, default=None, help="Max unique hex payloads to capture")
    run.add_argument("--hold-ms", type=int, default=4000, help="Per-trial /show hold time in ms")
    run.add_argument("--repeat", type=int, default=1, help="Independent capture cycles per unique hex")
    run.add_argument("--device-index", type=int, default=None, help="OpenCV camera index")
    run.add_argument("--gap-seconds", type=float, default=None, help="Pause between trials")
    run.add_argument("--settle-margin-ms", type=int, default=None, help="Extra grab time after hold_ms")
    run.add_argument(
        "--noise-floor-pct",
        type=float,
        default=None,
        help="Flat-signal threshold as a fraction of 0–255 (config classify.noise_floor_pct)",
    )
    run.add_argument(
        "--min-template-correlation",
        type=float,
        default=None,
        help="Below this, waveform_class is irregular (config classify.min_template_correlation)",
    )
    run.add_argument(
        "--review-confidence-threshold",
        type=float,
        default=None,
        help="Agreeing rows below this still land in review-needed-*.md",
    )
    run.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse xlsx and print the trial list; do not touch camera or network",
    )
    run.add_argument(
        "--select-roi",
        action="store_true",
        help="Pick an ROI before capturing (same as the select-roi subcommand)",
    )

    roi = sub.add_parser("select-roi", help="Pick a webcam ROI and save it to config.toml")
    roi.add_argument("--config", type=Path, default=None)
    roi.add_argument("--device-index", type=int, default=None)

    report = sub.add_parser(
        "report-only",
        help="Re-classify existing captures/ CSVs without driving the board or camera",
    )
    _add_shared_args(report)
    report.add_argument("--sheet", default=None)
    report.add_argument("--limit", type=int, default=None)
    report.add_argument("--noise-floor-pct", type=float, default=None)
    report.add_argument("--min-template-correlation", type=float, default=None)
    report.add_argument("--review-confidence-threshold", type=float, default=None)

    return parser


def _resolve_xlsx(args: argparse.Namespace) -> Path:
    if args.xlsx:
        return args.xlsx
    return default_xlsx_path()


def _print_dry_run(trial_set: TrialSet) -> None:
    unique = trial_set.unique_capture_trials()
    print(f"trials: {len(trial_set.trials)}  unique hex: {len(unique)}")
    sheets: dict[str, int] = {}
    for t in trial_set.trials:
        sheets[t.sheet] = sheets.get(t.sheet, 0) + 1
    print("sheets: " + ", ".join(f"{k}={v}" for k, v in sorted(sheets.items())))
    n_dup = sum(1 for t in trial_set.trials if t.duplicate_count > 1)
    n_len = sum(1 for t in trial_set.trials if any("length mismatch" in n for n in t.notes))
    n_vib = sum(1 for t in trial_set.trials if any("vibration_byte_mismatch" in n for n in t.notes))
    n_unlabeled = sum(1 for t in trial_set.trials if not t.effect_label)
    print(f"duplicate-hex rows: {n_dup}  length mismatches: {n_len}  vib mismatches: {n_vib}  unlabeled: {n_unlabeled}")
    print("")
    print(f"{'row_id':<28} {'effect':<14} {'#':>3} {'len':>4} hex")
    for t in unique[:40]:
        hex_show = t.hex_key[:36] + ("…" if len(t.hex_key) > 36 else "")
        print(
            f"{t.row_id:<28} {(t.effect_label or '—'):<14} "
            f"{t.color_count if t.color_count is not None else '—':>3} "
            f"{t.length_byte if t.length_byte is not None else '—':>4} {hex_show}"
        )
    if len(unique) > 40:
        print(f"... {len(unique) - 40} more unique payloads")
    print("")
    print("hex strings are sent to POST /show verbatim (8301 included). No prefix stripping.")


def _write_and_summarize(
    reports,
    *,
    review_threshold: float,
) -> int:
    CAPTURES_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = timestamp_slug()
    csv_path = REPORTS_DIR / f"triage-{stamp}.csv"
    md_path = REPORTS_DIR / f"review-needed-{stamp}.md"
    write_triage_csv(csv_path, reports)
    n_flagged = write_review_markdown(
        md_path,
        reports,
        review_threshold=review_threshold,
        generated_at=stamp,
    )
    counts = summarize(reports)
    extra = ""
    if counts.get("inconsistent_repeats"):
        extra = f"  inconsistent_repeats={counts['inconsistent_repeats']}"
    print(
        f"agree={counts['agree']}  disagree={counts['disagree']}  "
        f"unlabeled={counts['unlabeled']}  capture_failed={counts['capture_failed']}"
        f"{extra}  review_flagged={n_flagged}"
    )
    print(f"wrote {csv_path}")
    print(f"wrote {md_path}")
    return 0


def cmd_select_roi(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    from .capture import pick_roi

    device = args.device_index if args.device_index is not None else int(_cfg_get(cfg, "capture", "device_index", 0))
    roi = pick_roi(device)
    dest = args.config or DEFAULT_CONFIG
    save_roi(dest, roi)
    print(f"wrote ROI to {dest}")
    return 0


def cmd_run(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    xlsx = _resolve_xlsx(args)
    trial_set = filter_trials(load_trials(xlsx), sheet=args.sheet, limit=args.limit)
    n_len = sum(1 for t in trial_set.trials if any("length mismatch" in n for n in t.notes))
    if n_len:
        print(f"warning: {n_len} rows have length_byte+2 vs decoded payload length mismatch (kept; see report notes)")
    if args.dry_run:
        print(f"xlsx: {xlsx}")
        _print_dry_run(trial_set)
        return 0

    config_path = args.config or DEFAULT_CONFIG
    if args.select_roi:
        from .capture import pick_roi

        device = args.device_index if args.device_index is not None else int(_cfg_get(cfg, "capture", "device_index", 0))
        roi = pick_roi(device)
        save_roi(config_path, roi)
        cfg.setdefault("capture", {})["roi"] = list(roi)
        print(f"wrote ROI to {config_path}")

    base_url = args.base_url or _cfg_get(cfg, "wandsim", "base_url", None)
    if not base_url:
        print(
            "error: --base-url is required (or set [wandsim] base_url in config.toml). "
            "WandSimulator does not persist IP across reboots.",
            file=sys.stderr,
        )
        return 2

    roi = _cfg_get(cfg, "capture", "roi", None)
    if not roi:
        print("error: no ROI in config — run `python -m wave_classifier select-roi` first", file=sys.stderr)
        return 2

    device = args.device_index if args.device_index is not None else int(_cfg_get(cfg, "capture", "device_index", 0))
    gap = args.gap_seconds if args.gap_seconds is not None else float(_cfg_get(cfg, "capture", "gap_seconds", 1.5))
    settle = (
        args.settle_margin_ms
        if args.settle_margin_ms is not None
        else int(_cfg_get(cfg, "capture", "settle_margin_ms", 500))
    )
    noise = (
        args.noise_floor_pct
        if args.noise_floor_pct is not None
        else float(_cfg_get(cfg, "classify", "noise_floor_pct", 0.03))
    )
    min_corr = (
        args.min_template_correlation
        if args.min_template_correlation is not None
        else float(_cfg_get(cfg, "classify", "min_template_correlation", 0.6))
    )
    review = (
        args.review_confidence_threshold
        if args.review_confidence_threshold is not None
        else float(_cfg_get(cfg, "classify", "review_confidence_threshold", 0.6))
    )

    unique = trial_set.unique_capture_trials()
    print(
        f"capturing {len(unique)} unique hex ({len(trial_set.trials)} labeled rows) "
        f"hold_ms={args.hold_ms} repeat={args.repeat} roi={roi}"
    )

    def on_trial(i: int, n: int, trial) -> None:
        print(f"[{i + 1}/{n}] {trial.row_id}  {trial.effect_label or '—'}  {trial.hex_key[:20]}…")

    from .capture import run_captures

    try:
        cap_results = run_captures(
            unique,
            base_url=base_url,
            captures_dir=CAPTURES_DIR,
            device_index=device,
            roi=roi,
            hold_ms=args.hold_ms,
            settle_margin_ms=settle,
            gap_seconds=gap,
            repeats=args.repeat,
            on_trial=on_trial,
        )
    except KeyboardInterrupt:
        print("\ninterrupted — stopping WandSimulator")
        cap_results = []

    by_hex = {r.trial.hex_key: r for r in cap_results}
    reports = build_reports(
        trial_set,
        captures_dir=CAPTURES_DIR,
        noise_floor_pct=noise,
        min_template_correlation=min_corr,
        capture_results=by_hex,
    )
    return _write_and_summarize(reports, review_threshold=review)


def cmd_report_only(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    xlsx = _resolve_xlsx(args)
    trial_set = filter_trials(load_trials(xlsx), sheet=args.sheet, limit=args.limit)
    noise = (
        args.noise_floor_pct
        if args.noise_floor_pct is not None
        else float(_cfg_get(cfg, "classify", "noise_floor_pct", 0.03))
    )
    min_corr = (
        args.min_template_correlation
        if args.min_template_correlation is not None
        else float(_cfg_get(cfg, "classify", "min_template_correlation", 0.6))
    )
    review = (
        args.review_confidence_threshold
        if args.review_confidence_threshold is not None
        else float(_cfg_get(cfg, "classify", "review_confidence_threshold", 0.6))
    )
    reports = build_reports(
        trial_set,
        captures_dir=CAPTURES_DIR,
        noise_floor_pct=noise,
        min_template_correlation=min_corr,
    )
    return _write_and_summarize(reports, review_threshold=review)


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    cfg = load_config(getattr(args, "config", None))
    try:
        if args.cmd == "select-roi":
            code = cmd_select_roi(args, cfg)
        elif args.cmd == "run":
            code = cmd_run(args, cfg)
        elif args.cmd == "report-only":
            code = cmd_report_only(args, cfg)
        else:
            parser.print_help()
            code = 2
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        code = 2
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        code = 2
    raise SystemExit(code)
