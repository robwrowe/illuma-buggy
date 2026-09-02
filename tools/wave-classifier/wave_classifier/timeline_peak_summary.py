"""Per-zone peak palette summary for timeline reports."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .timeline import TimelineReport, TimelineTick
from .zones import FIVE_CORNER_IDS

# E909 five-slot byte order (packet → physical LED).
E909_ZONE_ORDER = ["center", "topRight", "bottomRight", "bottomLeft", "topLeft"]


@dataclass
class ZonePeakRow:
    zone: str
    expected_palette_idx: int | None
    measured_palette_idx: int | None
    measured_palette_name: str | None
    peak_raw_brightness: float
    peak_t_ms: float
    match: bool | None
    n_lit_ticks: int


def _raw_brightness(tick: TimelineTick) -> float:
    return max(float(tick.r), float(tick.g), float(tick.b))


def expected_palette_by_zone(trial) -> dict[str, int]:
    """Map ROI zone name → expected palette index from trial metadata."""
    out: dict[str, int] = {}
    expected = list(getattr(trial, "expected_colors", None) or [])
    for c in expected:
        if not isinstance(c, dict) or c.get("palette_idx") is None:
            continue
        idx = int(c["palette_idx"]) & 0x1F
        name = str(c.get("name") or "").strip()
        if name:
            key = name.replace(" ", "").replace("_", "")
            # Accept topRight / topright / top-right style keys.
            for z in FIVE_CORNER_IDS + ["outer"]:
                if key.lower() == z.lower():
                    out[z] = idx
                    break
            else:
                out[name] = idx
    for i, c in enumerate(expected):
        if not isinstance(c, dict) or c.get("palette_idx") is None:
            continue
        if i < len(E909_ZONE_ORDER) and E909_ZONE_ORDER[i] not in out:
            out[E909_ZONE_ORDER[i]] = int(c["palette_idx"]) & 0x1F
    return out


def summarize_zone_peaks(
    report: TimelineReport,
    *,
    min_raw_brightness: float = 30.0,
) -> list[ZonePeakRow]:
    """Dominant measured palette per zone at peak raw RGB (non-baseline ticks)."""
    expected = expected_palette_by_zone(report.trial)
    rows: list[ZonePeakRow] = []
    zone_order = list(report.zones.keys()) or list(FIVE_CORNER_IDS)
    for zone in zone_order:
        ticks = report.zones.get(zone) or []
        live = [tk for tk in ticks if not tk.is_baseline and _raw_brightness(tk) >= min_raw_brightness]
        if not live:
            rows.append(
                ZonePeakRow(
                    zone=zone,
                    expected_palette_idx=expected.get(zone),
                    measured_palette_idx=None,
                    measured_palette_name=None,
                    peak_raw_brightness=0.0,
                    peak_t_ms=0.0,
                    match=None,
                    n_lit_ticks=0,
                )
            )
            continue
        best = max(live, key=_raw_brightness)
        peak = _raw_brightness(best)
        meas = best.nearest_palette_idx
        exp = expected.get(zone)
        match: bool | None = None
        if exp is not None and meas is not None:
            match = int(exp) == int(meas)
        rows.append(
            ZonePeakRow(
                zone=zone,
                expected_palette_idx=exp,
                measured_palette_idx=meas,
                measured_palette_name=best.nearest_palette_name,
                peak_raw_brightness=peak,
                peak_t_ms=float(best.t_ms),
                match=match,
                n_lit_ticks=len(live),
            )
        )
    return rows


def format_peak_summary_markdown(report: TimelineReport, rows: list[ZonePeakRow] | None = None) -> str:
    rows = rows if rows is not None else summarize_zone_peaks(report)
    trial = report.trial
    row_id = getattr(trial, "row_id", "")
    matched = sum(1 for r in rows if r.match is True)
    comparable = sum(1 for r in rows if r.match is not None)
    lines = [
        f"### Peak summary — `{row_id}`",
        "",
        f"Per-zone palette at brightest non-baseline frame "
        f"({matched}/{comparable} match expected when comparable).",
        "",
        "| zone | expected pal | measured pal | peak | t_ms | match | lit ticks |",
        "|---|---:|---|---:|---:|:---:|---:|",
    ]
    for r in rows:
        exp_s = "—" if r.expected_palette_idx is None else str(r.expected_palette_idx)
        if r.measured_palette_idx is None:
            meas_s = "— (dark)"
        elif r.measured_palette_name:
            meas_s = f"{r.measured_palette_name}[{r.measured_palette_idx}]"
        else:
            meas_s = str(r.measured_palette_idx)
        match_s = "—" if r.match is None else ("yes" if r.match else "no")
        lines.append(
            f"| {r.zone} | {exp_s} | {meas_s} | {r.peak_raw_brightness:.0f} | "
            f"{r.peak_t_ms:.0f} | {match_s} | {r.n_lit_ticks} |"
        )
    lines.append("")
    return "\n".join(lines)


def peak_summary_rows(report: TimelineReport) -> list[dict[str, Any]]:
    trial = report.trial
    row_id = getattr(trial, "row_id", "")
    hex_full = getattr(trial, "hex_full", "")
    out: list[dict[str, Any]] = []
    for r in summarize_zone_peaks(report):
        out.append({
            "row_id": row_id,
            "hex_full": hex_full,
            "zone": r.zone,
            "expected_palette_idx": "" if r.expected_palette_idx is None else r.expected_palette_idx,
            "measured_palette_idx": "" if r.measured_palette_idx is None else r.measured_palette_idx,
            "measured_palette_name": r.measured_palette_name or "",
            "peak_raw_brightness": round(r.peak_raw_brightness, 2),
            "peak_t_ms": round(r.peak_t_ms, 2),
            "match_expected": "" if r.match is None else str(r.match).lower(),
            "lit_tick_count": r.n_lit_ticks,
        })
    return out


PEAK_SUMMARY_COLUMNS = [
    "row_id",
    "hex_full",
    "zone",
    "expected_palette_idx",
    "measured_palette_idx",
    "measured_palette_name",
    "peak_raw_brightness",
    "peak_t_ms",
    "match_expected",
    "lit_tick_count",
]
