"""Two-channel phase / crossover detection and spatial effect inference.

Maps onto the living effect vocabulary (Chase / Strobe / Shimmer / …). Chase is
spatial — LEDs follow in order — so a per-zone square cut is *not* enough to
call Strobe. Pulse vs Heartbeat stays conservative (style-flag bit).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import signal

from .waveform import WaveformResult, _normalize, resample_series

# Closed vocabulary from the xlsx INSTRUCTIONS effect legend.
XLSX_EFFECT_VOCAB = (
    "Chase",
    "Shimmer",
    "Flicker",
    "Pulse",
    "Cycle",
    "Strobe",
    "Heartbeat",
    "Cross-saw",
    "Cross-fade",
    "Unique",
    "Circle",
    "Glow",
    "Solid",
    "SW Twinkle",
    "Flicker Chase",
)

IN_PHASE_DEG = 25.0
ANTI_PHASE_DEG = 155.0


@dataclass
class PairPhase:
    a: str
    b: str
    lag_ms: float
    correlation: float
    phase_deg: float | None


@dataclass
class BlendResult:
    is_blend: bool
    blend_style: str | None
    channels_in_phase: bool
    is_antiphase: bool
    brightness_cv: float
    chroma_motion: float
    pairs: list[PairPhase] = field(default_factory=list)
    inferred_label: str = "unclassified"


def _wrap_deg(deg: float) -> float:
    """Wrap to (-180, 180]."""
    x = ((deg + 180.0) % 360.0) - 180.0
    if x == -180.0:
        return 180.0
    return x


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    aa = _normalize(a)
    bb = _normalize(b)
    if aa.size < 4:
        return 0.0
    return float(np.clip(np.mean(aa * bb), -1.0, 1.0))


def _xcorr_lag_ms(a: np.ndarray, b: np.ndarray, dt_ms: float) -> tuple[float, float]:
    aa = _normalize(a)
    bb = _normalize(b)
    if aa.size < 4 or dt_ms <= 0:
        return 0.0, 0.0
    corr = signal.correlate(aa, bb, mode="full")
    n = min(aa.size, bb.size)
    i = int(np.argmax(corr))
    lag_samples = i - (n - 1)
    peak = float(np.clip(corr[i] / n, -1.0, 1.0))
    return lag_samples * dt_ms, peak


def analyze_blend(
    t_ms: np.ndarray,
    r: np.ndarray,
    g: np.ndarray,
    b: np.ndarray,
    channels: dict[str, WaveformResult],
) -> BlendResult:
    t_u, r_u, dt = resample_series(t_ms, r)
    _, g_u, _ = resample_series(t_ms, g)
    _, b_u, _ = resample_series(t_ms, b)
    n = min(t_u.size, r_u.size, g_u.size, b_u.size)
    r_u, g_u, b_u = r_u[:n], g_u[:n], b_u[:n]
    series = {"r": r_u, "g": g_u, "b": b_u}

    freq = next(
        (channels[k].freq_hz for k in ("brightness", "r", "g", "b") if channels[k].freq_hz),
        None,
    )
    period_ms = (1000.0 / freq) if freq and freq > 0 else None

    pairs: list[PairPhase] = []
    for a_name, b_name in (("r", "g"), ("g", "b"), ("r", "b")):
        lag_ms, corr = _xcorr_lag_ms(series[a_name], series[b_name], dt)
        phase = None
        if period_ms and period_ms > 0:
            phase = _wrap_deg(360.0 * lag_ms / period_ms)
        pairs.append(PairPhase(a=a_name, b=b_name, lag_ms=lag_ms, correlation=corr, phase_deg=phase))

    lag0 = [
        _pearson(series[a], series[b])
        for a, b in (("r", "g"), ("g", "b"), ("r", "b"))
    ]
    opposing = any(c < -0.5 for c in lag0)

    strong = [p for p in pairs if p.correlation >= 0.4 and p.phase_deg is not None]
    in_phase = (bool(strong) and all(abs(p.phase_deg or 0) < IN_PHASE_DEG for p in strong)) or (
        max(lag0) > 0.7 and not opposing
    )
    antiphase = bool(strong) and all(abs(p.phase_deg or 0) >= ANTI_PHASE_DEG for p in strong)
    mid_phase = any(
        p.phase_deg is not None
        and IN_PHASE_DEG <= abs(p.phase_deg) < ANTI_PHASE_DEG
        and p.correlation >= 0.4
        for p in pairs
    )

    total = r_u + g_u + b_u
    mean_total = float(np.mean(total)) + 1e-9
    brightness_cv = float(np.std(total) / mean_total)
    chroma = np.stack([r_u, g_u, b_u], axis=0) / mean_total
    chroma_motion = float(np.std(chroma, axis=1).sum())
    constant_brightness_ratio_shift = brightness_cv < 0.18 and chroma_motion > 0.04

    energetic = [k for k in ("r", "g", "b") if channels[k].waveform_class != "flat"]
    shapes = {channels[k].waveform_class for k in energetic}

    # Two colors trading brightness: inverted (lag-0 corr < -0.5), a mid-phase
    # offset, or total brightness holding still while chroma moves.
    two_color = opposing or constant_brightness_ratio_shift or mid_phase
    is_blend = False
    blend_style = None
    if two_color:
        if "sawtooth" in shapes:
            is_blend = True
            blend_style = "Cross-saw"
        elif shapes & {"sine", "triangle"}:
            is_blend = True
            blend_style = "Cross-fade"
        elif shapes <= {"square", "irregular"} and "square" in shapes:
            # Hard cut between two states (Shimmer), not a smooth blend.
            antiphase = True
        else:
            is_blend = True

    inferred = _infer_label(
        is_blend=is_blend,
        blend_style=blend_style,
        wave=channels["brightness"].waveform_class,
        is_antiphase=antiphase,
    )
    return BlendResult(
        is_blend=is_blend,
        blend_style=blend_style,
        channels_in_phase=in_phase,
        is_antiphase=antiphase,
        brightness_cv=brightness_cv,
        chroma_motion=chroma_motion,
        pairs=pairs,
        inferred_label=inferred,
    )


def duty_cycle(values: np.ndarray) -> float:
    """Fraction of samples at/above the mid of the 10–90 percentile span."""
    v = np.asarray(values, dtype=float)
    if v.size == 0:
        return 0.0
    lo, hi = float(np.percentile(v, 10)), float(np.percentile(v, 90))
    if hi - lo < 1e-6:
        return 1.0
    return float(np.mean(v >= (lo + hi) / 2.0))


def staggered_zone_order(
    series_by_zone: dict,
    names: list,
    *,
    min_span_ms: float = 40.0,
) -> list | None:
    """Peak-brightness order across zones.

    Strobe: all zones peak together (span < min_span_ms). Chase: peaks walk.
    Uses the brightest sample in the window — good enough for one-or-two cycles.
    """
    peaks = []
    for z in names:
        if z not in series_by_zone:
            continue
        t_ms, series = series_by_zone[z]
        t_arr = np.asarray(t_ms, dtype=float)
        s_arr = np.asarray(series, dtype=float)
        if s_arr.size < 8:
            continue
        i = int(np.argmax(s_arr))
        peaks.append((z, float(t_arr[i])))
    if len(peaks) < 3:
        return None
    span = max(p[1] for p in peaks) - min(p[1] for p in peaks)
    if span < min_span_ms:
        return None
    return [z for z, _ in sorted(peaks, key=lambda p: p[1])]


def infer_effect_label(
    *,
    layout: str,
    zrel: ZoneRelationship,
    zone_wave: dict,
    zone_blend: dict,
    series_by_zone: dict,
) -> tuple:
    """Map multi-zone evidence onto the living effect vocabulary.

    Chase is spatial (LEDs follow in order). Each LED of a chase is a square
    cut — the same shape as Strobe — so a per-zone square must not win when
    peaks walk around the corners.

    Returns (label, notes, chase_direction).
    """
    notes: list[str] = []
    corners = [z for z in ("topLeft", "bottomLeft", "bottomRight", "topRight") if z in zone_wave]
    energetic = [z for z, w in zone_wave.items() if w != "flat"]
    energetic_corners = [z for z in corners if z in energetic]
    direction = zrel.outer_chase_direction

    blends = [lab for lab in zone_blend.values() if lab in {"Cross-saw", "Cross-fade"}]
    if blends and len(blends) >= max(1, (len(zone_blend) + 1) // 2):
        maj = max(set(blends), key=blends.count)
        return maj, notes, direction

    order_names = energetic_corners if len(energetic_corners) >= 3 else energetic
    peak_order = staggered_zone_order(series_by_zone, order_names)
    if not direction and peak_order and len(peak_order) >= 3:
        direction = "→".join(peak_order)
        notes.append(f"chase order from peak times: {direction}")

    center_w = zone_wave.get("center")
    if direction and len(energetic_corners) >= 4:
        if center_w in {"sawtooth", "sine", "triangle"}:
            notes.append("Circle: outer chase + inner continuous waveform")
            return "Circle", notes, direction
        return "Chase", notes, direction
    if direction and 2 <= len(energetic_corners) <= 3:
        notes.append("Cycle: chase-like but not all outer regions energetic")
        return "Cycle", notes, direction

    if zrel.zone_relationship == "antiphase":
        return "Shimmer", notes, direction
    if layout == "inner-outer" and zrel.zone_relationship == "async":
        notes.append("inner/outer async — Cycle (not a 5-region Chase)")
        return "Cycle", notes, direction

    waves = [zone_wave[z] for z in energetic] or list(zone_wave.values())
    if not waves:
        return "unclassified", notes, direction
    maj_w = max(set(waves), key=waves.count)
    duties = [
        duty_cycle(series_by_zone[z][1])
        for z in energetic
        if z in series_by_zone
    ]
    mean_duty = float(np.mean(duties)) if duties else 0.5
    sync = zrel.zone_relationship in {"synchronized", "single_zone"} or layout == "single"

    if maj_w == "square":
        if mean_duty >= 0.72:
            return "Flicker", notes, direction
        if sync:
            if layout == "single":
                notes.append(
                    "single-zone square: Strobe and Chase look the same on one LED — "
                    "capture five-corner to separate"
                )
            else:
                notes.append("synchronized square cuts — Strobe (peaks did not walk)")
            return "Strobe", notes, direction
        notes.append("async square zones without a stable chase order")
        return "unclassified", notes, direction
    if maj_w == "sawtooth":
        return "Pulse", notes, direction
    if maj_w in {"sine", "triangle"}:
        return "Glow", notes, direction
    return "unclassified", notes, direction


def _infer_label(
    *,
    is_blend: bool,
    blend_style: str | None,
    wave: str,
    is_antiphase: bool,
) -> str:
    """Per-ROI guess. Trial-level label comes from infer_effect_label()."""
    if is_blend and blend_style in {"Cross-saw", "Cross-fade"}:
        return blend_style
    if is_antiphase:
        return "Shimmer"
    if is_blend:
        return "unclassified"
    if wave == "flat":
        return "unclassified"
    # Square on one LED is Strobe *or* Chase passing through — do not call it
    # Chase (that used to map sawtooth→Chase, which is Pulse / Cross-saw).
    if wave == "square":
        return "Strobe"
    if wave == "sawtooth":
        return "Pulse"
    if wave in {"sine", "triangle"}:
        return "Glow"
    return "unclassified"


def labels_agree(inferred: str | None, labeled: str | None) -> bool:
    if not inferred or not labeled:
        return False
    return inferred.strip().lower() == labeled.strip().lower()


@dataclass
class ZoneRelationship:
    zone_relationship: str
    outer_chase_direction: str | None = None
    lag_ms: float | None = None
    correlation: float | None = None
    phase_deg: float | None = None


def analyze_zone_relationship(
    series_by_zone: dict[str, tuple[np.ndarray, np.ndarray]],
    layout: str,
) -> ZoneRelationship:
    """Cross-zone phase: center vs outer-mean (five-corner) or center vs outer.

    series_by_zone maps zone name → (t_ms, brightness).
    """
    if layout == "single" or len(series_by_zone) < 2:
        return ZoneRelationship("single_zone")

    outer_ids = ["topLeft", "bottomLeft", "bottomRight", "topRight"]
    if layout == "inner-outer":
        if "center" not in series_by_zone or "outer" not in series_by_zone:
            return ZoneRelationship("independent")
        t, a = series_by_zone["center"]
        _, b = series_by_zone["outer"]
        n = min(len(a), len(b))
        a, b = np.asarray(a[:n], float), np.asarray(b[:n], float)
        t_u, a_u, dt = resample_series(t[:n], a)
        _, b_u, _ = resample_series(t[:n], b)
        n = min(len(a_u), len(b_u))
        lag, corr = _xcorr_lag_ms(a_u[:n], b_u[:n], dt)
        return _classify_rel(lag, corr, None, dt, a_u[:n])

    if "center" not in series_by_zone:
        return ZoneRelationship("independent")
    t, center = series_by_zone["center"]
    outer_series = [series_by_zone[z][1] for z in outer_ids if z in series_by_zone]
    if not outer_series:
        return ZoneRelationship("independent")
    n = min(len(center), *(len(s) for s in outer_series))
    outer_mean = np.mean(np.stack([np.asarray(s[:n], float) for s in outer_series], axis=0), axis=0)
    t_u, c_u, dt = resample_series(t[:n], np.asarray(center[:n], float))
    _, o_u, _ = resample_series(t[:n], outer_mean)
    n2 = min(len(c_u), len(o_u))
    lag, corr = _xcorr_lag_ms(c_u[:n2], o_u[:n2], dt)
    direction = _outer_chase_direction(series_by_zone, dt)
    return _classify_rel(lag, corr, direction, dt, c_u[:n2])


def _classify_rel(lag_ms, corr, direction, dt, series) -> ZoneRelationship:
    freq = None
    from .waveform import estimate_freq_hz

    t = np.arange(len(series)) * (dt if dt else 1.0)
    freq = estimate_freq_hz(t, series)
    phase = None
    if freq and freq > 0:
        phase = _wrap_deg(360.0 * lag_ms / (1000.0 / freq))
    if corr <= -0.5:
        rel = "antiphase"
    elif corr >= 0.7 and (phase is None or abs(phase) < IN_PHASE_DEG):
        rel = "synchronized"
    elif corr >= 0.4:
        rel = "async"
    else:
        rel = "independent"
    return ZoneRelationship(
        zone_relationship=rel,
        outer_chase_direction=direction,
        lag_ms=lag_ms,
        correlation=corr,
        phase_deg=phase,
    )


def _outer_chase_direction(series_by_zone, dt) -> str | None:
    order = ["topLeft", "bottomLeft", "bottomRight", "topRight"]
    present = [z for z in order if z in series_by_zone]
    if len(present) < 3:
        return None
    # Lag of each corner vs the first; sort by lag to get a lead order.
    t0, s0 = series_by_zone[present[0]]
    lags = {present[0]: 0.0}
    for z in present[1:]:
        t, s = series_by_zone[z]
        n = min(len(s0), len(s))
        _, a, dt2 = resample_series(t0[:n], np.asarray(s0[:n], float))
        _, b, _ = resample_series(t[:n], np.asarray(s[:n], float))
        n2 = min(len(a), len(b))
        lag, corr = _xcorr_lag_ms(a[:n2], b[:n2], dt2 or dt)
        if corr < 0.35:
            return None
        lags[z] = lag
    ranked = sorted(present, key=lambda z: lags[z])
    # Require strictly increasing lags (a chase, not a tie).
    vals = [lags[z] for z in ranked]
    if any(b - a < 5 for a, b in zip(vals, vals[1:])):
        return None
    return "→".join(ranked)
