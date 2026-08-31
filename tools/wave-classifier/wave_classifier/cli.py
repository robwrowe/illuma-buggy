"""CLI: `python -m wave_classifier run|select-rois|report-only|taxonomy|calibrate-palette|check-camera-lock|build|groundtruth`."""

from __future__ import annotations

import argparse
import json
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
from .xlsx_loader import TrialSet, filter_trials, load_builder_trials, load_trials, merge_trial_sources
from .zones import resolve_zone_layout

TOOL_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = TOOL_ROOT.parent.parent
CAPTURES_DIR = TOOL_ROOT / "captures"
REPORTS_DIR = TOOL_ROOT / "reports"
EXAMPLE_CONFIG = TOOL_ROOT / "config.example.toml"
DEFAULT_CONFIG = TOOL_ROOT / "config.toml"
ZONE_LAYOUTS = ("single", "five-corner", "inner-outer")


def _load_toml(path: Path) -> dict[str, Any]:
    try:
        import tomllib
    except ImportError:  # Python < 3.11
        return _load_toml_minimal(path)
    with path.open("rb") as fh:
        return tomllib.load(fh)


def _set_nested(data: dict[str, Any], dotted: str) -> dict[str, Any]:
    cur: dict[str, Any] = data
    for key in dotted.split("."):
        nxt = cur.get(key)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[key] = nxt
        cur = nxt
    return cur


def _load_toml_minimal(path: Path) -> dict[str, Any]:
    """Tiny subset parser for this tool's config (nested tables + string/int/float/array)."""
    data: dict[str, Any] = {}
    section: dict[str, Any] | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = _set_nested(data, line[1:-1].strip())
            continue
        if "=" not in line or section is None:
            continue
        key, val = [p.strip() for p in line.split("=", 1)]
        section[key] = _parse_toml_value(val)
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


def _deep_merge(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, val in overlay.items():
        if isinstance(val, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], val)
        else:
            out[key] = val
    return out


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
        cfg = _deep_merge(cfg, _load_toml(chosen))
    return cfg


def save_rois(config_path: Path, layout: str, rois: dict[str, tuple[int, int, int, int]]) -> None:
    table = f"[capture.rois.{layout}]"
    block_lines = [table]
    for name, (x, y, w, h) in rois.items():
        block_lines.append(f"{name} = [{x}, {y}, {w}, {h}]")
    block = "\n".join(block_lines) + "\n"
    pattern = re.compile(
        rf"^\[capture\.rois\.{re.escape(layout)}\][^\n]*\n(?:(?!\[).*\n)*",
        flags=re.M,
    )
    if config_path.is_file():
        text = config_path.read_text(encoding="utf-8")
    elif EXAMPLE_CONFIG.is_file():
        text = EXAMPLE_CONFIG.read_text(encoding="utf-8")
    else:
        text = ""
    if pattern.search(text):
        text = pattern.sub(block, text, count=1)
    else:
        text = text.rstrip() + "\n\n" + block
    config_path.write_text(text, encoding="utf-8")


def rois_from_config(cfg: dict[str, Any]) -> dict[str, dict[str, tuple[int, int, int, int]]]:
    """Parse [capture.rois.*] plus a legacy [capture] roi = [x,y,w,h] as single.all."""
    from .capture import rois_for_layout

    capture = cfg.get("capture") or {}
    raw = dict(capture.get("rois") or {})
    legacy = capture.get("roi")
    if legacy and "single" not in raw:
        raw["single"] = {"all": legacy}
    out: dict[str, dict[str, tuple[int, int, int, int]]] = {}
    for layout, block in raw.items():
        parsed = rois_for_layout({layout: block}, layout)
        if parsed:
            out[layout] = parsed
    return out


def _cfg_get(cfg: dict[str, Any], section: str, key: str, default: Any) -> Any:
    return cfg.get(section, {}).get(key, default)


def parse_intish(value: str) -> int:
    text = str(value).strip().lower()
    if text.startswith("0x"):
        return int(text, 16)
    return int(text, 10)


class _ColorEventAction(argparse.Action):
    """Preserve --color / --mask interleaving so each --mask applies to the last --color."""

    def __call__(self, parser, namespace, values, option_string=None):
        events = getattr(namespace, "color_events", None)
        if events is None:
            events = []
            setattr(namespace, "color_events", events)
        events.append((option_string, values))


def _add_build_common_args(p: argparse.ArgumentParser) -> None:
    """Shared timing/color/vib/envelope/--show flags for `build` and `build-batch`."""
    p.add_argument("--timing-byte", required=True, help="Timing byte, hex (0x64) or decimal (100)")
    p.add_argument("--color-format", required=True, help="0f | 0e | d2")
    p.add_argument(
        "--color",
        nargs="+",
        action=_ColorEventAction,
        help="Repeatable. 0f/0e: palette index. d2: R G B. Pair with --mask for 0f/0e.",
    )
    p.add_argument(
        "--mask",
        action=_ColorEventAction,
        help="0-7 mask applying to the most recently seen --color (0f/0e only)",
    )
    p.add_argument("--vibration", default=None, help="Optional 0-15 (hex or decimal); omit for no vib byte")
    p.add_argument("--envelope", default="e1", help="e1 (default), e2, or a 1-2 digit hex byte")
    p.add_argument("--show", action="store_true", help="Broadcast via WandSimulator /show after building")
    p.add_argument("--base-url", default=None, help="Required with --show")
    p.add_argument("--hold-ms", type=int, default=4000)
    p.add_argument("--config", type=Path, default=None)


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


def _add_source_args(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--groundtruth-tsv",
        type=Path,
        default=None,
        help="Second labeled sheet as TSV/CSV (Effective Code / Effect / Description, payload-only hex)",
    )
    p.add_argument(
        "--keyed-notes",
        type=Path,
        default=None,
        help="Preferred notes path: TSV with hex + notes columns (joined to trials)",
    )
    p.add_argument(
        "--notes-file",
        type=Path,
        default=None,
        help="Unkeyed one-note-per-line file (vocabulary + byte-hypothesis extraction only; not joined)",
    )
    p.add_argument(
        "--builder-trials",
        type=Path,
        default=None,
        help="JSON file or directory of build --emit-trial-row records to merge into the trial list",
    )


def _add_classify_args(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--noise-floor-pct",
        type=float,
        default=None,
        help="Flat-signal threshold as a fraction of 0–255 (config classify.noise_floor_pct)",
    )
    p.add_argument(
        "--min-template-correlation",
        type=float,
        default=None,
        help="Below this, waveform_class is irregular (config classify.min_template_correlation)",
    )
    p.add_argument(
        "--review-confidence-threshold",
        type=float,
        default=None,
        help="Agreeing rows below this still land in review-needed-*.md",
    )
    p.add_argument(
        "--cycle-tolerance-pct",
        type=float,
        default=None,
        help="Relative error vs xlsx Cycle Length that flips status to disagree (default 0.25)",
    )
    p.add_argument(
        "--cards",
        action="store_true",
        help="Also write reports/metadata-cards-<timestamp>.md (every trial, not just flagged)",
    )


def _add_timeline_args(p: argparse.ArgumentParser, *, calibrate_default: bool) -> None:
    p.add_argument(
        "--timeline",
        action="store_true",
        help="Write per-tick color/brightness tables instead of (or besides) classifying",
    )
    p.add_argument(
        "--also-classify",
        action="store_true",
        help="With --timeline, also run the existing classifier and concatenate reports",
    )
    p.add_argument(
        "--hz",
        type=float,
        default=None,
        help="Timeline tick rate. Default: native camera fps (no downsample)",
    )
    p.add_argument(
        "--black-flash-ms",
        type=int,
        default=None,
        help="E9 all-black /show before each trial (default 150 with --timeline, else 0)",
    )
    p.add_argument(
        "--no-black-flash",
        action="store_true",
        help="Skip the pre-trial black reference flash",
    )
    cal = p.add_mutually_exclusive_group()
    cal.add_argument(
        "--calibrate",
        dest="calibrate",
        action="store_true",
        help="Run 29-color five-corner calibration before the first trial",
    )
    cal.add_argument(
        "--no-calibrate",
        dest="calibrate",
        action="store_false",
        help="Skip calibration; use calibration.toml (or guessed palette)",
    )
    cal.add_argument(
        "--use-cached-calibration",
        dest="calibrate",
        action="store_false",
        help="Alias for --no-calibrate",
    )
    p.set_defaults(calibrate=calibrate_default)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m wave_classifier",
        description=(
            "Drive WandSimulator through labeled xlsx effect rows, record webcam "
            "waveforms per LED zone, and write a triage table of low-confidence / disagreeing rows."
        ),
    )
    parser.add_argument("--version", action="version", version=f"wave_classifier {__version__}")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="load xlsx, optionally capture, classify, write reports")
    _add_shared_args(run)
    _add_source_args(run)
    _add_classify_args(run)
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
        "--dry-run",
        action="store_true",
        help="Parse xlsx and print the trial list; do not touch camera or network",
    )
    run.add_argument(
        "--resume",
        action="store_true",
        help="Skip trials whose per-zone CSVs already exist under captures/",
    )
    run.add_argument(
        "--select-rois",
        metavar="LAYOUT",
        choices=ZONE_LAYOUTS,
        default=None,
        help="Pick ROIs for this zone layout before capturing",
    )
    _add_timeline_args(run, calibrate_default=True)

    rois = sub.add_parser("select-rois", help="Pick per-zone webcam ROIs and save them to config.toml")
    rois.add_argument("--config", type=Path, default=None)
    rois.add_argument("--device-index", type=int, default=None)
    rois.add_argument(
        "--zone-layout",
        required=True,
        choices=ZONE_LAYOUTS,
        help="Which named ROI set to overwrite: single | five-corner | inner-outer",
    )
    # Back-compat alias from the original spec.
    roi_old = sub.add_parser("select-roi", help="Deprecated alias for select-rois --zone-layout single")
    roi_old.add_argument("--config", type=Path, default=None)
    roi_old.add_argument("--device-index", type=int, default=None)

    report = sub.add_parser(
        "report-only",
        help="Re-classify existing captures/ CSVs without driving the board or camera",
    )
    _add_shared_args(report)
    _add_source_args(report)
    _add_classify_args(report)
    report.add_argument("--sheet", default=None)
    report.add_argument("--limit", type=int, default=None)
    report.add_argument(
        "--base-url",
        default=None,
        help="Required with --calibrate on report-only (otherwise CSVs only)",
    )
    _add_timeline_args(report, calibrate_default=False)

    gt = sub.add_parser(
        "groundtruth",
        help="Parse extra labeled sheets / notes without capturing (use --dry-run)",
    )
    _add_shared_args(gt)
    _add_source_args(gt)
    gt.add_argument("--sheet", default=None)
    gt.add_argument("--limit", type=int, default=None)
    gt.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Always on for this subcommand: print parse stats, do not capture",
    )

    build = sub.add_parser("build", help="Assemble a full advertisement from a tail (Python port of Wand Lab)")
    build.add_argument("--tail", required=True, help="Tail hex (spaced, packed, or 0x-prefixed tokens)")
    _add_build_common_args(build)
    build.add_argument("--label", default=None, help="Optional effect_label when emitting a trial row")
    build.add_argument(
        "--emit-trial-row",
        type=Path,
        default=None,
        help="Write a TrialRow JSON record so `run --builder-trials` can capture/classify it",
    )

    batch = sub.add_parser(
        "build-batch",
        help="Assemble many tails (one per line) against one shared timing/color set",
    )
    src = batch.add_mutually_exclusive_group(required=True)
    src.add_argument("--tails-file", type=Path, help="File with one tail per line (TSV/spaces/0x tokens)")
    src.add_argument("--tails-stdin", action="store_true", help="Read the tail block from stdin (paste, then Ctrl-D)")
    _add_build_common_args(batch)
    batch.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help="Directory for one TrialRow JSON per tail (for `run --builder-trials`)",
    )
    batch.add_argument(
        "--label-prefix",
        default=None,
        help="If set, effect_label is {prefix}-{line:03d} so the sweep groups in triage.csv",
    )
    batch.add_argument(
        "--sheet-name",
        default="builder-batch",
        help="TrialRow sheet field (default builder-batch)",
    )
    batch.add_argument(
        "--gap-seconds",
        type=float,
        default=1.5,
        help="Pause between --show broadcasts (default 1.5)",
    )

    tax = sub.add_parser(
        "taxonomy",
        help="Cluster measured feature vectors into a data-driven effect taxonomy",
    )
    _add_shared_args(tax)
    _add_source_args(tax)
    _add_classify_args(tax)
    tax.add_argument("--sheet", default=None)
    tax.add_argument("--limit", type=int, default=None)
    tax.add_argument(
        "--method",
        choices=("agglomerative", "dbscan", "both"),
        default="agglomerative",
        help="agglomerative (silhouette k) | dbscan (outliers) | both",
    )
    tax.add_argument(
        "--k-range",
        nargs=2,
        type=int,
        metavar=("LO", "HI"),
        default=[4, 20],
        help="Agglomerative k search range (default 4 20)",
    )
    tax.add_argument(
        "--min-label-purity",
        type=float,
        default=None,
        help="Below this, cluster candidate_name is flagged needs_human_review (config taxonomy.min_label_purity, default 0.6)",
    )
    tax.add_argument(
        "--min-silhouette",
        type=float,
        default=None,
        help="Warn when best silhouette is below this (config taxonomy.min_silhouette, default 0.25)",
    )

    camlock = sub.add_parser(
        "check-camera-lock",
        help="Set-and-verify C920 UVC exposure/focus via uvc-util (no capture)",
    )
    camlock.add_argument("--config", type=Path, default=None)
    camlock.add_argument("--device-index", type=int, default=None)

    calp = sub.add_parser(
        "calibrate-palette",
        help="Show palette 0–28 solid on five-corner ROIs and write calibration.toml",
    )
    calp.add_argument("--config", type=Path, default=None)
    calp.add_argument("--base-url", default=None, help="WandSimulator URL (or [wandsim] base_url)")
    calp.add_argument("--device-index", type=int, default=None)
    calp.add_argument(
        "--out",
        type=Path,
        default=None,
        help="calibration.toml path (default: tools/wave-classifier/calibration.toml)",
    )
    calp.add_argument(
        "--black-flash-ms",
        type=int,
        default=None,
        help="E905 black flash before each palette (default 200)",
    )
    calp.add_argument(
        "--off-confirm-timeout-ms",
        type=int,
        default=None,
        help="Max wait for camera to confirm LEDs off (default 4000)",
    )
    calp.add_argument(
        "--off-max-brightness",
        type=float,
        default=None,
        help="Peak ROI brightness treated as off (default 25)",
    )

    return parser


def _resolve_xlsx(args: argparse.Namespace) -> Path:
    if getattr(args, "xlsx", None):
        return args.xlsx
    return default_xlsx_path()


def _load_merged_trials(args: argparse.Namespace) -> TrialSet:
    from .groundtruth import load_groundtruth_tsv, load_keyed_notes_tsv

    sets: list[TrialSet] = []
    xlsx = _resolve_xlsx(args)
    if xlsx.is_file():
        sets.append(load_trials(xlsx))
    elif getattr(args, "xlsx", None):
        raise FileNotFoundError(f"xlsx not found: {xlsx}")
    if getattr(args, "groundtruth_tsv", None):
        sets.append(load_groundtruth_tsv(args.groundtruth_tsv))
    if getattr(args, "keyed_notes", None):
        sets.append(load_keyed_notes_tsv(args.keyed_notes))
    if getattr(args, "builder_trials", None):
        sets.append(load_builder_trials(args.builder_trials))
    if not sets:
        raise FileNotFoundError(
            f"no trial sources: xlsx not found at {xlsx} and no --groundtruth-tsv / --builder-trials given"
        )
    merged = merge_trial_sources(*sets)
    return filter_trials(merged, sheet=getattr(args, "sheet", None), limit=getattr(args, "limit", None))


def _print_dry_run(trial_set: TrialSet) -> None:
    unique = trial_set.unique_capture_trials()
    print(f"trials: {len(trial_set.trials)}  unique hex: {len(unique)}")
    sheets: dict[str, int] = {}
    kinds: dict[str, int] = {}
    for t in trial_set.trials:
        sheets[t.sheet] = sheets.get(t.sheet, 0) + 1
        kinds[t.source_sheet_kind] = kinds.get(t.source_sheet_kind, 0) + 1
    print("sheets: " + ", ".join(f"{k}={v}" for k, v in sorted(sheets.items())))
    print("sources: " + ", ".join(f"{k}={v}" for k, v in sorted(kinds.items())))
    n_dup = sum(1 for t in trial_set.trials if t.duplicate_count > 1)
    n_len = sum(1 for t in trial_set.trials if any("length mismatch" in n for n in t.notes))
    n_vib = sum(1 for t in trial_set.trials if any("vibration_byte_mismatch" in n for n in t.notes))
    n_unlabeled = sum(1 for t in trial_set.trials if not t.effect_label)
    n_env = sum(1 for t in trial_set.trials if t.envelope_assumed)
    print(
        f"duplicate-hex rows: {n_dup}  length mismatches: {n_len}  "
        f"vib mismatches: {n_vib}  unlabeled: {n_unlabeled}  envelope_assumed: {n_env}"
    )
    layouts: dict[str, int] = {}
    for t in unique:
        layouts[resolve_zone_layout(t).layout] = layouts.get(resolve_zone_layout(t).layout, 0) + 1
    print("zone layouts (unique hex): " + ", ".join(f"{k}={v}" for k, v in sorted(layouts.items())))
    print("")
    print(f"{'row_id':<28} {'src':<22} {'effect':<14} {'lay':<12} hex")
    for t in unique[:40]:
        hex_show = t.hex_key[:36] + ("…" if len(t.hex_key) > 36 else "")
        print(
            f"{t.row_id:<28} {t.source_sheet_kind:<22} {(t.effect_label or '—'):<14} "
            f"{resolve_zone_layout(t).layout:<12} {hex_show}"
        )
    if len(unique) > 40:
        print(f"... {len(unique) - 40} more unique payloads")
    print("")
    print("Op_Codes_Captured hex is sent to POST /show verbatim (8301 included).")
    print("Payload-only second-sheet rows get 8301E100 prepended (envelope_assumed); /send is not used.")


def _handle_unkeyed_notes(notes_path: Path) -> list[dict[str, str]]:
    from .groundtruth import (
        extract_byte_hypotheses,
        extract_vocabulary,
        load_unkeyed_notes,
        write_unfiled_hypotheses,
        write_vocabulary_csv,
    )

    notes = load_unkeyed_notes(notes_path)
    vocab = extract_vocabulary(notes)
    hyps = extract_byte_hypotheses(notes)
    vocab_path = REPORTS_DIR / "groundtruth-vocabulary.csv"
    hyp_path = REPORTS_DIR / "unfiled-byte-hypotheses.md"
    write_vocabulary_csv(vocab_path, vocab)
    write_unfiled_hypotheses(hyp_path, hyps)
    print(f"unkeyed notes: {len(notes)} lines, {len(vocab)} vocab terms, {len(hyps)} byte hypotheses")
    print(f"wrote {vocab_path}")
    print(f"wrote {hyp_path}")
    return hyps


def _write_and_summarize(
    reports,
    *,
    review_threshold: float,
    unfiled: list[dict[str, str]] | None = None,
    min_group: int = 3,
    emit_cards: bool = False,
) -> int:
    from .discover import discover_candidates, write_discovered_patterns
    from .metadata_card import write_metadata_cards_markdown

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
    print(
        f"zone_relationship: agree={counts.get('zone_rel_agree', 0)}  "
        f"disagree={counts.get('zone_rel_disagree', 0)}  "
        f"unlabeled={counts.get('zone_rel_unlabeled', 0)}"
    )
    print(f"wrote {csv_path}")
    print(f"wrote {md_path}")

    if emit_cards:
        cards_path = REPORTS_DIR / f"metadata-cards-{stamp}.md"
        cards = [getattr(r, "card", None) for r in reports]
        cards = [c for c in cards if c is not None]
        write_metadata_cards_markdown(cards_path, cards, generated_at=stamp)
        print(f"wrote {cards_path}")

    candidates = discover_candidates(reports, min_group=min_group, unfiled_hypotheses=unfiled)
    disc_path = REPORTS_DIR / f"discovered-patterns-{stamp}.md"
    write_discovered_patterns(disc_path, candidates, stamp)
    print(f"discovery candidates={len(candidates)}")
    print(f"wrote {disc_path}")
    return 0


def _classify_knobs(args: argparse.Namespace, cfg: dict[str, Any]) -> tuple[float, float, float, float, int]:
    noise = (
        args.noise_floor_pct
        if getattr(args, "noise_floor_pct", None) is not None
        else float(_cfg_get(cfg, "classify", "noise_floor_pct", 0.03))
    )
    min_corr = (
        args.min_template_correlation
        if getattr(args, "min_template_correlation", None) is not None
        else float(_cfg_get(cfg, "classify", "min_template_correlation", 0.6))
    )
    review = (
        args.review_confidence_threshold
        if getattr(args, "review_confidence_threshold", None) is not None
        else float(_cfg_get(cfg, "classify", "review_confidence_threshold", 0.6))
    )
    cycle = (
        args.cycle_tolerance_pct
        if getattr(args, "cycle_tolerance_pct", None) is not None
        else float(_cfg_get(cfg, "classify", "cycle_tolerance_pct", 0.25))
    )
    min_group = int(_cfg_get(cfg, "discover", "min_group", 3))
    return noise, min_corr, review, cycle, min_group


def _needed_layouts(trial_set: TrialSet) -> list[str]:
    return sorted({resolve_zone_layout(t).layout for t in trial_set.unique_capture_trials()})


def _missing_layouts(needed: list[str], rois_by_layout: dict) -> list[str]:
    missing = []
    for layout in needed:
        if layout in rois_by_layout:
            continue
        # Practical fallback: five-corner may run as inner-outer if that's all that fits.
        if layout == "five-corner" and "inner-outer" in rois_by_layout:
            continue
        missing.append(layout)
    return missing


def _black_flash_ms(args: argparse.Namespace) -> int:
    if getattr(args, "no_black_flash", False):
        return 0
    explicit = getattr(args, "black_flash_ms", None)
    if explicit is not None:
        return max(0, int(explicit))
    if getattr(args, "timeline", False):
        return 150
    return 0


def _build_timeline_reports(
    trial_set: TrialSet,
    *,
    captures_dir: Path,
    cap_by_hex: dict | None,
    hz: float | None,
):
    from .capture import find_capture_csvs, parse_capture_stem, read_samples_csv
    from .palette import load_calibration
    from .timeline import build_timeline_report

    cal = load_calibration()
    reports = []
    for trial in trial_set.unique_capture_trials():
        cr = (cap_by_hex or {}).get(trial.hex_key)
        paths = list(getattr(cr, "csv_paths", None) or []) or find_capture_csvs(captures_dir, trial)
        series = {}
        for p in paths:
            zone, _rep = parse_capture_stem(p.stem, trial.row_id_safe)
            series[zone] = read_samples_csv(p)
        fps = getattr(cr, "measured_fps", None) if cr else None
        baseline = getattr(cr, "baseline_frame_range", None) if cr else None
        reports.append(
            build_timeline_report(
                trial,
                series,
                trial.expected_colors,
                cal,
                hz=hz,
                measured_fps=fps,
                baseline_tick_range=baseline,
            )
        )
    return reports, cal


def _write_timeline(reports, *, stamp: str | None = None) -> dict:
    from .timeline_report import write_timeline_bundle
    from .triage import timestamp_slug

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = stamp or timestamp_slug()
    paths = write_timeline_bundle(REPORTS_DIR, reports, stamp=stamp)
    print(f"wrote {paths['md']}")
    print(f"wrote {paths['csv']}")
    print(f"wrote {paths['dir']}/<row_id>.md")
    return paths


def cmd_select_rois(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    from .capture import pick_rois

    layout = getattr(args, "zone_layout", None) or "single"
    device = args.device_index if args.device_index is not None else int(_cfg_get(cfg, "capture", "device_index", 0))
    rois = pick_rois(layout, device)
    dest = args.config or DEFAULT_CONFIG
    save_rois(dest, layout, rois)
    names = ", ".join(f"{k}={v}" for k, v in rois.items())
    print(f"wrote [capture.rois.{layout}] to {dest}: {names}")
    return 0


def cmd_run(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    trial_set = _load_merged_trials(args)
    n_len = sum(1 for t in trial_set.trials if any("length mismatch" in n for n in t.notes))
    if n_len:
        print(f"warning: {n_len} rows have length_byte+2 vs decoded payload length mismatch (kept; see report notes)")

    unfiled: list[dict[str, str]] = []
    if getattr(args, "notes_file", None):
        unfiled = _handle_unkeyed_notes(args.notes_file)

    if args.dry_run:
        print(f"xlsx: {_resolve_xlsx(args)}")
        _print_dry_run(trial_set)
        return 0

    config_path = args.config or DEFAULT_CONFIG
    if args.select_rois:
        from .capture import pick_rois

        layout = args.select_rois
        device = args.device_index if args.device_index is not None else int(_cfg_get(cfg, "capture", "device_index", 0))
        rois = pick_rois(layout, device)
        save_rois(config_path, layout, rois)
        cfg = load_config(config_path)
        print(f"wrote [capture.rois.{layout}] to {config_path}")

    base_url = args.base_url or _cfg_get(cfg, "wandsim", "base_url", None)
    if not base_url:
        print(
            "error: --base-url is required (or set [wandsim] base_url in config.toml). "
            "WandSimulator does not persist IP across reboots.",
            file=sys.stderr,
        )
        return 2

    rois_by_layout = rois_from_config(cfg)
    needed = _needed_layouts(trial_set)
    missing = _missing_layouts(needed, rois_by_layout)
    if missing:
        from .capture import MissingRoiSet

        raise MissingRoiSet(missing)

    device = args.device_index if args.device_index is not None else int(_cfg_get(cfg, "capture", "device_index", 0))
    gap = args.gap_seconds if args.gap_seconds is not None else float(_cfg_get(cfg, "capture", "gap_seconds", 1.5))
    settle = (
        args.settle_margin_ms
        if args.settle_margin_ms is not None
        else int(_cfg_get(cfg, "capture", "settle_margin_ms", 500))
    )
    noise, min_corr, review, cycle, min_group = _classify_knobs(args, cfg)

    unique = trial_set.unique_capture_trials()
    print(
        f"capturing {len(unique)} unique hex ({len(trial_set.trials)} labeled rows) "
        f"hold_ms={args.hold_ms} repeat={args.repeat} layouts={needed}"
    )

    def on_trial(i: int, n: int, trial) -> None:
        print(
            f"[{i + 1}/{n}] {trial.row_id}  {trial.effect_label or '—'}  "
            f"{resolve_zone_layout(trial).layout}  {trial.hex_key[:20]}…"
        )

    from .capture import run_captures

    try:
        cap_results = run_captures(
            unique,
            base_url=base_url,
            captures_dir=CAPTURES_DIR,
            device_index=device,
            rois_by_layout=rois_by_layout,
            hold_ms=args.hold_ms,
            settle_margin_ms=settle,
            gap_seconds=gap,
            repeats=args.repeat,
            resume=args.resume,
            on_trial=on_trial,
            macos_uvc=(cfg.get("capture") or {}).get("macos_uvc") or {},
            black_flash_ms=_black_flash_ms(args),
            calibrate=bool(getattr(args, "calibrate", True)),
        )
    except KeyboardInterrupt:
        print("\ninterrupted — stopping WandSimulator")
        cap_results = []

    by_hex = {r.trial.hex_key: r for r in cap_results}
    do_timeline = bool(getattr(args, "timeline", False))
    do_classify = (not do_timeline) or bool(getattr(args, "also_classify", False))
    if do_timeline:
        tl_reports, cal = _build_timeline_reports(
            trial_set,
            captures_dir=CAPTURES_DIR,
            cap_by_hex=by_hex,
            hz=getattr(args, "hz", None),
        )
        age = f"{cal.age_s:.0f}s" if cal.age_s is not None else "n/a"
        print(f"calibration_source={cal.source}  calibration_age_s={age}")
        _write_timeline(tl_reports)
    if not do_classify:
        return 0
    reports = build_reports(
        trial_set,
        captures_dir=CAPTURES_DIR,
        noise_floor_pct=noise,
        min_template_correlation=min_corr,
        capture_results=by_hex,
        cycle_tolerance_pct=cycle,
        review_threshold=review,
    )
    return _write_and_summarize(
        reports,
        review_threshold=review,
        unfiled=unfiled,
        min_group=min_group,
        emit_cards=bool(getattr(args, "cards", False)),
    )


def cmd_report_only(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    trial_set = _load_merged_trials(args)
    unfiled: list[dict[str, str]] = []
    if getattr(args, "notes_file", None):
        unfiled = _handle_unkeyed_notes(args.notes_file)
    if getattr(args, "calibrate", False):
        base_url = args.base_url or _cfg_get(cfg, "wandsim", "base_url", None)
        if not base_url:
            print(
                "error: --calibrate on report-only needs --base-url (or [wandsim] base_url)",
                file=sys.stderr,
            )
            return 2
        rois_by_layout = rois_from_config(cfg)
        five = rois_by_layout.get("five-corner")
        if not five:
            from .capture import MissingRoiSet

            raise MissingRoiSet(["five-corner"])
        from .calibrate import run_palette_calibration

        device = args.device_index if getattr(args, "device_index", None) is not None else int(
            _cfg_get(cfg, "capture", "device_index", 0)
        )
        settle = int(_cfg_get(cfg, "capture", "settle_margin_ms", 500))
        black_ms = _black_flash_ms(args)
        if black_ms <= 0:
            black_ms = int(_cfg_get(cfg, "capture", "calibrate_black_flash_ms", 200))
        off_timeout = int(_cfg_get(cfg, "capture", "off_confirm_timeout_ms", 2000))
        off_bri = float(_cfg_get(cfg, "capture", "off_max_brightness", 25))
        run_palette_calibration(
            base_url=base_url,
            five_corner_rois=five,
            device_index=device,
            settle_margin_ms=settle,
            macos_uvc=(cfg.get("capture") or {}).get("macos_uvc") or {},
            black_flash_ms=black_ms,
            off_confirm_timeout_ms=off_timeout,
            off_max_brightness=off_bri,
            on_index=lambda i, n, idx: print(f"  palette {idx} ({i + 1}/{n})"),
        )
    do_timeline = bool(getattr(args, "timeline", False))
    do_classify = (not do_timeline) or bool(getattr(args, "also_classify", False))
    if do_timeline:
        tl_reports, cal = _build_timeline_reports(
            trial_set,
            captures_dir=CAPTURES_DIR,
            cap_by_hex=None,
            hz=getattr(args, "hz", None),
        )
        age = f"{cal.age_s:.0f}s" if cal.age_s is not None else "n/a"
        print(f"calibration_source={cal.source}  calibration_age_s={age}")
        _write_timeline(tl_reports)
    if not do_classify:
        return 0
    noise, min_corr, review, cycle, min_group = _classify_knobs(args, cfg)
    reports = build_reports(
        trial_set,
        captures_dir=CAPTURES_DIR,
        noise_floor_pct=noise,
        min_template_correlation=min_corr,
        cycle_tolerance_pct=cycle,
        review_threshold=review,
    )
    return _write_and_summarize(
        reports,
        review_threshold=review,
        unfiled=unfiled,
        min_group=min_group,
        emit_cards=bool(getattr(args, "cards", False)),
    )


def cmd_calibrate_palette(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    from .calibrate import run_palette_calibration
    from .palette import calibration_diff_lines

    base_url = args.base_url or _cfg_get(cfg, "wandsim", "base_url", None)
    if not base_url:
        print(
            "error: --base-url is required (or set [wandsim] base_url in config.toml).",
            file=sys.stderr,
        )
        return 2
    rois_by_layout = rois_from_config(cfg)
    five = rois_by_layout.get("five-corner")
    if not five:
        from .capture import MissingRoiSet

        raise MissingRoiSet(["five-corner"])
    device = args.device_index if args.device_index is not None else int(_cfg_get(cfg, "capture", "device_index", 0))
    settle = int(_cfg_get(cfg, "capture", "settle_margin_ms", 500))
    black_ms = (
        int(args.black_flash_ms)
        if args.black_flash_ms is not None
        else int(_cfg_get(cfg, "capture", "calibrate_black_flash_ms", 200))
    )
    off_timeout = (
        int(args.off_confirm_timeout_ms)
        if args.off_confirm_timeout_ms is not None
        else int(_cfg_get(cfg, "capture", "off_confirm_timeout_ms", 2000))
    )
    off_bri = (
        float(args.off_max_brightness)
        if args.off_max_brightness is not None
        else float(_cfg_get(cfg, "capture", "off_max_brightness", 25))
    )
    cal = run_palette_calibration(
        base_url=base_url,
        five_corner_rois=five,
        device_index=device,
        settle_margin_ms=settle,
        macos_uvc=(cfg.get("capture") or {}).get("macos_uvc") or {},
        dest=args.out,
        black_flash_ms=black_ms,
        off_confirm_timeout_ms=off_timeout,
        off_max_brightness=off_bri,
    )
    print(f"wrote {cal.path}")
    print("\n".join(calibration_diff_lines(cal)))
    return 0


def cmd_taxonomy(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    """Re-classify existing captures, then cluster metadata cards."""
    try:
        import sklearn  # noqa: F401
    except ImportError:
        print(
            "error: scikit-learn is required for taxonomy — "
            "pip install scikit-learn (see tools/wave-classifier/requirements.txt)",
            file=sys.stderr,
        )
        return 2
    trial_set = _load_merged_trials(args)
    noise, min_corr, review, cycle, min_group = _classify_knobs(args, cfg)
    reports = build_reports(
        trial_set,
        captures_dir=CAPTURES_DIR,
        noise_floor_pct=noise,
        min_template_correlation=min_corr,
        cycle_tolerance_pct=cycle,
        review_threshold=review,
    )
    from .taxonomy import (
        build_feature_vectors,
        cluster_trials,
        corpus_speed_edges,
        suggest_cluster_name,
        write_taxonomy_csv,
        write_taxonomy_markdown,
    )

    vectors, excluded = build_feature_vectors(reports)
    print(
        f"taxonomy: {len(vectors)} usable vectors, {len(excluded)} excluded "
        f"(no cycle_time_ms / capture failed)"
    )
    if len(vectors) < 2:
        print(
            "error: need at least 2 trials with a measured cycle_time_ms to cluster. "
            "Capture first, then `python -m wave_classifier report-only --cards` "
            "(or `run --cards`) so metadata cards exist.",
            file=sys.stderr,
        )
        return 2
    methods = ["agglomerative", "dbscan"] if args.method == "both" else [args.method]
    stamp = timestamp_slug()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    k_range = (int(args.k_range[0]), int(args.k_range[1]))
    sil_min = (
        float(args.min_silhouette)
        if args.min_silhouette is not None
        else float(_cfg_get(cfg, "taxonomy", "min_silhouette", 0.25))
    )
    purity = (
        float(args.min_label_purity)
        if args.min_label_purity is not None
        else float(_cfg_get(cfg, "taxonomy", "min_label_purity", 0.6))
    )
    edges = corpus_speed_edges(vectors)
    for method in methods:
        result = cluster_trials(
            vectors,
            method=method,
            k_range=k_range,
            silhouette_min=sil_min,
            min_samples=int(_cfg_get(cfg, "discover", "min_group", 3)),
        )
        print(f"  {method}: k={result.k} silhouette={result.silhouette} {result.note}")
        if result.weak_structure:
            print(f"  warning: weak cluster structure ({result.note})")
        names = {}
        for cid, idxs in result.cluster_members.items():
            if cid < 0:
                continue
            names[cid] = suggest_cluster_name(
                [vectors[i] for i in idxs],
                speed_edges=edges,
                min_label_purity=purity,
            )
            sug = names[cid]
            flag = " REVIEW" if sug.needs_human_review else ""
            print(
                f"    cluster {cid}: {sug.candidate_name} n={len(idxs)} "
                f"purity={sug.label_purity}{flag}"
            )
        suffix = f"-{method}" if args.method == "both" else ""
        md_path = REPORTS_DIR / f"taxonomy{suffix}-{stamp}.md"
        csv_path = REPORTS_DIR / f"taxonomy{suffix}-{stamp}.csv"
        write_taxonomy_markdown(
            md_path,
            result=result,
            vectors=vectors,
            names=names,
            excluded=excluded,
            generated_at=stamp,
        )
        write_taxonomy_csv(csv_path, vectors, result, names)
        print(f"wrote {md_path}")
        print(f"wrote {csv_path}")
    return 0


def cmd_check_camera_lock(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    from .capture_macos_uvc import lock_camera_for_capture, uvc_util_available

    uvc_cfg = (cfg.get("capture") or {}).get("macos_uvc") or {}
    idx = args.device_index
    if idx is None:
        idx = uvc_cfg.get("camera_index")
    if idx is None:
        idx = _cfg_get(cfg, "capture", "device_index", 0)
    gain = uvc_cfg.get("gain_for_iso_400")
    if gain in (None, "", "null"):
        gain = None
    else:
        gain = int(gain)
    if not uvc_util_available():
        print("uvc-util not on PATH — brew install uvc-util", file=sys.stderr)
        return 2
    print(f"check-camera-lock: uvc-util -I {idx}")
    results = lock_camera_for_capture(int(idx), gain_for_iso_400=gain)
    unmatched = 0
    print(f"{'status':<10} {'control':<22} {'requested':<16} actual")
    for r in results:
        st = "ok" if r.matched else ("skip" if r.skipped else "MISMATCH")
        print(f"{st:<10} {r.control_name:<22} {str(r.requested_value):<16} {r.actual_value}")
        if r.warning:
            print(f"           {r.warning}")
        if not r.matched and not r.skipped:
            unmatched += 1
    return 1 if unmatched else 0


def cmd_groundtruth(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    trial_set = _load_merged_trials(args)
    print(f"xlsx: {_resolve_xlsx(args)}")
    _print_dry_run(trial_set)
    if getattr(args, "notes_file", None):
        _handle_unkeyed_notes(args.notes_file)
    n_e9 = 0
    n_mismatch = 0
    n_payload = 0
    for t in trial_set.trials:
        if t.envelope_assumed or t.source_sheet_kind == "second_labeled_sheet":
            n_payload += 1
            if t.hex_key.replace(" ", "").upper().startswith("8301E100E9"):
                n_e9 += 1
            if any("length mismatch" in n for n in t.notes):
                n_mismatch += 1
    if n_payload:
        print(
            f"payload-only rows: {n_payload}  E9-leading after 8301E100: {n_e9}  "
            f"length mismatches: {n_mismatch}"
        )
    return 0


def _colors_from_events(fmt: str, events: list[tuple[str | None, Any]]) -> list[dict[str, int]]:
    colors: list[dict[str, int]] = []
    fmt_l = fmt.lower().replace("0x", "")
    for opt, val in events:
        if opt == "--color":
            args = list(val) if isinstance(val, list) else [val]
            if fmt_l == "d2":
                if len(args) != 3:
                    raise ValueError(
                        f"--color for d2 expects R G B (3 values), got {args!r}"
                    )
                colors.append(
                    {"r": parse_intish(args[0]), "g": parse_intish(args[1]), "b": parse_intish(args[2])}
                )
            else:
                if len(args) != 1:
                    raise ValueError(
                        f"--color for {fmt_l} expects one palette index, got {args!r}"
                    )
                pal = parse_intish(args[0])
                if pal > 31:
                    print(
                        f"warning: palette index {args[0]} is > 31; "
                        "encode_color_byte will mask to 5 bits",
                        file=sys.stderr,
                    )
                colors.append({"palette_idx": pal, "mask": 0})
        elif opt == "--mask":
            if not colors:
                raise ValueError("--mask must follow a --color")
            if fmt_l == "d2":
                raise ValueError("--mask is only valid with --color-format 0f or 0e")
            colors[-1]["mask"] = parse_intish(val if not isinstance(val, list) else val[0])
    if not colors:
        raise ValueError("at least one --color is required")
    return colors


def _resolve_build_common(args: argparse.Namespace) -> dict[str, Any]:
    """Shared color/timing/vibration resolution for `build` and `build-batch`."""
    fmt = str(args.color_format).lower().replace("0x", "")
    events = getattr(args, "color_events", None) or []
    colors = _colors_from_events(fmt, events)
    vib = None if args.vibration is None else parse_intish(args.vibration)
    return {
        "timing_byte": parse_intish(args.timing_byte),
        "color_format": fmt,
        "colors": colors,
        "vibration": vib,
        "envelope": args.envelope,
    }


def _broadcast_built(cfg: dict[str, Any], args: argparse.Namespace, hex_full: str) -> int:
    base_url = args.base_url or _cfg_get(cfg, "wandsim", "base_url", None)
    if not base_url:
        print("error: --show requires --base-url (or [wandsim] base_url)", file=sys.stderr)
        return 2
    from .wandsim_client import show_single, stop
    import time

    show_single(base_url, hex_full, args.hold_ms)
    time.sleep(max(0, args.hold_ms) / 1000.0)
    try:
        stop(base_url)
    except Exception:
        pass
    return 0


def _format_tail_span(tail: list[int]) -> str:
    if not tail:
        return "(empty)"
    hex_s = " ".join(f"{b:02X}" for b in tail)
    last = len(tail) - 1
    return f"T00-T{last:02d} {hex_s}"


def cmd_build(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    from .payload_builder import build_payload, parse_tail_bytes, trial_row_from_built
    from .xlsx_loader import decode_hex_structure

    common = _resolve_build_common(args)
    tail = parse_tail_bytes(args.tail)
    built = build_payload(tail_bytes=tail, **common)
    decoded = decode_hex_structure(built.hex_full)
    print(f"hex_full {built.hex_full}")
    print(f"hex      {built.hex}")
    print(f"length   0x{built.length_byte:02X} ({built.length_byte})")
    if decoded.length_mismatch:
        print(
            f"warning: round-trip length mismatch "
            f"(derived={decoded.derived_payload_length} actual={decoded.actual_payload_length})",
            file=sys.stderr,
        )
    if common["vibration"] is not None and decoded.vibration_nibble != (common["vibration"] & 0x0F):
        print("warning: round-trip vibration byte did not match", file=sys.stderr)
    for w in built.warnings:
        print(f"warning: {w}", file=sys.stderr)

    if args.emit_trial_row:
        rec = trial_row_from_built(
            built, tail_bytes=tail, label=args.label, vibration=common["vibration"]
        )
        args.emit_trial_row.parent.mkdir(parents=True, exist_ok=True)
        args.emit_trial_row.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {args.emit_trial_row}")

    if args.show:
        code = _broadcast_built(cfg, args, built.hex_full)
        if code:
            return code
        print(f"show {args.hold_ms}ms → {args.base_url or _cfg_get(cfg, 'wandsim', 'base_url', '')}")
    return 0


def cmd_build_batch(args: argparse.Namespace, cfg: dict[str, Any]) -> int:
    from .payload_builder import build_payload, parse_tail_block, trial_row_from_built, built_short_id
    from .xlsx_loader import fs_safe

    if args.tails_stdin:
        raw = sys.stdin.read()
    else:
        raw = args.tails_file.read_text(encoding="utf-8-sig")
    tails, skipped = parse_tail_block(raw)
    n_blank = sum(1 for ln in raw.splitlines() if not ln.strip())
    common = _resolve_build_common(args)
    out_dir: Path = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    sheet = args.sheet_name or "builder-batch"
    n = len(tails)
    for i, tail in enumerate(tails, start=1):
        built = build_payload(tail_bytes=tail, **common)
        label = None
        if args.label_prefix:
            label = f"{args.label_prefix}-{i:03d}"
        rec = trial_row_from_built(
            built,
            tail_bytes=tail,
            label=label,
            sheet=sheet,
            vibration=common["vibration"],
            row_index=i,
        )
        short = rec.get("short_id") or built_short_id(built)
        path = out_dir / f"{fs_safe(sheet)}__{short}.json"
        path.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")
        warn = f"  warning: {'; '.join(built.warnings)}" if built.warnings else ""
        span = _format_tail_span(tail)
        print(
            f"[{i:03d}/{n}] {span:<40} → hex_full {built.hex_full[:22]}…  "
            f"len=0x{built.length_byte:02X}  ok{warn}"
        )
        if args.show:
            code = _broadcast_built(cfg, args, built.hex_full)
            if code:
                return code
            if i < n:
                import time

                time.sleep(max(0.0, float(args.gap_seconds)))
    skipped_n = len(skipped) + n_blank
    print(f"wrote {n} trial rows to {out_dir}")
    skip_note = f"skipped {len(skipped)} unparseable line(s): {skipped}" if skipped else f"skipped {skipped_n} blank/unparseable lines"
    if skipped:
        print(skip_note)
    else:
        print(f"skipped {skipped_n} blank/unparseable lines")
    print(f"next: python -m wave_classifier run --builder-trials {out_dir} --base-url <url>")
    return 0


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    cfg = load_config(getattr(args, "config", None))
    try:
        if args.cmd in {"select-rois", "select-roi"}:
            if args.cmd == "select-roi":
                args.zone_layout = "single"
            code = cmd_select_rois(args, cfg)
        elif args.cmd == "run":
            code = cmd_run(args, cfg)
        elif args.cmd == "report-only":
            code = cmd_report_only(args, cfg)
        elif args.cmd == "groundtruth":
            code = cmd_groundtruth(args, cfg)
        elif args.cmd == "taxonomy":
            code = cmd_taxonomy(args, cfg)
        elif args.cmd == "calibrate-palette":
            code = cmd_calibrate_palette(args, cfg)
        elif args.cmd == "check-camera-lock":
            code = cmd_check_camera_lock(args, cfg)
        elif args.cmd == "build":
            code = cmd_build(args, cfg)
        elif args.cmd == "build-batch":
            code = cmd_build_batch(args, cfg)
        else:
            parser.print_help()
            code = 2
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        code = 2
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        code = 2
    except Exception as exc:
        from .capture import MissingRoiSet

        if isinstance(exc, MissingRoiSet):
            print(f"error: {exc}", file=sys.stderr)
            code = 2
        else:
            raise
    raise SystemExit(code)
