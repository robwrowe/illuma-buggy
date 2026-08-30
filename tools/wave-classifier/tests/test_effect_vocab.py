#!/usr/bin/env python3
"""Chase is spatial; a per-LED square cut is the same shape as Strobe."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wave_classifier.blend import ZoneRelationship, infer_effect_label
from wave_classifier.triage import write_claude_markdown

CORNERS = ["topLeft", "bottomLeft", "bottomRight", "topRight"]


def _square(t, period, phase_ms, lo=10.0, hi=200.0):
    frac = np.mod(t - phase_ms, period) / period
    return np.where(frac < 0.22, hi, lo).astype(float)


def _series(phases, *, include_center_flat=True):
    t = np.arange(0, 2000, 10, dtype=float)
    series = {}
    wave = {}
    blend = {}
    for z, ph in phases.items():
        series[z] = (t, _square(t, 400.0, ph))
        wave[z] = "square"
        blend[z] = "Strobe"
    if include_center_flat and "center" not in series:
        series["center"] = (t, np.full_like(t, 12.0))
        wave["center"] = "flat"
        blend["center"] = "unclassified"
    return series, wave, blend


def test_staggered_corners_are_chase_not_strobe():
    phases = {z: i * 100.0 for i, z in enumerate(CORNERS)}
    series, wave, blend = _series(phases)
    lab, notes, direction = infer_effect_label(
        layout="five-corner",
        zrel=ZoneRelationship("async"),
        zone_wave=wave,
        zone_blend=blend,
        series_by_zone=series,
    )
    assert lab == "Chase", (lab, notes, direction)
    assert direction


def test_simultaneous_squares_are_strobe():
    phases = {z: 0.0 for z in CORNERS}
    phases["center"] = 0.0
    series, wave, blend = _series(phases, include_center_flat=False)
    lab, notes, direction = infer_effect_label(
        layout="five-corner",
        zrel=ZoneRelationship("synchronized", correlation=0.9),
        zone_wave=wave,
        zone_blend=blend,
        series_by_zone=series,
    )
    assert lab == "Strobe", (lab, notes, direction)


def test_antiphase_is_shimmer():
    t = np.arange(0, 2000, 10, dtype=float)
    a = _square(t, 400.0, 0.0)
    b = _square(t, 400.0, 200.0)
    lab, _, _ = infer_effect_label(
        layout="inner-outer",
        zrel=ZoneRelationship("antiphase", correlation=-0.8),
        zone_wave={"center": "square", "outer": "square"},
        zone_blend={"center": "Strobe", "outer": "Strobe"},
        series_by_zone={"center": (t, a), "outer": (t, b)},
    )
    assert lab == "Shimmer"


def test_two_energetic_corners_are_cycle():
    phases = {"topLeft": 0.0, "bottomRight": 180.0, "bottomLeft": 0.0}
    t = np.arange(0, 2000, 10, dtype=float)
    series = {
        "topLeft": (t, _square(t, 400.0, 0.0)),
        "bottomRight": (t, _square(t, 400.0, 180.0)),
        "bottomLeft": (t, np.full_like(t, 12.0)),
        "topRight": (t, np.full_like(t, 12.0)),
        "center": (t, np.full_like(t, 12.0)),
    }
    wave = {
        "topLeft": "square",
        "bottomRight": "square",
        "bottomLeft": "flat",
        "topRight": "flat",
        "center": "flat",
    }
    # Force a chase direction as if peak-order found two-step walk via xcorr path
    lab, notes, _ = infer_effect_label(
        layout="five-corner",
        zrel=ZoneRelationship("async", outer_chase_direction="topLeft→bottomRight"),
        zone_wave=wave,
        zone_blend={z: "Strobe" for z in wave},
        series_by_zone=series,
    )
    assert lab == "Cycle", (lab, notes)


def test_claude_markdown_includes_vocab_and_hex():
    import tempfile

    from wave_classifier.xlsx_loader import trial_from_dict
    from wave_classifier.triage import TrialReport

    trial = trial_from_dict(
        {
            "sheet": "observe",
            "row_id": "tail-1",
            "hex_full": "8301E100DEAD",
            "effect_label": "Chase",
            "source_sheet_kind": "builder",
        },
        source_kind="builder",
    )
    report = TrialReport(
        trial=trial,
        inferred_label="Chase",
        waveform_class_r="square",
        waveform_class_g="square",
        waveform_class_b="flat",
        waveform_class_brightness="square",
        is_blend=False,
        blend_style=None,
        confidence=0.8,
        status="unlabeled",
        capture_status="ok",
        n_repeats=1,
        re_run_recommended=False,
        zone_layout="five-corner",
        zone_relationship="async",
        outer_chase_direction="topLeft→bottomLeft→bottomRight→topRight",
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "observe.md"
        write_claude_markdown(path, [report], generated_at="test")
        text = path.read_text()
    assert "Lights follow in order" in text
    assert "8301E100DEAD" in text
    assert "**Chase**" in text


def main() -> None:
    tests = [
        test_staggered_corners_are_chase_not_strobe,
        test_simultaneous_squares_are_strobe,
        test_antiphase_is_shimmer,
        test_two_energetic_corners_are_cycle,
        test_claude_markdown_includes_vocab_and_hex,
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
