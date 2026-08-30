"""Join classifications back to xlsx rows, score confidence, write reports.

Status values: agree, disagree, unlabeled, capture_failed, inconsistent_repeats.

A same-payload / different-outcome case is a prompt to re-run the trial, not to
average the captures away (see F-2026-08-26-01). Confidence is a triage aid,
not a finding — reports live under tools/wave-classifier/reports/ only.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .blend import BlendResult, analyze_blend, labels_agree
from .capture import find_capture_csvs, read_samples_csv
from .waveform import WaveformResult, classify_rgb
from .xlsx_loader import TrialRow, TrialSet

REVIEW_STATUSES = {"disagree", "capture_failed", "inconsistent_repeats"}


@dataclass
class RepeatClassification:
    path: Path
    waveforms: dict[str, WaveformResult]
    blend: BlendResult
    inferred_label: str
    confidence: float


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
) -> TrialReport:
    notes = list(trial.notes)
    if trial.duplicate_count > 1:
        notes.append(
            f"same capture used for {trial.duplicate_count} labeled rows "
            f"(source {trial.capture_source_row_id})"
        )
    if capture_error:
        notes.append(capture_error)

    if capture_status != "ok" or not csv_paths:
        status = "capture_failed"
        return TrialReport(
            trial=trial,
            inferred_label=None,
            waveform_class_r=None,
            waveform_class_g=None,
            waveform_class_b=None,
            waveform_class_brightness=None,
            is_blend=None,
            blend_style=None,
            confidence=0.0,
            status=status,
            capture_status=capture_status if csv_paths or capture_status != "ok" else "missing_csv",
            n_repeats=0,
            re_run_recommended=True,
            notes=notes,
        )

    repeats = [
        _classify_csv(
            p,
            noise_floor_pct=noise_floor_pct,
            min_template_correlation=min_template_correlation,
        )
        for p in csv_paths
    ]
    labels = [r.inferred_label for r in repeats]
    unique_labels = {lab.lower() for lab in labels}

    if len(repeats) > 1 and len(unique_labels) > 1:
        notes.append("inconsistent_repeats: " + ", ".join(f"{p.path.name}={p.inferred_label}" for p in repeats))
        pick = repeats[0]
        return TrialReport(
            trial=trial,
            inferred_label=pick.inferred_label,
            waveform_class_r=pick.waveforms["r"].waveform_class,
            waveform_class_g=pick.waveforms["g"].waveform_class,
            waveform_class_b=pick.waveforms["b"].waveform_class,
            waveform_class_brightness=pick.waveforms["brightness"].waveform_class,
            is_blend=pick.blend.is_blend,
            blend_style=pick.blend.blend_style,
            confidence=sum(r.confidence for r in repeats) / len(repeats),
            status="inconsistent_repeats",
            capture_status="ok",
            n_repeats=len(repeats),
            re_run_recommended=True,
            notes=notes,
            repeats=repeats,
            freq_hz=pick.waveforms["brightness"].freq_hz,
        )

    pick_label = _majority_label(labels) or labels[0]
    pick = next(r for r in repeats if r.inferred_label == pick_label)
    mean_conf = sum(r.confidence for r in repeats) / len(repeats)

    labeled = trial.effect_label
    if labeled:
        status = "agree" if labels_agree(pick_label, labeled) else "disagree"
    else:
        status = "unlabeled"

    return TrialReport(
        trial=trial,
        inferred_label=pick_label,
        waveform_class_r=pick.waveforms["r"].waveform_class,
        waveform_class_g=pick.waveforms["g"].waveform_class,
        waveform_class_b=pick.waveforms["b"].waveform_class,
        waveform_class_brightness=pick.waveforms["brightness"].waveform_class,
        is_blend=pick.blend.is_blend,
        blend_style=pick.blend.blend_style,
        confidence=mean_conf,
        status=status,
        capture_status="ok",
        n_repeats=len(repeats),
        re_run_recommended=status == "disagree",
        notes=notes,
        repeats=repeats,
        freq_hz=pick.waveforms["brightness"].freq_hz,
    )


def build_reports(
    trial_set: TrialSet,
    *,
    captures_dir: Path,
    noise_floor_pct: float,
    min_template_correlation: float,
    capture_results: dict[str, object] | None = None,
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
            )
        )
    return reports


CSV_COLUMNS = [
    "row_id",
    "sheet",
    "op_code",
    "hex_full",
    "location",
    "show",
    "effect_label",
    "inferred_label",
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
    "notes",
]


def write_triage_csv(path: Path, reports: list[TrialReport]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for r in reports:
            t = r.trial
            writer.writerow(
                {
                    "row_id": t.row_id,
                    "sheet": t.sheet,
                    "op_code": t.op_code or "",
                    "hex_full": t.hex_full,
                    "location": t.location or "",
                    "show": t.show or "",
                    "effect_label": t.effect_label or "",
                    "inferred_label": r.inferred_label or "",
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
                    "notes": "; ".join(r.notes),
                }
            )


def _needs_review(r: TrialReport, review_threshold: float) -> bool:
    if r.status in REVIEW_STATUSES:
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
                    f"**`{r.trial.row_id}`** — waveform R/G/B/brightness: "
                    f"{r.waveform_class_r}/{r.waveform_class_g}/{r.waveform_class_b}/"
                    f"{r.waveform_class_brightness}; blend={r.is_blend} style={r.blend_style or '—'}",
                    "",
                    f"- Tail (context, not decoded): `{tail}`",
                    f"- Notes: {extra}",
                    "",
                ]

    path.write_text("\n".join(lines), encoding="utf-8")
    return len(flagged)


def summarize(reports: list[TrialReport]) -> dict[str, int]:
    counts = {
        "agree": 0,
        "disagree": 0,
        "unlabeled": 0,
        "capture_failed": 0,
        "inconsistent_repeats": 0,
    }
    for r in reports:
        counts[r.status] = counts.get(r.status, 0) + 1
    return counts


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
