"""Join classifications back to xlsx rows, score confidence, write reports.

Status values: agree, disagree, unlabeled, capture_failed, inconsistent_repeats.

A same-payload / different-outcome case is a prompt to re-run the trial, not to
average the captures away (see F-2026-08-26-01). Confidence is a triage aid,
not a finding — reports live under tools/wave-classifier/reports/ only.
"""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .blend import BlendResult, ZoneRelationship, analyze_blend, analyze_zone_relationship, infer_effect_label, labels_agree
from .capture import find_capture_csvs, parse_capture_stem, read_samples_csv
from .waveform import WaveformResult, classify_rgb
from .xlsx_loader import TrialRow, TrialSet, fs_safe
from .zones import FIVE_CORNER_IDS, primary_zone_name, resolve_zone_layout

REVIEW_STATUSES = {"disagree", "capture_failed", "inconsistent_repeats"}
ZONE_NAMES = ["all", "center", "outer"] + list(FIVE_CORNER_IDS)


@dataclass
class RepeatClassification:
    path: Path
    zone: str
    waveforms: dict[str, WaveformResult]
    blend: BlendResult
    inferred_label: str
    confidence: float


@dataclass
class ZoneResult:
    zone: str
    inferred_label: str
    waveforms: dict[str, WaveformResult]
    blend: BlendResult
    confidence: float
    n_repeats: int
    inconsistent: bool = False


@dataclass
class TrialReport:
    trial: TrialRow
    inferred_label: str | None
    waveform_class_r: str | None
    waveform_class_g: str | None
    waveform_class_b: str | None
    waveform_class_brightness: str | None
    is_blend: bool | None
    blend_style: str | None
    confidence: float
    status: str
    capture_status: str
    n_repeats: int
    re_run_recommended: bool
    notes: list[str] = field(default_factory=list)
    repeats: list[RepeatClassification] = field(default_factory=list)
    freq_hz: float | None = None
    zone_layout: str = "single"
    zone_layout_assumed: bool = False
    zone_layout_downgraded: bool = False
    zone_results: dict[str, ZoneResult] = field(default_factory=dict)
    zone_relationship: str = "single_zone"
    outer_chase_direction: str | None = None
    zone_relationship_status: str = "unlabeled"
    primary_zone: str = "all"


def _classify_csv(
    path: Path,
    *,
    noise_floor_pct: float,
    min_template_correlation: float,
) -> RepeatClassification:
    t, r, g, b = read_samples_csv(path)
    waves = classify_rgb(
        t,
        r,
        g,
        b,
        noise_floor_pct=noise_floor_pct,
        min_template_correlation=min_template_correlation,
    )
    blend = analyze_blend(t, r, g, b, waves)
    conf = float(waves["brightness"].confidence)
    if blend.is_blend:
        dominant = max(("r", "g", "b"), key=lambda k: waves[k].amplitude)
        conf = max(conf, float(waves[dominant].confidence))
    return RepeatClassification(
        path=path,
        zone="all",
        waveforms=waves,
        blend=blend,
        inferred_label=blend.inferred_label,
        confidence=conf,
    )


def _majority_label(labels: list[str]) -> str | None:
    if not labels:
        return None
    counts: dict[str, int] = {}
    for lab in labels:
        counts[lab] = counts.get(lab, 0) + 1
    best = max(counts.values())
    winners = [k for k, v in counts.items() if v == best]
    if len(winners) != 1:
        return None
    return winners[0]


def classify_trial(
    trial: TrialRow,
    csv_paths: list[Path],
    *,
    noise_floor_pct: float,
    min_template_correlation: float,
    capture_status: str = "ok",
    capture_error: str | None = None,
    cycle_tolerance_pct: float = 0.25,
) -> TrialReport:
    notes = list(trial.notes)
    zl = resolve_zone_layout(trial)
    if trial.zone_layout_downgraded:
        notes.append("zone_layout_downgraded: captured as inner-outer (five-corner ROIs missing)")
    if trial.duplicate_count > 1:
        notes.append(
            f"same capture used for {trial.duplicate_count} labeled rows "
            f"(source {trial.capture_source_row_id})"
        )
    if trial.envelope_assumed:
        notes.append("envelope_assumed")
    if capture_error:
        notes.append(capture_error)

    empty = dict(
        trial=trial,
        inferred_label=None,
        waveform_class_r=None,
        waveform_class_g=None,
        waveform_class_b=None,
        waveform_class_brightness=None,
        is_blend=None,
        blend_style=None,
        confidence=0.0,
        n_repeats=0,
        notes=notes,
        zone_layout=zl.layout,
        zone_layout_assumed=zl.assumed,
        zone_layout_downgraded=trial.zone_layout_downgraded,
        zone_relationship="single_zone" if zl.layout == "single" else "independent",
        primary_zone=primary_zone_name(trial, zl.layout),
    )
    if capture_status != "ok" or not csv_paths:
        return TrialReport(
            **empty,
            status="capture_failed",
            capture_status=capture_status if csv_paths or capture_status != "ok" else "missing_csv",
            re_run_recommended=True,
        )

    by_zone: dict[str, list[Path]] = defaultdict(list)
    source_safe = fs_safe(trial.capture_source_row_id or trial.row_id)
    for p in csv_paths:
        zone, _rep = parse_capture_stem(p.stem, trial.row_id_safe)
        if zone == "all" and p.stem != trial.row_id_safe and not p.stem.startswith(trial.row_id_safe + "__"):
            zone, _rep = parse_capture_stem(p.stem, source_safe)
        by_zone[zone].append(p)

    zone_results: dict[str, ZoneResult] = {}
    all_repeats: list[RepeatClassification] = []
    any_inconsistent = False
    for zone, paths in by_zone.items():
        classified = []
        for p in paths:
            item = _classify_csv(
                p,
                noise_floor_pct=noise_floor_pct,
                min_template_correlation=min_template_correlation,
            )
            item.zone = zone
            classified.append(item)
            all_repeats.append(item)
        labs = [c.inferred_label for c in classified]
        inconsistent = len({x.lower() for x in labs}) > 1 and len(classified) > 1
        if inconsistent:
            any_inconsistent = True
            notes.append(f"inconsistent_repeats zone={zone}: " + ", ".join(f"{c.path.name}={c.inferred_label}" for c in classified))
        pick_lab = _majority_label(labs) or labs[0]
        pick = next(c for c in classified if c.inferred_label == pick_lab)
        zone_results[zone] = ZoneResult(
            zone=zone,
            inferred_label=pick_lab,
            waveforms=pick.waveforms,
            blend=pick.blend,
            confidence=sum(c.confidence for c in classified) / len(classified),
            n_repeats=len(classified),
            inconsistent=inconsistent,
        )

    primary = primary_zone_name(trial, zl.layout)
    if primary == "outer":
        outer_labs = [zone_results[z].inferred_label for z in FIVE_CORNER_IDS[:-1] if z in zone_results]
        pick_label = _majority_label(outer_labs) or (outer_labs[0] if outer_labs else "unclassified")
        pick_zone = next((z for z in FIVE_CORNER_IDS[:-1] if z in zone_results), next(iter(zone_results), "all"))
        pick_zr = zone_results.get(pick_zone)
    else:
        pick_zr = zone_results.get(primary) or zone_results.get("all") or next(iter(zone_results.values()), None)
        pick_label = pick_zr.inferred_label if pick_zr else "unclassified"

    series = {}
    for zone, zr in zone_results.items():
        path = by_zone[zone][0]
        t, r, g, b = read_samples_csv(path)
        series[zone] = (t, (r + g + b) / 3.0)
    zrel = analyze_zone_relationship(series, "five-corner" if zl.layout == "five-corner" else zl.layout)

    spatial_label, spatial_notes, chase_dir = infer_effect_label(
        layout=zl.layout,
        zrel=zrel,
        zone_wave={z: zr.waveforms["brightness"].waveform_class for z, zr in zone_results.items()},
        zone_blend={z: zr.blend.inferred_label for z, zr in zone_results.items()},
        series_by_zone=series,
    )
    notes.extend(spatial_notes)
    if chase_dir and not zrel.outer_chase_direction:
        zrel.outer_chase_direction = chase_dir
    pick_label = spatial_label

    labeled = trial.effect_label
    if any_inconsistent:
        status = "inconsistent_repeats"
    elif labeled:
        status = "agree" if labels_agree(pick_label, labeled) else "disagree"
    else:
        status = "unlabeled"

    hint = trial.zone_layout_hint
    sync = (hint.sync or "").strip().upper()
    rel = zrel.zone_relationship
    if not sync or zl.layout == "single":
        zstatus = "unlabeled" if zl.layout != "single" else "unlabeled"
        if zl.layout == "single":
            zstatus = "unlabeled"
    elif sync in {"Y", "YES"}:
        zstatus = "agree" if rel == "synchronized" else "disagree"
    elif sync in {"N", "NO"}:
        zstatus = "agree" if rel in {"async", "independent"} else "disagree"
    else:
        zstatus = "unlabeled"

    period = pick_zr.waveforms["brightness"].estimated_period_ms if pick_zr else None
    labeled_cycle = hint.cycle_length
    if labeled_cycle and period and period > 0:
        labeled_ms = labeled_cycle if labeled_cycle > 20 else labeled_cycle * 1000.0
        diff = abs(period - labeled_ms) / labeled_ms
        if diff > cycle_tolerance_pct:
            notes.append(
                f"numeric-tolerance disagreement: measured period {period:.0f}ms vs labeled "
                f"cycle length {labeled_ms:.0f}ms ({diff:.0%} > {cycle_tolerance_pct:.0%})"
            )
            if status == "agree":
                status = "disagree"

    waves = pick_zr.waveforms if pick_zr else None
    blend = pick_zr.blend if pick_zr else None
    conf = pick_zr.confidence if pick_zr else 0.0
    n_rep = max((z.n_repeats for z in zone_results.values()), default=0)
    return TrialReport(
        trial=trial,
        inferred_label=pick_label,
        waveform_class_r=waves["r"].waveform_class if waves else None,
        waveform_class_g=waves["g"].waveform_class if waves else None,
        waveform_class_b=waves["b"].waveform_class if waves else None,
        waveform_class_brightness=waves["brightness"].waveform_class if waves else None,
        is_blend=blend.is_blend if blend else None,
        blend_style=blend.blend_style if blend else None,
        confidence=conf,
        status=status,
        capture_status="ok",
        n_repeats=n_rep,
        re_run_recommended=status in {"disagree", "inconsistent_repeats"} or zstatus == "disagree",
        notes=notes,
        repeats=all_repeats,
        freq_hz=waves["brightness"].freq_hz if waves else None,
        zone_layout=zl.layout,
        zone_layout_assumed=zl.assumed,
        zone_layout_downgraded=trial.zone_layout_downgraded,
        zone_results=zone_results,
        zone_relationship=rel,
        outer_chase_direction=zrel.outer_chase_direction,
        zone_relationship_status=zstatus,
        primary_zone=primary,
    )


def build_reports(
    trial_set: TrialSet,
    *,
    captures_dir: Path,
    noise_floor_pct: float,
    min_template_correlation: float,
    capture_results: dict[str, object] | None = None,
    cycle_tolerance_pct: float = 0.25,
) -> list[TrialReport]:
    """Classify every trial row. Duplicate hex rows reuse the source capture."""
    reports: list[TrialReport] = []
    cache: dict[str, list[Path]] = {}
    for trial in trial_set.trials:
        key = trial.hex_key
        if key not in cache:
            cache[key] = find_capture_csvs(captures_dir, trial)
        paths = cache[key]
        cap_status = "ok"
        cap_error = None
        if capture_results and key in capture_results:
            cr = capture_results[key]
            cap_status = getattr(cr, "capture_status", "ok")
            cap_error = getattr(cr, "error", None)
            if getattr(cr, "csv_paths", None):
                paths = list(cr.csv_paths)
        elif not paths:
            cap_status = "missing_csv"
        reports.append(
            classify_trial(
                trial,
                paths,
                noise_floor_pct=noise_floor_pct,
                min_template_correlation=min_template_correlation,
                capture_status=cap_status,
                capture_error=cap_error,
                cycle_tolerance_pct=cycle_tolerance_pct,
            )
        )
    return reports


PER_ZONE_NAMES = ["all", "outer"] + list(FIVE_CORNER_IDS)

CSV_COLUMNS = [
    "row_id",
    "sheet",
    "source_sheet_kind",
    "op_code",
    "hex_full",
    "location",
    "show",
    "effect_label",
    "inferred_label",
    "primary_zone",
    "waveform_class_r",
    "waveform_class_g",
    "waveform_class_b",
    "is_blend",
    "blend_style",
    "confidence",
    "status",
    "tail_bytes_summary",
    "waveform_class_brightness",
    "freq_hz",
    "capture_status",
    "n_repeats",
    "re_run_recommended",
    "length_byte",
    "color_count",
    "vibration_byte",
    "zone_layout",
    "zone_layout_assumed",
    "zone_layout_downgraded",
    "zone_relationship",
    "outer_chase_direction",
    "zone_relationship_status",
    "notes",
] + [
    col
    for z in PER_ZONE_NAMES
    for col in (
        f"waveform_class_r_{z}",
        f"waveform_class_g_{z}",
        f"waveform_class_b_{z}",
        f"is_blend_{z}",
        f"blend_style_{z}",
        f"estimated_period_ms_{z}",
        f"estimated_frequency_hz_{z}",
        f"estimated_amplitude_{z}",
        f"cycle_count_observed_{z}",
    )
]


def trial_report_to_dict(r: TrialReport, *, capture_paths: list[Path] | None = None) -> dict:
    """JSON/CSV-shaped view of a TrialReport (same fields as CSV_COLUMNS)."""
    t = r.trial
    row = {
        "row_id": t.row_id,
        "sheet": t.sheet,
        "source_sheet_kind": t.source_sheet_kind,
        "op_code": t.op_code or "",
        "hex_full": t.hex_full,
        "location": t.location or "",
        "show": t.show or "",
        "effect_label": t.effect_label or "",
        "inferred_label": r.inferred_label or "",
        "primary_zone": r.primary_zone,
        "waveform_class_r": r.waveform_class_r or "",
        "waveform_class_g": r.waveform_class_g or "",
        "waveform_class_b": r.waveform_class_b or "",
        "is_blend": None if r.is_blend is None else r.is_blend,
        "blend_style": r.blend_style or "",
        "confidence": round(r.confidence, 4),
        "status": r.status,
        "tail_bytes_summary": t.tail_bytes_summary(),
        "waveform_class_brightness": r.waveform_class_brightness or "",
        "freq_hz": r.freq_hz,
        "capture_status": r.capture_status,
        "n_repeats": r.n_repeats,
        "re_run_recommended": r.re_run_recommended,
        "length_byte": t.length_byte,
        "color_count": t.color_count,
        "vibration_byte": t.vibration_byte or "",
        "zone_layout": r.zone_layout,
        "zone_layout_assumed": r.zone_layout_assumed,
        "zone_layout_downgraded": r.zone_layout_downgraded,
        "zone_relationship": r.zone_relationship,
        "outer_chase_direction": r.outer_chase_direction or "",
        "zone_relationship_status": r.zone_relationship_status,
        "notes": list(r.notes),
        "capture_csv_paths": [str(p) for p in (capture_paths or [])],
    }
    for z, zr in r.zone_results.items():
        w = zr.waveforms
        row[f"waveform_class_r_{z}"] = w["r"].waveform_class
        row[f"waveform_class_g_{z}"] = w["g"].waveform_class
        row[f"waveform_class_b_{z}"] = w["b"].waveform_class
        row[f"is_blend_{z}"] = zr.blend.is_blend
        row[f"blend_style_{z}"] = zr.blend.blend_style or ""
        bri = w["brightness"]
        row[f"estimated_period_ms_{z}"] = bri.estimated_period_ms
        row[f"estimated_frequency_hz_{z}"] = bri.estimated_frequency_hz
        row[f"estimated_amplitude_{z}"] = bri.estimated_amplitude
        row[f"cycle_count_observed_{z}"] = bri.cycle_count_observed
    return row


def write_triage_csv(path: Path, reports: list[TrialReport]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for r in reports:
            t = r.trial
            row = {
                "row_id": t.row_id,
                "sheet": t.sheet,
                "source_sheet_kind": t.source_sheet_kind,
                "op_code": t.op_code or "",
                "hex_full": t.hex_full,
                "location": t.location or "",
                "show": t.show or "",
                "effect_label": t.effect_label or "",
                "inferred_label": r.inferred_label or "",
                "primary_zone": r.primary_zone,
                "waveform_class_r": r.waveform_class_r or "",
                "waveform_class_g": r.waveform_class_g or "",
                "waveform_class_b": r.waveform_class_b or "",
                "is_blend": "" if r.is_blend is None else str(r.is_blend).lower(),
                "blend_style": r.blend_style or "",
                "confidence": f"{r.confidence:.4f}",
                "status": r.status,
                "tail_bytes_summary": t.tail_bytes_summary(),
                "waveform_class_brightness": r.waveform_class_brightness or "",
                "freq_hz": "" if r.freq_hz is None else f"{r.freq_hz:.4f}",
                "capture_status": r.capture_status,
                "n_repeats": r.n_repeats,
                "re_run_recommended": str(r.re_run_recommended).lower(),
                "length_byte": "" if t.length_byte is None else t.length_byte,
                "color_count": "" if t.color_count is None else t.color_count,
                "vibration_byte": t.vibration_byte or "",
                "zone_layout": r.zone_layout,
                "zone_layout_assumed": str(r.zone_layout_assumed).lower(),
                "zone_layout_downgraded": str(r.zone_layout_downgraded).lower(),
                "zone_relationship": r.zone_relationship,
                "outer_chase_direction": r.outer_chase_direction or "",
                "zone_relationship_status": r.zone_relationship_status,
                "notes": "; ".join(r.notes),
            }
            for z, zr in r.zone_results.items():
                w = zr.waveforms
                row[f"waveform_class_r_{z}"] = w["r"].waveform_class
                row[f"waveform_class_g_{z}"] = w["g"].waveform_class
                row[f"waveform_class_b_{z}"] = w["b"].waveform_class
                row[f"is_blend_{z}"] = str(zr.blend.is_blend).lower()
                row[f"blend_style_{z}"] = zr.blend.blend_style or ""
                bri = w["brightness"]
                row[f"estimated_period_ms_{z}"] = "" if not bri.estimated_period_ms else f"{bri.estimated_period_ms:.1f}"
                row[f"estimated_frequency_hz_{z}"] = "" if not bri.estimated_frequency_hz else f"{bri.estimated_frequency_hz:.4f}"
                row[f"estimated_amplitude_{z}"] = f"{bri.estimated_amplitude:.2f}"
                row[f"cycle_count_observed_{z}"] = "" if bri.cycle_count_observed is None else f"{bri.cycle_count_observed:.2f}"
            writer.writerow(row)


def _needs_review(r: TrialReport, review_threshold: float) -> bool:
    if r.status in REVIEW_STATUSES:
        return True
    if r.zone_relationship_status == "disagree":
        return True
    if r.status == "unlabeled" and r.confidence < review_threshold:
        return True
    if r.status == "agree" and r.confidence < review_threshold:
        return True
    return False


def write_review_markdown(
    path: Path,
    reports: list[TrialReport],
    *,
    review_threshold: float,
    generated_at: str,
) -> int:
    """Finding-template-shaped Evidence tables, grouped by sheet then effect_label."""
    flagged = [r for r in reports if _needs_review(r, review_threshold)]
    path.parent.mkdir(parents=True, exist_ok=True)
    rerun = [r for r in flagged if r.re_run_recommended or r.status in {"inconsistent_repeats", "capture_failed"}]

    lines: list[str] = [
        f"# Review needed — {generated_at}",
        "",
        "Generated by `tools/wave-classifier`. Confidence scores are a **triage aid, not a finding**.",
        "Do not copy `Status` / `Confidence` into `docs/ble-packets-details/findings/` — fill those",
        "by hand per `docs/ble-packets-details/findings/_template.md`.",
        "",
        "Grouping is by xlsx sheet (human-assigned effect family) then `effect_label`.",
        "`op_code` is shown as a display label only (length-byte artifact, not a behavior family).",
        "",
        f"Flagged {len(flagged)} of {len(reports)} rows "
        f"(status in disagree / capture_failed / inconsistent_repeats, or confidence "
        f"< {review_threshold}).",
        "",
    ]

    if rerun:
        lines += [
            "## Re-run recommended",
            "",
            "Same-payload / different-outcome or a failed capture. Do not average these away;",
            "see `docs/ble-packets-details/findings/F-2026-08-26-01-e90b-chase-speed-byte.md`.",
            "",
            "| Sample | Hex (prefix) | Status | Observed | Labeled | Confidence |",
            "|---|---|---|---|---|---|",
        ]
        for r in rerun:
            hex_short = r.trial.hex_full.replace(" ", "")[:24]
            lines.append(
                f"| `{r.trial.row_id}` | `{hex_short}…` | {r.status} | "
                f"{r.inferred_label or '—'} | {r.trial.effect_label or '—'} | "
                f"{r.confidence:.2f} |"
            )
        lines.append("")

    by_sheet: dict[str, list[TrialReport]] = {}
    for r in flagged:
        by_sheet.setdefault(r.trial.sheet, []).append(r)

    for sheet in sorted(by_sheet):
        lines += [f"## {sheet}", ""]
        by_label: dict[str, list[TrialReport]] = {}
        for r in by_sheet[sheet]:
            by_label.setdefault(r.trial.effect_label or "(unlabeled)", []).append(r)
        for label in sorted(by_label):
            lines += [
                f"### {label}",
                "",
                "| Sample | op_code (label only) | Hex | Observed | Labeled | Confidence | Status |",
                "|---|---|---|---|---|---|---|",
            ]
            for r in by_label[label]:
                hex_short = r.trial.hex_full.replace(" ", "")
                if len(hex_short) > 40:
                    hex_short = hex_short[:40] + "…"
                lines.append(
                    f"| `{r.trial.row_id}` | `{r.trial.op_code or ''}` | `{hex_short}` | "
                    f"{r.inferred_label or '—'} | {r.trial.effect_label or '—'} | "
                    f"{r.confidence:.2f} | {r.status} |"
                )
            lines.append("")
            for r in by_label[label]:
                tail = r.trial.tail_bytes_summary() or "(none)"
                extra = "; ".join(r.notes) if r.notes else "—"
                lines += [
                    f"**`{r.trial.row_id}`** — layout `{r.zone_layout}` "
                    f"{'(assumed) ' if r.zone_layout_assumed else ''}"
                    f"primary={r.primary_zone} zone_rel={r.zone_relationship} "
                    f"({r.zone_relationship_status}) chase={r.outer_chase_direction or '—'}",
                    "",
                    f"- Tail (context, not decoded): `{tail}`",
                    f"- Notes: {extra}",
                    "",
                ]
                if r.zone_results and r.zone_layout != "single":
                    lines += [
                        "| Zone | waveform | blend | conf | period_ms |",
                        "|---|---|---|---|---|",
                    ]
                    for z, zr in r.zone_results.items():
                        bri = zr.waveforms["brightness"]
                        lines.append(
                            f"| `{z}` | {bri.waveform_class} | {zr.blend.blend_style or zr.inferred_label} | "
                            f"{zr.confidence:.2f} | "
                            f"{'' if not bri.estimated_period_ms else f'{bri.estimated_period_ms:.0f}'} |"
                        )
                    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    return len(flagged)


# Living effect vocabulary — keep in sync with the Wand Lab / xlsx legend.
EFFECT_VOCAB_TABLE = """\
| Effect | What it looks like |
|---|---|
| Chase | Lights follow in order |
| Shimmer | Lights cut on & off synchronously (one zone on, other zone off) |
| Flicker | Predominantly on, brief dim — candle-like |
| Pulse | Cut on & fade off |
| Cycle | Like a chase, but not all five regions |
| Strobe | Cuts on & off (zones together) |
| Heartbeat | Fade on, dim, fade to 100%, fade out, wait a beat, repeat |
| Cross-saw | Two colors: fade A→B, then cut back to A |
| Cross-fade | Two colors: smoothly ramps A↔B |
| Unique | Hard to describe; most likely programmatic |
| Circle | Outer chases with a tail to the background; inner sawtooth background→chase |
| Glow | Lights fade in & out |
"""


def write_claude_markdown(path: Path, reports: list[TrialReport], *, generated_at: str) -> None:
    """Self-contained markdown for pasting into another model. Not a finding."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = [
        f"# Wave-classifier observe report — {generated_at}",
        "",
        "Webcam-inferred labels. **Triage aid, not a finding.** Chase is spatial "
        "(LEDs follow in order); a single LED of a chase is a square cut, which is "
        "the same local shape as Strobe. Do not treat `inferred_label` as opcode truth.",
        "",
        "## Effect vocabulary",
        "",
        EFFECT_VOCAB_TABLE.strip(),
        "",
        f"{len(reports)} trial(s).",
        "",
    ]
    for i, r in enumerate(reports, start=1):
        t = r.trial
        lines += [
            f"## {i}. `{t.row_id}` — **{r.inferred_label or 'unclassified'}**",
            "",
            f"- hex_full: `{t.hex_full}`",
            f"- confidence: {r.confidence:.2f}  ·  status: `{r.status}`  ·  capture: `{r.capture_status}`",
            f"- zone_layout: `{r.zone_layout}`  ·  relationship: `{r.zone_relationship}`  "
            f"·  chase: `{r.outer_chase_direction or '—'}`",
            f"- brightness class (primary `{r.primary_zone}`): `{r.waveform_class_brightness or '—'}`  "
            f"·  R/G/B: `{r.waveform_class_r or '—'}` / `{r.waveform_class_g or '—'}` / `{r.waveform_class_b or '—'}`",
            f"- period: {'' if not r.freq_hz else f'{1000.0 / r.freq_hz:.0f} ms'}  "
            f"·  freq_hz: {r.freq_hz if r.freq_hz is not None else '—'}",
            f"- blend: {r.blend_style or ('yes' if r.is_blend else 'no')}",
            "",
        ]
        if r.zone_results:
            lines += [
                "| Zone | Brightness | R | G | B | Blend | Period ms | Amp |",
                "|---|---|---|---|---|---|---|---|",
            ]
            for z, zr in r.zone_results.items():
                w = zr.waveforms
                bri = w["brightness"]
                period = "" if not bri.estimated_period_ms else f"{bri.estimated_period_ms:.0f}"
                amp = f"{bri.estimated_amplitude:.1f}" if bri.estimated_amplitude else "—"
                lines.append(
                    f"| `{z}` | {bri.waveform_class} | {w['r'].waveform_class} | "
                    f"{w['g'].waveform_class} | {w['b'].waveform_class} | "
                    f"{zr.blend.blend_style or zr.inferred_label} | {period} | {amp} |"
                )
            lines.append("")
        if r.notes:
            lines += ["Notes:", ""]
            for n in r.notes:
                lines.append(f"- {n}")
            lines.append("")
        lines.append("")
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def write_observe_bundle(reports_dir: Path, reports: list[TrialReport]) -> dict:
    """CSV + Claude markdown + JSON. Returns path strings keyed csv/md/json."""
    reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = timestamp_slug()
    csv_path = reports_dir / f"observe-{stamp}.csv"
    md_path = reports_dir / f"observe-{stamp}.md"
    json_path = reports_dir / f"observe-{stamp}.json"
    write_triage_csv(csv_path, reports)
    write_claude_markdown(md_path, reports, generated_at=stamp)
    payload = [trial_report_to_dict(r) for r in reports]
    json_path.write_text(json.dumps(payload, indent=2, default=str) + "\n", encoding="utf-8")
    return {"csv": csv_path, "md": md_path, "json": json_path}


def summarize(reports: list[TrialReport]) -> dict[str, int]:
    counts = {
        "agree": 0,
        "disagree": 0,
        "unlabeled": 0,
        "capture_failed": 0,
        "inconsistent_repeats": 0,
        "zone_rel_agree": 0,
        "zone_rel_disagree": 0,
        "zone_rel_unlabeled": 0,
    }
    for r in reports:
        counts[r.status] = counts.get(r.status, 0) + 1
        key = f"zone_rel_{r.zone_relationship_status}"
        if key in counts:
            counts[key] += 1
    return counts


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
