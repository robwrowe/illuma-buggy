#!/usr/bin/env python3
"""Addendum 8: uvc-util set-and-verify parsing (no camera required)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wave_classifier.capture_macos_uvc import (
    snap_to_step,
    _values_match,
    lock_camera_for_capture,
    uvc_util_available,
)


def test_snap_to_step_1_60():
    info = {"minimum": 3, "maximum": 2047, "step-size": 1}
    assert snap_to_step(166.7, info) == 167
    info2 = {"minimum": 0, "maximum": 1000, "step-size": 10}
    assert snap_to_step(167, info2) == 170


def test_values_match_within_step():
    assert _values_match(167, "167")
    assert _values_match(170, "160", step=10)
    assert not _values_match(167, "200")


def test_skip_gain_when_uncalibrated(monkeypatch=None):
    # lock_camera_for_capture without uvc-util still returns a skipped/mismatch result
    if uvc_util_available():
        print("skip live uvc-util test in unit suite")
        return
    results = lock_camera_for_capture(0, gain_for_iso_400=None)
    assert results
    assert results[0].skipped or not results[0].matched
    assert "uvc-util" in (results[0].warning or "").lower() or results[0].control_name == "(uvc-util)"


def test_describe_parse():
    info = {"minimum": 0, "maximum": 255, "step-size": 1}
    assert snap_to_step(0, info) == 0


def main() -> None:
    tests = [
        test_snap_to_step_1_60,
        test_values_match_within_step,
        test_skip_gain_when_uncalibrated,
        test_describe_parse,
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
