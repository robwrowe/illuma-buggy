"""MagicBand+ palette RGB — keep in sync with web/src/lib/ble/mbConstants.ts MB_PALETTE.

Guessed hex in MB_PALETTE is the color-and-mask-palette.md "best guess" column.
Measured RGB lives in gitignored calibration.toml (see load_calibration).
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path

# index → (family name, hex)
MB_PALETTE: list[tuple[str, str]] = [
    ("Green", "#e0ffe6"),
    ("Blue", "#99bdff"),
    ("Blue", "#576aff"),
    ("Blue", "#5985ff"),
    ("Blue", "#1c33ff"),
    ("Purple", "#e2a3ff"),
    ("Purple", "#d5baff"),
    ("Purple", "#d7a6ff"),
    ("Purple", "#d470ff"),
    ("Pink", "#ffa3fc"),
    ("Pink", "#ec9eff"),
    ("Pink", "#f678ff"),
    ("Pink", "#e485ff"),
    ("Pink", "#f86eff"),
    ("Red", "#ff3856"),
    ("Yellow", "#ffbb00"),
    ("Yellow", "#ffff8e"),
    ("Yellow", "#ffdd00"),
    ("Yellow", "#ccff00"),
    ("Orange", "#ff9d00"),
    ("Orange", "#ff7300"),
    ("Red", "#ff2200"),
    ("Teal", "#00ffea"),
    ("Teal", "#66ffd1"),
    ("Teal", "#8fffee"),
    ("Green", "#00ff26"),
    ("Yellow", "#afff03"),
    ("White", "#f0f0f0"),
    ("White", "#ffffff"),
    ("Black", "#000000"),
]


def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
    h = (hex_str or "").strip().lstrip("#")
    if len(h) != 6:
        return (0, 0, 0)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def palette_entry(idx: int) -> dict:
    i = int(idx) & 0x1F
    if 0 <= i < len(MB_PALETTE):
        name, hx = MB_PALETTE[i]
        r, g, b = hex_to_rgb(hx)
        return {"r": r, "g": g, "b": b, "name": name, "palette_idx": i, "hex": hx}
    if i == 30:
        return {"r": 255, "g": 153, "b": 51, "name": "Unique", "palette_idx": 30, "hex": "#ff9933"}
    if i == 31:
        return {"r": 255, "g": 0, "b": 255, "name": "Random", "palette_idx": 31, "hex": "#ff00ff"}
    return {"r": 0, "g": 0, "b": 0, "name": "?", "palette_idx": i, "hex": "#000000"}


# Indices 0–28 are real fixed colors. 29=Black (no RGB to calibrate),
# 30=Unique / 31=Random are device-randomized.
CALIBRATE_INDICES = tuple(range(29))
BLACK_PALETTE_IDX = 29

CORNER_ZONES = ("topLeft", "bottomLeft", "bottomRight", "topRight")


@dataclass
class PaletteCalibration:
    """Measured (or guessed) RGB per palette index.

    Five-corner is the stored geometry. inner-outer `outer` is the mean of the
    four corners; `single`/`all` is the mean of all five.
    """

    source: str  # "measured" | "guessed"
    by_index: dict[int, tuple[int, int, int]]
    by_zone: dict[int, dict[str, tuple[int, int, int]]] = field(default_factory=dict)
    captured_at: str | None = None
    measured_fps: float | None = None
    age_s: float | None = None
    path: Path | None = None

    def rgb(self, idx: int, zone: str | None = None) -> tuple[int, int, int]:
        i = int(idx) & 0x1F
        if zone and i in self.by_zone:
            zmap = self.by_zone[i]
            if zone in zmap:
                return zmap[zone]
            if zone in {"outer", "all"}:
                keys = CORNER_ZONES if zone == "outer" else tuple(zmap)
                pts = [zmap[k] for k in keys if k in zmap]
                if pts:
                    return _mean_rgb_int(pts)
        if i in self.by_index:
            return self.by_index[i]
        ent = palette_entry(i)
        return int(ent["r"]), int(ent["g"]), int(ent["b"])


def _mean_rgb_int(pts: list[tuple[int, int, int]]) -> tuple[int, int, int]:
    n = max(len(pts), 1)
    r = int(round(sum(p[0] for p in pts) / n))
    g = int(round(sum(p[1] for p in pts) / n))
    b = int(round(sum(p[2] for p in pts) / n))
    return (r, g, b)


def mean_rgb_brightest_frames(
    rows: list[tuple[float, float, float, float]],
    n_frames: int,
) -> tuple[int, int, int] | None:
    """Mean RGB of the *brightest* *n_frames* samples (ignores trailing dark frames)."""
    from .timeline import brightness_of

    if not rows:
        return None
    ranked = sorted(rows, key=lambda row: brightness_of(row[1], row[2], row[3]), reverse=True)
    tail = ranked[: min(len(ranked), max(1, int(n_frames)))]
    r = sum(x[1] for x in tail) / len(tail)
    g = sum(x[2] for x in tail) / len(tail)
    b = sum(x[3] for x in tail) / len(tail)
    return int(round(r)), int(round(g)), int(round(b))


def load_expected_from_export(path: Path | str) -> dict[int, tuple[int, int, int]]:
    """Load mbMapping.colors from an Illuma export JSON (32 hex entries)."""
    import json

    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    colors = (raw.get("mbMapping") or {}).get("colors")
    if not isinstance(colors, list) or len(colors) < 29:
        raise ValueError(
            f"{path}: expected mbMapping.colors with at least 29 hex strings"
        )
    out: dict[int, tuple[int, int, int]] = {}
    for i in range(29):
        hx = str(colors[i] or "").strip()
        if not hx:
            continue
        out[i] = hex_to_rgb(hx)
    if len(out) < 29:
        raise ValueError(f"{path}: mbMapping.colors missing entries for indices 0–28")
    return out


def expected_rgb(
    idx: int,
    expected_by_index: dict[int, tuple[int, int, int]] | None = None,
) -> tuple[int, int, int]:
    if expected_by_index and int(idx) in expected_by_index:
        return expected_by_index[int(idx)]
    return guessed_rgb(idx)


def guessed_calibration() -> PaletteCalibration:
    by_index = {}
    for i in CALIBRATE_INDICES:
        ent = palette_entry(i)
        by_index[i] = (int(ent["r"]), int(ent["g"]), int(ent["b"]))
    return PaletteCalibration(source="guessed", by_index=by_index)


def default_calibration_path() -> Path:
    return Path(__file__).resolve().parent.parent / "calibration.toml"


def load_calibration(path: Path | None = None) -> PaletteCalibration:
    """Load calibration.toml, or guessed MB_PALETTE if the file is missing."""
    dest = Path(path) if path is not None else default_calibration_path()
    if not dest.is_file():
        return guessed_calibration()
    from .cli import _load_toml

    data = _load_toml(dest)
    pal = data.get("palette") or {}
    by_index: dict[int, tuple[int, int, int]] = {}
    by_zone: dict[int, dict[str, tuple[int, int, int]]] = {}
    for key, block in pal.items():
        try:
            idx = int(key)
        except (TypeError, ValueError):
            continue
        if not isinstance(block, dict):
            continue
        if "r" in block:
            by_index[idx] = (int(block["r"]), int(block["g"]), int(block["b"]))
        zones = block.get("zones") or {}
        if isinstance(zones, dict) and zones:
            zmap = {}
            for zname, val in zones.items():
                if isinstance(val, (list, tuple)) and len(val) >= 3:
                    zmap[str(zname)] = (int(val[0]), int(val[1]), int(val[2]))
            if zmap:
                by_zone[idx] = zmap
                if idx not in by_index:
                    by_index[idx] = _mean_rgb_int(list(zmap.values()))
    if not by_index:
        cal = guessed_calibration()
        cal.path = dest
        return cal
    meta = data.get("meta") or {}
    age_s = None
    try:
        age_s = max(0.0, time.time() - dest.stat().st_mtime)
    except OSError:
        age_s = None
    fps = meta.get("measured_fps")
    return PaletteCalibration(
        source="measured",
        by_index=by_index,
        by_zone=by_zone,
        captured_at=str(meta.get("captured_at") or "") or None,
        measured_fps=float(fps) if fps not in (None, "") else None,
        age_s=age_s,
        path=dest,
    )


def save_calibration(cal: PaletteCalibration, path: Path | None = None) -> Path:
    dest = Path(path) if path is not None else default_calibration_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# calibration.toml — per camera / lighting / device. Do not commit.",
        "# Measured against five-corner ROIs; inner-outer and single are derived at load.",
        "",
        "[meta]",
        f'captured_at = "{cal.captured_at or ""}"',
        f"measured_fps = {cal.measured_fps if cal.measured_fps is not None else 0}",
        f'source = "{cal.source}"',
        "",
    ]
    for idx in sorted(cal.by_index):
        r, g, b = cal.by_index[idx]
        lines.append(f"[palette.{idx}]")
        lines.append(f"r = {r}")
        lines.append(f"g = {g}")
        lines.append(f"b = {b}")
        zmap = cal.by_zone.get(idx) or {}
        if zmap:
            lines.append(f"[palette.{idx}.zones]")
            for zname, rgb in zmap.items():
                lines.append(f"{zname} = [{rgb[0]}, {rgb[1]}, {rgb[2]}]")
        lines.append("")
    dest.write_text("\n".join(lines), encoding="utf-8")
    cal.path = dest
    return dest


def guessed_rgb(idx: int) -> tuple[int, int, int]:
    ent = palette_entry(idx)
    return int(ent["r"]), int(ent["g"]), int(ent["b"])


def calibration_diff_lines(
    cal: PaletteCalibration,
    expected_by_index: dict[int, tuple[int, int, int]] | None = None,
) -> list[str]:
    """Eyeball table: measured vs expected RGB (export mbMapping.colors or MB_PALETTE guess)."""
    ref_label = "expected RGB" if expected_by_index else "guessed RGB"
    lines = [
        f"idx  name     {ref_label:<19}  measured RGB         Δ (euclid)",
        "---  -------  -------------------  -------------------  ----------",
    ]
    for idx in CALIBRATE_INDICES:
        name = palette_entry(idx)["name"]
        er, eg, eb = expected_rgb(idx, expected_by_index)
        if idx in cal.by_index:
            mr, mg, mb = cal.by_index[idx]
            dist = ((mr - er) ** 2 + (mg - eg) ** 2 + (mb - eb) ** 2) ** 0.5
            meas = f"{mr:3d},{mg:3d},{mb:3d}"
            delta = f"{dist:8.1f}"
        else:
            meas = "(missing)"
            delta = "       —"
        lines.append(
            f"{idx:3d}  {name:<7}  {er:3d},{eg:3d},{eb:3d}           {meas:<19}  {delta}"
        )
    return lines
