"""Markdown + CSV writers for timeline mode. No inferred_label / waveform_class."""

from __future__ import annotations

import csv
from pathlib import Path

from .timeline import TimelineReport, TimelineTick
from .xlsx_loader import fs_safe


def _mix_cell(tick: TimelineTick, names: list[str]) -> str:
    blend = tick.blend
    if blend is None:
        return "—"
    if blend.mix_fraction is None:
        if blend.nearest_expected_idx is None:
            return "—"
        i = blend.nearest_expected_idx
        label = names[i] if i < len(names) else f"c{i}"
        return label
    axis = "→".join(names[:2]) if len(names) >= 2 else "A→B"
    pct = int(round(blend.mix_fraction * 100))
    return f"{pct}% ({axis})"


def _color_cell(tick: TimelineTick) -> str:
    if tick.is_baseline:
        return "— (baseline black)"
    if tick.nearest_palette_name is None:
        return "— (off)"
    return tick.nearest_palette_name


def format_timeline_markdown(report: TimelineReport) -> str:
    trial = report.trial
    row_id = getattr(trial, "row_id", "")
    hex_full = getattr(trial, "hex_full", "")
    hz_s = f"{report.hz:.1f} Hz" if report.hz else "native frames"
    src = report.calibration_source
    age = report.calibration_age_s
    age_s = f", age {age:.0f}s" if age is not None else ""
    names = report.expected_color_names
    mix_header = "mix% (" + "→".join(names[:2]) + ")" if len(names) >= 2 else "mix / nearest expected"
    lines = [
        f"## Trial `{row_id}` — timeline ({hz_s}, {src})",
        "",
        f"hex_full: `{hex_full}`",
        f"Expected colors (from packet): {', '.join(names) if names else '—'}",
        f"Calibration: {src}{age_s}",
        f"Zones captured: {', '.join(report.zones)}",
    ]
    if report.baseline_tick_range:
        lo, hi = report.baseline_tick_range
        lines.append(f"baseline_tick_range: [{lo}, {hi}) — rows marked (baseline black)")
    lines.append("")
    if report.warnings:
        for w in report.warnings:
            lines.append(f"⚠ {w}")
        lines.append("")
    lines += [
        f"| t_ms | zone | nearest_color | {mix_header} | residual | brightness | baseline |",
        "|---|---|---|---|---|---|---|",
    ]
    zone_order = list(report.zones)
    # Interleave by tick index so a chase walks down the zone list at each t.
    max_ticks = max((len(v) for v in report.zones.values()), default=0)
    for i in range(max_ticks):
        for zone in zone_order:
            ticks = report.zones[zone]
            if i >= len(ticks):
                continue
            tk = ticks[i]
            resid = f"{tk.blend.residual_distance:.1f}" if tk.blend else "—"
            lines.append(
                f"| {tk.t_ms:.0f} | {zone} | {_color_cell(tk)} | {_mix_cell(tk, names)} | "
                f"{resid} | {tk.brightness:.0f} | {'yes' if tk.is_baseline else ''} |"
            )
    lines.append("")
    return "\n".join(lines)


def write_timeline_trial_markdown(path: Path, report: TimelineReport) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(format_timeline_markdown(report).rstrip() + "\n", encoding="utf-8")


def write_combined_timeline_markdown(path: Path, reports: list[TimelineReport], *, generated_at: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    parts = [
        f"# Wave-classifier timeline — {generated_at}",
        "",
        "Per-tick webcam RGB against calibrated palette colors. "
        "**Not a classification.** Read nearest_color / mix% / residual down the zone list.",
        "",
        f"{len(reports)} trial(s).",
        "",
    ]
    for r in reports:
        parts.append(format_timeline_markdown(r))
        parts.append("")
    path.write_text("\n".join(parts).rstrip() + "\n", encoding="utf-8")


def flatten_ticks(reports: list[TimelineReport]) -> list[dict]:
    rows = []
    for report in reports:
        trial = report.trial
        row_id = getattr(trial, "row_id", "")
        hex_full = getattr(trial, "hex_full", "")
        for zone, ticks in report.zones.items():
            for tk in ticks:
                mix = tk.blend.mix_fraction if tk.blend else None
                nexp = tk.blend.nearest_expected_idx if tk.blend else None
                resid = tk.blend.residual_distance if tk.blend else None
                rows.append({
                    "row_id": row_id,
                    "hex_full": hex_full,
                    "t_ms": round(tk.t_ms, 3),
                    "tick_index": tk.tick_index,
                    "zone": zone,
                    "r": round(tk.r, 4),
                    "g": round(tk.g, 4),
                    "b": round(tk.b, 4),
                    "brightness": round(tk.brightness, 4),
                    "nearest_color_idx": tk.nearest_palette_idx if tk.nearest_palette_idx is not None else "",
                    "mix_fraction": "" if mix is None else round(mix, 4),
                    "nearest_expected_idx": "" if nexp is None else nexp,
                    "residual_distance": "" if resid is None else round(resid, 4),
                    "calibration_source": report.calibration_source,
                    "is_baseline": tk.is_baseline,
                })
    return rows


CSV_COLUMNS = [
    "row_id",
    "hex_full",
    "t_ms",
    "tick_index",
    "zone",
    "r",
    "g",
    "b",
    "brightness",
    "nearest_color_idx",
    "mix_fraction",
    "nearest_expected_idx",
    "residual_distance",
    "calibration_source",
    "is_baseline",
]


def write_all_ticks_csv(path: Path, reports: list[TimelineReport]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for row in flatten_ticks(reports):
            writer.writerow(row)


def write_timeline_bundle(
    reports_dir: Path,
    reports: list[TimelineReport],
    *,
    stamp: str,
) -> dict:
    """Per-trial md under timeline-<stamp>/, combined md, all-ticks.csv."""
    folder = reports_dir / f"timeline-{stamp}"
    folder.mkdir(parents=True, exist_ok=True)
    combined = reports_dir / f"timeline-{stamp}.md"
    csv_path = folder / "all-ticks.csv"
    write_combined_timeline_markdown(combined, reports, generated_at=stamp)
    write_all_ticks_csv(csv_path, reports)
    for report in reports:
        rid = fs_safe(getattr(report.trial, "row_id", "trial"))
        write_timeline_trial_markdown(folder / f"{rid}.md", report)
    return {"md": combined, "csv": csv_path, "dir": folder}


def timeline_report_to_dict(report: TimelineReport) -> dict:
    """JSON-shaped summary for Observe (not a classifier verdict)."""
    trial = report.trial
    n_ticks = max((len(v) for v in report.zones.values()), default=0)
    return {
        "report_kind": "timeline",
        "row_id": getattr(trial, "row_id", ""),
        "hex_full": getattr(trial, "hex_full", ""),
        "hz": report.hz,
        "calibration_source": report.calibration_source,
        "calibration_age_s": report.calibration_age_s,
        "expected_colors": report.expected_color_names,
        "zones": list(report.zones),
        "tick_count": n_ticks,
        "baseline_tick_range": list(report.baseline_tick_range) if report.baseline_tick_range else None,
        "warnings": list(report.warnings),
        "colors": ", ".join(report.expected_color_names),
    }
