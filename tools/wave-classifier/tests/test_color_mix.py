#!/usr/bin/env python3
"""Expected-color mix: 100/0…0/100 vs interior-only chase blend."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wave_classifier.color_mix import analyze_color_mix, parse_expected_colors
from wave_classifier.palette import palette_entry
from wave_classifier.xlsx_loader import trial_from_dict


def _lerp_dwell(a, b, ts, n_each=24):
    rows = []
    for t in ts:
        rgb = a + (b - a) * t
        for _ in range(n_each):
            rows.append(rgb)
    arr = np.asarray(rows, float)
    return arr[:, 0], arr[:, 1], arr[:, 2]


def test_two_color_endpoint_bins():
    yellow = palette_entry(15)
    blue = palette_entry(4)
    a = np.array([yellow["r"], yellow["g"], yellow["b"]], float)
    b = np.array([blue["r"], blue["g"], blue["b"]], float)
    expected = [yellow, blue]
    r, g, bl = _lerp_dwell(a, b, (0.0, 0.25, 0.5, 0.75, 1.0))
    mix = analyze_color_mix(r, g, bl, expected)
    assert mix.mix_kind == "discrete_endpoints"
    assert mix.hits_endpoints is True
    assert mix.occupied_bins == ["100/0", "75/25", "50/50", "25/75", "0/100"]
    assert "100/0" in mix.mix_steps and "0/100" in mix.mix_steps


def test_interior_never_hits_endpoints():
    yellow = palette_entry(15)
    blue = palette_entry(4)
    a = np.array([yellow["r"], yellow["g"], yellow["b"]], float)
    bcol = np.array([blue["r"], blue["g"], blue["b"]], float)
    r, g, bl = _lerp_dwell(a, bcol, (0.25, 0.5, 0.75))
    mix = analyze_color_mix(r, g, bl, [yellow, blue])
    assert mix.mix_kind == "discrete_interior"
    assert mix.hits_endpoints is False
    assert "100/0" not in mix.occupied_bins
    assert "0/100" not in mix.occupied_bins
    assert any("never 100%" in n for n in mix.notes)


def test_goes_black():
    yellow = palette_entry(15)
    n = 40
    r = np.concatenate([np.full(n, yellow["r"]), np.zeros(n)])
    g = np.concatenate([np.full(n, yellow["g"]), np.zeros(n)])
    b = np.concatenate([np.full(n, yellow["b"]), np.zeros(n)])
    mix = analyze_color_mix(r, g, b, [yellow])
    assert mix.goes_black is True


def test_parse_palette_idx_only():
    got = parse_expected_colors([{"palette_idx": 15}, {"palette_idx": 4}])
    assert got[0]["name"] == "Yellow"
    assert got[1]["name"] == "Blue"
    assert got[0]["r"] == palette_entry(15)["r"]


def test_infer_0f_needs_color_count():
    hex_full = "e100e91100440f515858f44882d146050fd06500b0"
    without = trial_from_dict({"hex_full": hex_full})
    assert without.expected_colors == []
    with_n = trial_from_dict({"hex_full": hex_full, "color_count": 2})
    assert len(with_n.expected_colors) == 2
    assert with_n.expected_colors[0]["palette_idx"] == (0x51 & 0x1F)
    assert with_n.expected_colors[1]["palette_idx"] == (0x58 & 0x1F)


def test_infer_d2_rgb_from_hex():
    from wave_classifier.payload_builder import build_payload

    built = build_payload(
        tail_bytes="30 7B 00",
        timing_byte=0x64,
        color_format="d2",
        colors=[
            {"r": 255, "g": 0, "b": 0},
            {"r": 0, "g": 255, "b": 0},
        ],
    )
    row = trial_from_dict({"hex_full": built.hex_full})
    assert len(row.expected_colors) == 2
    assert row.expected_colors[0]["r"] == 255
    assert row.expected_colors[1]["g"] == 255


def test_infer_d2_55_then_d2_58():
    hex_full = "e100e90e0021d255ff0000d25800ff0078b0"
    row = trial_from_dict({"hex_full": hex_full})
    assert len(row.expected_colors) == 2
    assert row.expected_colors[0]["r"] == 255
    assert row.expected_colors[1]["g"] == 255


def test_builder_expected_colors_override_hex():
    row = trial_from_dict({
        "hex_full": "e100e91100440f515858f44882d146050fd06500b0",
        "color_count": 2,
        "expected_colors": [{"palette_idx": 22}, {"palette_idx": 15}],
    })
    assert row.expected_colors[0]["palette_idx"] == 22
    assert row.expected_colors[1]["palette_idx"] == 15


def main() -> None:
    tests = [
        test_two_color_endpoint_bins,
        test_interior_never_hits_endpoints,
        test_goes_black,
        test_parse_palette_idx_only,
        test_infer_0f_needs_color_count,
        test_infer_d2_rgb_from_hex,
        test_infer_d2_55_then_d2_58,
        test_builder_expected_colors_override_hex,
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
