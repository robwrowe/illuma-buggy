"""Per-zone, per-tick color timeline — no effect classification.

Brightness is max(r, g, b), not a channel sum: that matches how the palette
RGB values were defined as maximal per-channel colors, and avoids conflating
"bright and saturated" with "bright and white."

hz=None (default) wraps each already-captured frame as one tick. Passing hz
above measured_fps interpolates information the camera never captured.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .color_mix import parse_expected_colors
from .palette import PaletteCalibration, guessed_calibration, palette_entry

# See module docstring. Do not silently switch this to mean(r,g,b).
BRIGHTNESS_MODE = "max_channel"


def brightness_of(r: float, g: float, b: float) -> float:
    return float(max(r, g, b))


@dataclass
class BlendEstimate:
    expected_color_names: list[str]
    mix_fraction: float | None
    nearest_expected_idx: int | None
    residual_distance: float


@dataclass
class TimelineTick:
    t_ms: float
    tick_index: int
    r: float
    g: float
    b: float
    brightness: float
    nearest_palette_idx: int | None
    nearest_palette_name: str | None
    nearest_palette_distance: float
    blend: BlendEstimate | None
    is_baseline: bool = False


@dataclass
class TimelineReport:
    trial: object
    hz: float
    baseline_tick_range: tuple[int, int] | None
    calibration_source: str
    calibration_age_s: float | None
    zones: dict[str, list[TimelineTick]]
    warnings: list[str] = field(default_factory=list)
    expected_color_names: list[str] = field(default_factory=list)
    black_floor: dict[str, float] = field(default_factory=dict)


def _as_arrays(t_ms, r, g, b):
    t = np.asarray(t_ms, dtype=float)
    rr = np.asarray(r, dtype=float)
    gg = np.asarray(g, dtype=float)
    bb = np.asarray(b, dtype=float)
    n = min(t.size, rr.size, gg.size, bb.size)
    return t[:n], rr[:n], gg[:n], bb[:n]


def resample_to_ticks(
    t_ms,
    r,
    g,
    b,
    *,
    hz: float | None = None,
    measured_fps: float | None = None,
) -> tuple[list[tuple[float, float, float, float]], list[str]]:
    """Return [(t, r, g, b), ...] and warnings. hz=None keeps native frames."""
    t, rr, gg, bb = _as_arrays(t_ms, r, g, b)
    warnings: list[str] = []
    if t.size == 0:
        return [], warnings
    native_fps = measured_fps
    if native_fps is None and t.size >= 2:
        diffs = np.diff(t)
        diffs = diffs[diffs > 0]
        med = float(np.median(diffs)) if diffs.size else 0.0
        if med > 0:
            native_fps = 1000.0 / med
    if hz is None or hz <= 0:
        rows = [(float(t[i]), float(rr[i]), float(gg[i]), float(bb[i])) for i in range(t.size)]
        return rows, warnings
    if native_fps is not None and hz > native_fps + 0.05:
        warnings.append(
            f"requested {hz:.1f} Hz is above camera {native_fps:.1f} fps — "
            "ticks are interpolated, not extra real samples"
        )
    if native_fps is not None and native_fps < 2 * hz:
        warnings.append(
            f"tick rate {hz:.1f} Hz vs camera {native_fps:.1f} fps — below Nyquist "
            "(timeline may alias fast shimmer/strobe)"
        )
    dt = 1000.0 / float(hz)
    t0 = float(t[0])
    t1 = float(t[-1])
    if t1 <= t0:
        return [(t0, float(rr[0]), float(gg[0]), float(bb[0]))], warnings
    t_u = np.arange(t0, t1 + dt * 0.5, dt)
    if t_u.size < 1:
        t_u = np.array([t0])
    r_u = np.interp(t_u, t, rr)
    g_u = np.interp(t_u, t, gg)
    b_u = np.interp(t_u, t, bb)
    rows = [
        (float(t_u[i]), float(r_u[i]), float(g_u[i]), float(b_u[i]))
        for i in range(t_u.size)
    ]
    return rows, warnings


def project_onto_segment(
    p: np.ndarray,
    a: np.ndarray,
    b: np.ndarray,
) -> tuple[float, float]:
    """Clamp mix t to [0, 1]; residual is distance to the clamped point on AB."""
    ab = b - a
    denom = float(np.dot(ab, ab))
    if denom < 1e-9:
        nearest = a
        t = 0.0
    else:
        t = float(np.dot(p - a, ab) / denom)
        t = min(1.0, max(0.0, t))
        nearest = a + t * ab
    residual = float(np.linalg.norm(p - nearest))
    return t, residual


def estimate_blend(
    rgb: tuple[float, float, float],
    expected: list[dict],
    calibration: PaletteCalibration,
    zone: str | None = None,
) -> BlendEstimate | None:
    colors = parse_expected_colors(expected)
    if not colors:
        return None
    names = []
    refs = []
    for c in colors:
        idx = c.get("palette_idx")
        if idx is not None:
            refs.append(np.array(calibration.rgb(int(idx), zone), dtype=float))
            n = (c.get("name") or palette_entry(int(idx))["name"]).strip()
            names.append(f"{n}[{int(idx)}]")
        else:
            refs.append(np.array([c["r"], c["g"], c["b"]], dtype=float))
            names.append(c.get("name") or f"#{c['r']:02X}{c['g']:02X}{c['b']:02X}")
    p = np.array(rgb, dtype=float)
    if len(refs) == 2:
        t, resid = project_onto_segment(p, refs[0], refs[1])
        d0 = float(np.linalg.norm(p - refs[0]))
        d1 = float(np.linalg.norm(p - refs[1]))
        nearest = 0 if d0 <= d1 else 1
        return BlendEstimate(names, t, nearest, resid)
    dists = [float(np.linalg.norm(p - ref)) for ref in refs]
    nearest = int(np.argmin(dists))
    return BlendEstimate(names, None, nearest, dists[nearest])


def nearest_calibrated_color(
    rgb: tuple[float, float, float],
    calibration: PaletteCalibration,
    zone: str | None = None,
) -> tuple[int | None, str | None, float]:
    p = np.array(rgb, dtype=float)
    best_i = None
    best_d = float("inf")
    for idx, _ref in calibration.by_index.items():
        d = float(np.linalg.norm(p - np.array(calibration.rgb(idx, zone), dtype=float)))
        if d < best_d:
            best_d = d
            best_i = idx
    if best_i is None:
        return None, None, best_d if best_d < float("inf") else 0.0
    name = palette_entry(best_i)["name"]
    return best_i, f"{name}[{best_i}]", best_d


def _black_floor_for_zone(rows: list[tuple[float, float, float, float]], baseline_n: int) -> float:
    if baseline_n <= 0 or not rows:
        return 0.0
    n = min(baseline_n, len(rows))
    vals = [brightness_of(r, g, b) for _, r, g, b in rows[:n]]
    return float(sum(vals) / max(len(vals), 1))


def build_timeline_report(
    trial,
    series_by_zone: dict,
    expected_colors: list | None,
    calibration: PaletteCalibration | None,
    *,
    hz: float | None = None,
    measured_fps: float | None = None,
    baseline_tick_range: tuple[int, int] | None = None,
    cycle_period_ms: float | None = None,
) -> TimelineReport:
    cal = calibration if calibration is not None else guessed_calibration()
    warnings: list[str] = []
    if cal.source == "guessed":
        warnings.append(
            "calibration_source=guessed — mix% is against placeholder palette hex, not this camera"
        )
    expected = list(expected_colors or getattr(trial, "expected_colors", None) or [])
    if not expected:
        warnings.append("no expected colors on this packet — nearest_color is any calibrated index")
    names = []
    for c in parse_expected_colors(expected):
        idx = c.get("palette_idx")
        n = (c.get("name") or "").strip()
        if idx is not None:
            n = n or palette_entry(int(idx))["name"]
            names.append(f"{n}[{int(idx)}]")
        else:
            names.append(n or f"#{c['r']:02X}{c['g']:02X}{c['b']:02X}")

    zones: dict[str, list[TimelineTick]] = {}
    black_floor: dict[str, float] = {}
    resolved_hz = hz if hz and hz > 0 else (measured_fps or 0.0)
    baseline_lo, baseline_hi = (None, None)
    if baseline_tick_range:
        baseline_lo, baseline_hi = int(baseline_tick_range[0]), int(baseline_tick_range[1])

    for zone, series in series_by_zone.items():
        t_ms, r, g, b = series
        rows, w = resample_to_ticks(t_ms, r, g, b, hz=hz, measured_fps=measured_fps)
        warnings.extend(w)
        if hz is None and rows and resolved_hz <= 0:
            if len(rows) >= 2:
                dt = rows[-1][0] - rows[0][0]
                if dt > 0:
                    resolved_hz = (len(rows) - 1) / (dt / 1000.0)
        if baseline_hi is not None:
            black_floor[zone] = _black_floor_for_zone(rows, baseline_hi)
        else:
            black_floor[zone] = 0.0
        floor = black_floor[zone]
        ticks: list[TimelineTick] = []
        for i, (tm, rr, gg, bb) in enumerate(rows):
            bri = max(0.0, brightness_of(rr, gg, bb) - floor)
            pal_i, pal_n, pal_d = nearest_calibrated_color((rr, gg, bb), cal, zone)
            blend = estimate_blend((rr, gg, bb), expected, cal, zone)
            is_base = (
                baseline_lo is not None
                and baseline_hi is not None
                and baseline_lo <= i < baseline_hi
            )
            off = bri < max(6.0, 0.08 * (255.0 - floor))
            if off and not is_base:
                pal_n_out = None
            else:
                pal_n_out = pal_n
            ticks.append(
                TimelineTick(
                    t_ms=tm,
                    tick_index=i,
                    r=rr,
                    g=gg,
                    b=bb,
                    brightness=bri,
                    nearest_palette_idx=None if (off and not is_base) else pal_i,
                    nearest_palette_name=pal_n_out,
                    nearest_palette_distance=pal_d,
                    blend=blend,
                    is_baseline=is_base,
                )
            )
        zones[zone] = ticks

    if hz is not None and hz > 0 and cycle_period_ms and cycle_period_ms > 0:
        tick_ms = 1000.0 / hz
        if cycle_period_ms <= tick_ms * 1.5:
            warnings.append(
                f"estimated cycle {cycle_period_ms:.0f} ms is close to tick {tick_ms:.0f} ms — "
                "timeline may be undersampled"
            )
    if hz is None and measured_fps:
        resolved_hz = measured_fps
    if resolved_hz <= 0:
        resolved_hz = 0.0

    # Residual spike: >40 on >30% of non-baseline ticks, per zone.
    for zone, ticks in zones.items():
        live = [tk for tk in ticks if not tk.is_baseline]
        if len(live) < 8:
            continue
        n_hi = sum(1 for tk in live if tk.blend and tk.blend.residual_distance > 40)
        if n_hi / len(live) > 0.30:
            warnings.append(
                f"{zone}: residual_distance > 40 on {n_hi}/{len(live)} ticks — "
                "check ROI framing or calibration staleness"
            )

    return TimelineReport(
        trial=trial,
        hz=float(resolved_hz),
        baseline_tick_range=baseline_tick_range,
        calibration_source=cal.source,
        calibration_age_s=cal.age_s,
        zones=zones,
        warnings=_uniq(warnings),
        expected_color_names=names,
        black_floor=black_floor,
    )


def _uniq(items: list[str]) -> list[str]:
    out = []
    seen = set()
    for x in items:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out
