"""MagicBand+ palette RGB — keep in sync with web/src/lib/ble/mbConstants.ts MB_PALETTE."""

from __future__ import annotations

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
