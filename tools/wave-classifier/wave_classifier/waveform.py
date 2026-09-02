"""Resample a webcam channel series and classify waveform shape.

Classes: sine, sawtooth, triangle, square, flat (below noise floor), irregular
(no template clears min_template_correlation). Frequency is estimated from the
*median* frame interval, not the requested fps — webcam timing is not steady.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import signal


@dataclass
class WaveformResult:
    waveform_class: str
    confidence: float
    freq_hz: float | None
    amplitude: float
    dt_ms: float | None = None
    n_samples: int = 0
    scores: dict[str, float] | None = None
    estimated_period_ms: float | None = None
    estimated_frequency_hz: float | None = None
    estimated_amplitude: float = 0.0
    cycle_count_observed: float | None = None


def resample_series(
    t_ms: np.ndarray,
    values: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, float]:
    t = np.asarray(t_ms, dtype=float)
    v = np.asarray(values, dtype=float)
    if t.size < 2:
        return t, v, 0.0
    diffs = np.diff(t)
    diffs = diffs[diffs > 0]
    dt = float(np.median(diffs)) if diffs.size else 0.0
    if dt <= 0:
        return t, v, 0.0
    t_u = np.arange(t[0], t[-1] + dt * 0.5, dt)
    if t_u.size < 2:
        return t, v, dt
    v_u = np.interp(t_u, t, v)
    return t_u, v_u, dt


def _normalize(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=float)
    v = v - np.mean(v)
    std = float(np.std(v))
    if std < 1e-12:
        return v
    return v / std


def estimate_freq_hz(t_ms: np.ndarray, v: np.ndarray) -> float | None:
    if t_ms.size < 8:
        return None
    dt_s = float(np.median(np.diff(t_ms))) / 1000.0
    if dt_s <= 0:
        return None
    fs = 1.0 / dt_s
    n = v.size
    windowed = _normalize(v) * np.hanning(n)
    spec = np.abs(np.fft.rfft(windowed))
    freqs = np.fft.rfftfreq(n, dt_s)
    spec[0] = 0.0
    duration_s = (t_ms[-1] - t_ms[0]) / 1000.0
    min_f = 1.0 / max(duration_s, 1e-6)  # at least ~one cycle in the window
    spec[freqs < min_f * 0.5] = 0.0
    # Ignore near-Nyquist junk.
    spec[freqs > fs * 0.45] = 0.0
    peak_i = int(np.argmax(spec))
    if spec[peak_i] <= 0:
        return None
    freq = float(freqs[peak_i])
    if freq <= 0:
        return None
    return freq


def _max_pearson_over_lag(observed: np.ndarray, template: np.ndarray) -> float:
    a = _normalize(observed)
    b = _normalize(template)
    if a.size < 4 or b.size < 4:
        return 0.0
    corr = signal.correlate(a, b, mode="full")
    # For unit-variance length-N series, Pearson at lag ≈ corr / N.
    n = min(a.size, b.size)
    peak = float(np.max(corr) / n)
    return float(np.clip(peak, -1.0, 1.0))


def _templates(t_s: np.ndarray, freq_hz: float) -> dict[str, np.ndarray]:
    phase = 2.0 * np.pi * freq_hz * t_s
    return {
        "sine": np.sin(phase),
        "sawtooth": signal.sawtooth(phase),
        "triangle": signal.sawtooth(phase, width=0.5),
        "square": signal.square(phase),
    }


def classify_channel(
    t_ms: np.ndarray,
    values: np.ndarray,
    *,
    noise_floor_pct: float = 0.03,
    min_template_correlation: float = 0.6,
    full_scale: float = 255.0,
) -> WaveformResult:
    t_u, v_u, dt_ms = resample_series(t_ms, values)
    n = int(v_u.size)
    duration_ms = float(t_u[-1] - t_u[0]) if n >= 2 else 0.0
    amp0 = float(np.ptp(values)) if values.size else 0.0
    if n < 8 or dt_ms <= 0:
        return WaveformResult(
            waveform_class="irregular",
            confidence=0.0,
            freq_hz=None,
            amplitude=amp0,
            dt_ms=dt_ms or None,
            n_samples=n,
            estimated_amplitude=amp0,
        )

    # Percentile span, not raw ptp — a few noisy samples shouldn't defeat "flat".
    # Captured *before* unit-amplitude scaling so intensity is still available.
    amplitude = float(np.percentile(v_u, 95) - np.percentile(v_u, 5))
    if amplitude < noise_floor_pct * full_scale:
        return WaveformResult(
            waveform_class="flat",
            confidence=1.0,
            freq_hz=None,
            amplitude=amplitude,
            dt_ms=dt_ms,
            n_samples=n,
            estimated_amplitude=amplitude,
        )

    freq = estimate_freq_hz(t_u, v_u)
    period_ms = (1000.0 / freq) if freq and freq > 0 else None
    cycles = (duration_ms / period_ms) if period_ms and period_ms > 0 else None
    if freq is None or freq <= 0:
        return WaveformResult(
            waveform_class="irregular",
            confidence=0.0,
            freq_hz=None,
            amplitude=amplitude,
            dt_ms=dt_ms,
            n_samples=n,
            estimated_amplitude=amplitude,
        )

    t_s = (t_u - t_u[0]) / 1000.0
    scores: dict[str, float] = {}
    best_name = "irregular"
    best_score = -1.0
    for name, tmpl in _templates(t_s, freq).items():
        score = _max_pearson_over_lag(v_u, tmpl)
        scores[name] = score
        if score > best_score:
            best_score = score
            best_name = name

    if best_score < min_template_correlation:
        waveform_class = "irregular"
    else:
        waveform_class = best_name

    return WaveformResult(
        waveform_class=waveform_class,
        confidence=float(np.clip(best_score, 0.0, 1.0)),
        freq_hz=freq,
        amplitude=amplitude,
        dt_ms=dt_ms,
        n_samples=n,
        scores=scores,
        estimated_period_ms=period_ms,
        estimated_frequency_hz=freq,
        estimated_amplitude=amplitude,
        cycle_count_observed=cycles,
    )


def classify_rgb(
    t_ms: np.ndarray,
    r: np.ndarray,
    g: np.ndarray,
    b: np.ndarray,
    *,
    noise_floor_pct: float = 0.03,
    min_template_correlation: float = 0.6,
) -> dict[str, WaveformResult]:
    brightness = (np.asarray(r) + np.asarray(g) + np.asarray(b)) / 3.0
    return {
        "r": classify_channel(
            t_ms, r, noise_floor_pct=noise_floor_pct, min_template_correlation=min_template_correlation
        ),
        "g": classify_channel(
            t_ms, g, noise_floor_pct=noise_floor_pct, min_template_correlation=min_template_correlation
        ),
        "b": classify_channel(
            t_ms, b, noise_floor_pct=noise_floor_pct, min_template_correlation=min_template_correlation
        ),
        "brightness": classify_channel(
            t_ms,
            brightness,
            noise_floor_pct=noise_floor_pct,
            min_template_correlation=min_template_correlation,
        ),
    }


@dataclass
class CycleSummary:
    period_ms: float | None = None
    cycle_count_observed: float | None = None
    source_zone: str = ""
    source_channel: str = ""
    confidence: float | None = None


_OUTER_ZONES = ("topLeft", "bottomLeft", "bottomRight", "topRight", "outer")
_CHANNELS = ("brightness", "r", "g", "b")


def _period_usable(wr: WaveformResult | None) -> bool:
    return bool(
        wr is not None
        and wr.estimated_period_ms
        and wr.estimated_period_ms > 0
        and wr.waveform_class not in {"flat"}
    )


def _pick_channel_for_zone(
    results: dict,
    zone: str,
) -> tuple:
    bri = results.get((zone, "brightness"))
    if _period_usable(bri) and bri.waveform_class != "irregular":
        return "brightness", bri
    colored = []
    for ch in ("r", "g", "b"):
        wr = results.get((zone, ch))
        if _period_usable(wr) and wr.waveform_class != "irregular":
            colored.append((ch, wr))
    if colored:
        return max(colored, key=lambda pair: pair[1].confidence)
    if _period_usable(bri):
        return "brightness", bri
    for ch in ("r", "g", "b"):
        wr = results.get((zone, ch))
        if _period_usable(wr):
            return ch, wr
    return None, None


def summarize_cycle_time(
    results_by_zone_channel: dict,
    primary_zone: str,
    *,
    prefer_outer: bool = False,
) -> CycleSummary:
    """One trial-level cycle time, with the zone/channel it came from.

    Brightness first (more robust than a single hue). For a five-corner chase,
    prefer an outer-ring period over center — the chase's full cycle is the
    ring traversal, not the center LED's own blink.
    """
    zones_present = []
    seen = set()
    preferred = []
    if prefer_outer:
        preferred.extend(_OUTER_ZONES)
    if primary_zone == "outer":
        preferred.extend(_OUTER_ZONES)
    preferred.append(primary_zone)
    for z in list(preferred) + [z for z, _ch in results_by_zone_channel]:
        if z not in seen and any((z, ch) in results_by_zone_channel for ch in _CHANNELS):
            zones_present.append(z)
            seen.add(z)

    def as_summary(zone: str, ch: str, wr: WaveformResult) -> CycleSummary:
        return CycleSummary(
            period_ms=wr.estimated_period_ms,
            cycle_count_observed=wr.cycle_count_observed,
            source_zone=zone,
            source_channel=ch,
            confidence=wr.confidence,
        )

    if prefer_outer:
        outer_hits = []
        for z in _OUTER_ZONES:
            ch, wr = _pick_channel_for_zone(results_by_zone_channel, z)
            if wr is not None:
                outer_hits.append(as_summary(z, ch, wr))
        if outer_hits:
            return max(outer_hits, key=lambda s: s.confidence or 0.0)

    best = None
    for z in zones_present:
        ch, wr = _pick_channel_for_zone(results_by_zone_channel, z)
        if wr is None:
            continue
        cand = as_summary(z, ch, wr)
        if best is None or (cand.confidence or 0.0) > (best.confidence or 0.0):
            best = cand
    return best or CycleSummary(source_zone=primary_zone or "all", source_channel="brightness")

