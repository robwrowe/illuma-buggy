"""Two-channel phase / crossover detection for Cross-saw vs Cross-fade.

Does not try to be a general clustering system. Maps onto the xlsx INSTRUCTIONS
sheet vocabulary where the evidence is clean; otherwise returns "unclassified"
with the raw numbers attached.

xlsx labels used here: Cross-saw, Cross-fade, Strobe, Pulse, Chase, Shimmer.
Pulse vs Heartbeat is a style-flag bit (F-2026-08-17-01), not something a
webcam brightness trace reliably separates — those stay conservative.
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


def _infer_label(
    *,
    is_blend: bool,
    blend_style: str | None,
    wave: str,
    is_antiphase: bool,
) -> str:
    if is_blend and blend_style in {"Cross-saw", "Cross-fade"}:
        return blend_style
    if is_antiphase:
        return "Shimmer"
    if is_blend:
        return "unclassified"
    if wave == "flat":
        return "unclassified"
    # Brightness-only effects (Pulse / Heartbeat / Strobe / Chase hitting one ROI).
    # Pulse vs Heartbeat is a style-flag bit, not a webcam-shape distinction.
    if wave == "square":
        return "Strobe"
    if wave == "sawtooth":
        return "Chase"
    if wave in {"sine", "triangle"}:
        return "Pulse"
    return "unclassified"


def labels_agree(inferred: str | None, labeled: str | None) -> bool:
    if not inferred or not labeled:
        return False
    return inferred.strip().lower() == labeled.strip().lower()
