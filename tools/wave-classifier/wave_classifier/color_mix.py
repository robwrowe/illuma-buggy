"""Project webcam RGB onto expected Tail Builder / packet colors.

Channel-vs-channel blend (R antiphase G) misses two similar palette hues and
cannot tell 100/0 · 75/25 · 50/50 steps from a chase that never hits either
endpoint. Expected colors are a prior (how many mix vertices, what to call
them), not a claim that the webcam matches the palette hex.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .palette import palette_entry

# Mix t=0 is 100% first expected color, t=1 is 100% second.
MIX_BINS = (0.0, 0.25, 0.5, 0.75, 1.0)
MIX_LABELS = ("100/0", "75/25", "50/50", "25/75", "0/100")
BIN_HALF = 0.12
BLACK_REL = 0.12


@dataclass
class ColorMixResult:
    n_expected: int
    expected_label: str
    mix_kind: str
    mix_steps: str
    goes_black: bool
    hits_endpoints: bool
    occupied_bins: list[str] = field(default_factory=list)
    dwell_frac: list[float] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def summary(self) -> str:
        bits = []
        if self.mix_steps:
            bits.append(self.mix_steps)
        if self.mix_kind and self.mix_kind not in {"unknown", "solid"}:
            bits.append(self.mix_kind.replace("_", " "))
        if self.goes_black:
            bits.append("goes black")
        return " · ".join(bits) if bits else "—"


def parse_expected_colors(raw) -> list[dict]:
    out = []
    for c in raw or []:
        if not isinstance(c, dict):
            continue
        if c.get("palette_idx") is not None and c.get("r") is None:
            ent = palette_entry(int(c["palette_idx"]))
            ent = {**ent, **{k: c[k] for k in ("name",) if c.get(k)}}
            out.append(ent)
            continue
        r = int(c.get("r", 0)) & 0xFF
        g = int(c.get("g", 0)) & 0xFF
        b = int(c.get("b", 0)) & 0xFF
        name = str(c.get("name") or "")
        if not name and c.get("palette_idx") is not None:
            name = palette_entry(int(c["palette_idx"]))["name"]
        out.append({
            "r": r, "g": g, "b": b,
            "name": name or f"#{r:02X}{g:02X}{b:02X}",
            "palette_idx": c.get("palette_idx"),
        })
    return out


def expected_label(colors: list[dict]) -> str:
    parts = []
    for c in colors:
        n = (c.get("name") or "").strip()
        idx = c.get("palette_idx")
        if not n:
            n = f"#{c['r']:02X}{c['g']:02X}{c['b']:02X}"
        elif idx is not None:
            n = f"{n}[{idx}]"
        parts.append(n)
    return "+".join(parts)


def _rgb_stack(r, g, b) -> np.ndarray:
    return np.stack(
        [np.asarray(r, float), np.asarray(g, float), np.asarray(b, float)],
        axis=1,
    )


def analyze_color_mix(r, g, b, expected_colors: list[dict] | None) -> ColorMixResult:
    colors = parse_expected_colors(expected_colors)
    rgb = _rgb_stack(r, g, b)
    if rgb.shape[0] < 8:
        return ColorMixResult(len(colors), expected_label(colors), "unknown", "", False, False)
    bri = rgb.mean(axis=1)
    p95 = float(np.percentile(bri, 95)) + 1e-6
    p5 = float(np.percentile(bri, 5))
    goes_black = p5 < BLACK_REL * p95
    n = len(colors)
    label = expected_label(colors)

    if n <= 1:
        kind = "solid" if not goes_black else "solid_or_fade"
        steps = "off" if goes_black and p95 < 8 else ("100%" if n == 1 else "")
        return ColorMixResult(n, label, kind, steps, goes_black, False)

    lit = bri >= max(8.0, BLACK_REL * p95)
    if int(np.count_nonzero(lit)) < 8:
        return ColorMixResult(n, label, "off", "off", True, False, notes=["too dark to mix"])

    if n == 2:
        return _two_color_mix(rgb, bri, lit, colors, goes_black, p95)
    return _multi_color_mix(rgb, bri, lit, colors, goes_black)


def _two_color_mix(rgb, bri, lit, colors, goes_black, p95) -> ColorMixResult:
    a = np.array([colors[0]["r"], colors[0]["g"], colors[0]["b"]], dtype=float)
    bcol = np.array([colors[1]["r"], colors[1]["g"], colors[1]["b"]], dtype=float)
    sep = float(np.linalg.norm(a - bcol))
    notes = []
    if sep < 18:
        notes.append("expected colors too similar for a stable mix axis")
        return ColorMixResult(
            2, expected_label(colors), "similar_expected", "", goes_black, False, notes=notes,
        )
    samples = rgb[lit]
    d_a = np.linalg.norm(samples - a, axis=1)
    d_b = np.linalg.norm(samples - bcol, axis=1)
    t = d_a / (d_a + d_b + 1e-9)
    dwell = []
    occupied = []
    for center, name in zip(MIX_BINS, MIX_LABELS):
        if center == 0.0:
            mask = t <= (0.0 + BIN_HALF)
        elif center == 1.0:
            mask = t >= (1.0 - BIN_HALF)
        else:
            mask = np.abs(t - center) <= BIN_HALF
        frac = float(np.mean(mask)) if t.size else 0.0
        dwell.append(round(frac, 3))
        if frac >= 0.08:
            occupied.append(name)
    hits_lo = "100/0" in occupied
    hits_hi = "0/100" in occupied
    hits_endpoints = hits_lo and hits_hi
    interior = [x for x in occupied if x not in {"100/0", "0/100"}]
    if not occupied:
        kind = "continuous"
        steps = "unsnapped"
    elif hits_endpoints and len(occupied) >= 3:
        kind = "discrete_endpoints"
        steps = " · ".join(occupied)
    elif hits_endpoints:
        kind = "discrete_endpoints"
        steps = " · ".join(occupied)
    elif interior and not hits_lo and not hits_hi:
        kind = "discrete_interior"
        steps = " · ".join(occupied)
        notes.append("never 100% either expected color (interior mix / chase blend)")
    elif len(occupied) == 1:
        kind = "solid"
        steps = occupied[0]
    else:
        kind = "discrete_partial"
        steps = " · ".join(occupied)
    return ColorMixResult(
        n_expected=2,
        expected_label=expected_label(colors),
        mix_kind=kind,
        mix_steps=steps,
        goes_black=goes_black,
        hits_endpoints=hits_endpoints,
        occupied_bins=occupied,
        dwell_frac=dwell,
        notes=notes,
    )


def _multi_color_mix(rgb, bri, lit, colors, goes_black) -> ColorMixResult:
    samples = rgb[lit]
    cents = np.array([[c["r"], c["g"], c["b"]] for c in colors], dtype=float)
    d = np.linalg.norm(samples[:, None, :] - cents[None, :, :], axis=2)
    nearest = np.argmin(d, axis=1)
    occupied_idx = []
    dwell = []
    for i in range(len(colors)):
        frac = float(np.mean(nearest == i))
        dwell.append(round(frac, 3))
        if frac >= 0.08:
            occupied_idx.append(i)
    names = []
    for i in occupied_idx:
        names.append(colors[i].get("name") or f"c{i}")
    # Edge vs vertex: if many samples are far from every centroid, they sit on mixes.
    min_d = d.min(axis=1)
    med_sep = float(np.median(np.linalg.norm(cents[:, None, :] - cents[None, :, :], axis=2)))
    on_edge = float(np.mean(min_d > 0.28 * (med_sep + 1e-6)))
    if on_edge >= 0.35:
        kind = "multi_blend"
        notes = ["samples sit between expected colors, not on vertices"]
    else:
        kind = "multi_vertex"
        notes = []
    steps = " · ".join(names) if names else ""
    return ColorMixResult(
        n_expected=len(colors),
        expected_label=expected_label(colors),
        mix_kind=kind,
        mix_steps=steps,
        goes_black=goes_black,
        hits_endpoints=len(occupied_idx) >= 2,
        occupied_bins=names,
        dwell_frac=dwell,
        notes=notes,
    )
