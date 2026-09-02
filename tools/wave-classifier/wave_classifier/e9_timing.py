"""E9 timing-byte duration estimates — minimal mirror of web e9Decode.ts."""

from __future__ import annotations

from typing import Any

TIMING_FADE_BITS_SEC = [0.0, 0.5, 1.0, 1.5]

DEFAULT_TIMING_MODEL: dict[str, Any] = {
    "multNormal": 1.6,
    "multScaler": 3.0,
    "multExtended": 7.6,
    "t0FallbackSec": 3.0,
    "fadeBitsStretchSec": [0.0, 0.5, 1.0, 0.0],
    "fadeBitsStretchAppliesToExtended": False,
}


def decode_timing_byte(byte: int) -> dict[str, int | bool]:
    b = int(byte) & 0xFF
    return {
        "raw": b,
        "t": b & 0x0F,
        "fade_bits": (b >> 4) & 0x03,
        "scaler": bool(b & 0x40),
        "extended": bool(b & 0x80),
    }


def _model_value(model: dict[str, Any] | None, key: str, default: float) -> float:
    if model and key in model and model[key] is not None:
        try:
            return float(model[key])
        except (TypeError, ValueError):
            pass
    return default


def compute_timing_lifecycle(
    timing_byte: int,
    *,
    model: dict[str, Any] | None = None,
) -> dict[str, float]:
    """On-time in seconds for one timing byte (includes fadeBits stretch when configured)."""
    decoded = decode_timing_byte(timing_byte)
    t = int(decoded["t"])
    fade_bits = int(decoded["fade_bits"])
    scaler = bool(decoded["scaler"])
    extended = bool(decoded["extended"])

    mult_normal = _model_value(model, "multNormal", DEFAULT_TIMING_MODEL["multNormal"])
    mult_scaler = _model_value(model, "multScaler", DEFAULT_TIMING_MODEL["multScaler"])
    mult_extended = _model_value(model, "multExtended", DEFAULT_TIMING_MODEL["multExtended"])
    t0_fallback = _model_value(model, "t0FallbackSec", DEFAULT_TIMING_MODEL["t0FallbackSec"])

    stretch_arr = model.get("fadeBitsStretchSec") if model else None
    if not isinstance(stretch_arr, list) or len(stretch_arr) < 4:
        stretch_arr = DEFAULT_TIMING_MODEL["fadeBitsStretchSec"]
    stretch_applies = bool(
        model.get("fadeBitsStretchAppliesToExtended")
        if model
        else DEFAULT_TIMING_MODEL["fadeBitsStretchAppliesToExtended"]
    )
    raw_stretch = float(stretch_arr[fade_bits]) if fade_bits < len(stretch_arr) else 0.0
    stretch_sec = 0.0 if (extended and not stretch_applies) else max(0.0, raw_stretch)

    if extended:
        on_sec = t0_fallback if t == 0 else mult_extended * t
    elif scaler:
        on_sec = t0_fallback if t == 0 else mult_scaler * t
    else:
        on_sec = t0_fallback if t == 0 else mult_normal * t
    on_sec += stretch_sec

    fade_arr = model.get("fadeBitsStretchSec") if model else None
    if isinstance(fade_arr, list) and len(fade_arr) >= 4 and any(float(x) > 0 for x in fade_arr):
        fade_sec = float(fade_arr[fade_bits]) if fade_bits < len(fade_arr) else 0.0
    else:
        fade_sec = TIMING_FADE_BITS_SEC[fade_bits] if fade_bits < len(TIMING_FADE_BITS_SEC) else 0.0

    return {"on_sec": on_sec, "fade_sec": fade_sec, "stretch_sec": stretch_sec}


def timing_byte_from_hex(hex_full: str) -> int | None:
    from .xlsx_loader import decode_hex_structure

    decoded = decode_hex_structure(hex_full)
    for part in decoded.parts:
        if part.get("role") == "timing":
            return int(part["byte"]) & 0xFF
    return None


def estimate_show_hold_ms(
    timing_byte: int,
    *,
    model: dict[str, Any] | None = None,
    margin_ms: int = 500,
) -> int:
    """Suggested WandSim /show hold from timing byte (on + fade + margin)."""
    life = compute_timing_lifecycle(timing_byte, model=model)
    total_ms = int((life["on_sec"] + life["fade_sec"]) * 1000.0)
    return total_ms + max(0, int(margin_ms))
