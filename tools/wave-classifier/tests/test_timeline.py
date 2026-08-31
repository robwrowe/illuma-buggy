#!/usr/bin/env python3
"""Timeline ticks, blend projection, 3+ expected colors — no camera."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wave_classifier.palette import PaletteCalibration, palette_entry
from wave_classifier.payload_builder import build_solid_palette_payload
from wave_classifier.timeline import (
    brightness_of,
    estimate_blend,
    project_onto_segment,
    resample_to_ticks,
)
from wave_classifier.xlsx_loader import trial_from_dict


def test_resample_native_keeps_frames():
    t = np.array([0.0, 10.0, 20.0, 30.0])
    r = np.array([1.0, 2.0, 3.0, 4.0])
    g = np.zeros(4)
    b = np.zeros(4)
    rows, warns = resample_to_ticks(t, r, g, b, hz=None)
    assert len(rows) == 4
    assert rows[2][0] == 20.0
    assert rows[2][1] == 3.0
    assert not warns


def test_resample_square_and_sawtooth_grid():
    t = np.linspace(0, 1000, 101)
    square = np.where((t.astype(int) // 100) % 2 == 0, 200.0, 10.0)
    rows, _ = resample_to_ticks(t, square, square, square, hz=10.0, measured_fps=100.0)
    assert len(rows) == 11  # 0..1000 inclusive at 100ms
    assert abs(rows[0][0] - 0) < 1e-6
    assert abs(rows[1][0] - 100) < 1e-6
    saw = t / 1000.0 * 200.0
    rows2, _ = resample_to_ticks(t, saw, saw, saw, hz=10.0, measured_fps=100.0)
    assert abs(rows2[5][1] - 100.0) < 2.0


def test_resample_hz_above_fps_warns():
    t = np.linspace(0, 100, 11)
    v = np.ones(11)
    _rows, warns = resample_to_ticks(t, v, v, v, hz=60.0, measured_fps=30.0)
    assert any("interpolated" in w for w in warns)


def test_blend_endpoints_and_midpoint():
    yellow = palette_entry(15)
    blue = palette_entry(4)
    a = np.array([yellow["r"], yellow["g"], yellow["b"]], float)
    b = np.array([blue["r"], blue["g"], blue["b"]], float)
    t0, r0 = project_onto_segment(a, a, b)
    t1, r1 = project_onto_segment(b, a, b)
    mid = (a + b) / 2
    t5, r5 = project_onto_segment(mid, a, b)
    assert abs(t0 - 0.0) < 1e-9 and r0 < 1e-6
    assert abs(t1 - 1.0) < 1e-9 and r1 < 1e-6
    assert abs(t5 - 0.5) < 1e-6 and r5 < 1e-6


def test_blend_far_from_line_keeps_fraction():
    a = np.array([255.0, 0.0, 0.0])
    b = np.array([0.0, 255.0, 0.0])
    p = np.array([0.0, 0.0, 255.0])
    t, resid = project_onto_segment(p, a, b)
    assert 0.0 <= t <= 1.0
    assert resid > 40


def test_three_color_no_force_mix():
    cal = PaletteCalibration(
        source="measured",
        by_index={
            4: (28, 51, 255),
            15: (255, 187, 0),
            22: (0, 255, 234),
        },
    )
    expected = [
        {"palette_idx": 4},
        {"palette_idx": 15},
        {"palette_idx": 22},
    ]
    teal = (0.0, 255.0, 234.0)
    blend = estimate_blend(teal, expected, cal)
    assert blend is not None
    assert blend.mix_fraction is None
    assert blend.nearest_expected_idx == 2


def test_off_confirm_ceiling_caps_at_max_brightness():
    from wave_classifier.capture import off_confirm_ceiling

    assert off_confirm_ceiling(baseline_peak=16, baseline_margin=12, max_brightness=30) == 28
    assert off_confirm_ceiling(baseline_peak=218, baseline_margin=12, max_brightness=30) == 30
    assert off_confirm_ceiling(baseline_peak=None, baseline_margin=12, max_brightness=30) == 30


def test_load_expected_from_export():
    import json
    import tempfile

    from wave_classifier.palette import expected_rgb, load_expected_from_export

    colors = ["#00b4b4", "#6d84ff"] + ["#010101"] * 27
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"mbMapping": {"colors": colors}}, f)
        path = f.name
    try:
        got = load_expected_from_export(path)
        assert got[0] == (0, 180, 180)
        assert got[1] == (109, 132, 255)
        assert expected_rgb(0, got) == (0, 180, 180)
    finally:
        Path(path).unlink(missing_ok=True)


def test_solid_palette_payload_uses_e905():
    assert build_solid_palette_payload(0).hex == "E100E90500090E00B0"
    assert build_solid_palette_payload(28).hex == "E100E90500090E1CB0"


def test_solid_black_payload_is_palette_29():
    built = build_solid_palette_payload(29)
    assert built.hex == "E100E90500090E1DB0"
    assert built.hex_full == "8301E100E90500090E1DB0"


def test_brightness_is_max_channel():
    assert brightness_of(10, 200, 30) == 200.0


def test_timeline_report_two_color_table():
    from wave_classifier.timeline import build_timeline_report
    from wave_classifier.timeline_report import format_timeline_markdown

    trial = trial_from_dict({
        "hex_full": "e100e91300030f4e5958f44882d06500d14657ff307b00",
        "color_count": 2,
        "row_id": "observe:e913",
        "expected_colors": [{"palette_idx": 15}, {"palette_idx": 11}],
    })
    t = np.linspace(0, 400, 21)
    y = palette_entry(trial.expected_colors[0]["palette_idx"])
    p = palette_entry(trial.expected_colors[1]["palette_idx"])
    frac = np.clip(t / 400.0, 0, 1)
    r = y["r"] * (1 - frac) + p["r"] * frac
    g = y["g"] * (1 - frac) + p["g"] * frac
    b = y["b"] * (1 - frac) + p["b"] * frac
    series = {
        "topLeft": (t, r, g, b),
        "center": (t, r, g, b),
    }
    cal = PaletteCalibration(
        source="measured",
        by_index={
            trial.expected_colors[0]["palette_idx"]: (y["r"], y["g"], y["b"]),
            trial.expected_colors[1]["palette_idx"]: (p["r"], p["g"], p["b"]),
        },
        age_s=12.0,
    )
    report = build_timeline_report(
        trial, series, trial.expected_colors, cal, hz=None, measured_fps=50.0,
        baseline_tick_range=(0, 3),
    )
    md = format_timeline_markdown(report)
    assert "timeline" in md
    assert "calibration_source=measured" in md or "measured" in md
    assert "baseline" in md
    assert "inferred_label" not in md
    assert "waveform_class" not in md


def test_e9_timing_hold_ms():
    from wave_classifier.e9_timing import (
        compute_timing_lifecycle,
        estimate_show_hold_ms,
        timing_byte_from_hex,
    )

    life = compute_timing_lifecycle(0x04)
    assert abs(life["on_sec"] - 1.6 * 4) < 0.01
    assert estimate_show_hold_ms(0x04, margin_ms=500) >= int(1.6 * 4 * 1000) + 500
    tb = timing_byte_from_hex("8301E100E90500090E00B0")
    assert tb == 0x09


def main() -> None:
    tests = [
        test_resample_native_keeps_frames,
        test_resample_square_and_sawtooth_grid,
        test_resample_hz_above_fps_warns,
        test_blend_endpoints_and_midpoint,
        test_blend_far_from_line_keeps_fraction,
        test_three_color_no_force_mix,
        test_off_confirm_ceiling_caps_at_max_brightness,
        test_load_expected_from_export,
        test_solid_palette_payload_uses_e905,
        test_solid_black_payload_is_palette_29,
        test_brightness_is_max_channel,
        test_timeline_report_two_color_table,
        test_e9_timing_hold_ms,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"ok  {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {fn.__name__}: {exc.__class__.__name__}: {exc}")
    if failed:
        raise SystemExit(f"{failed} test(s) failed")
    print(f"{len(tests)} passed")


if __name__ == "__main__":
    main()
