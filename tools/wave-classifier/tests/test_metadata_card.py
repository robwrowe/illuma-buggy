#!/usr/bin/env python3
"""Addendum 6: metadata card aggregation — no new waveform math."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wave_classifier.groundtruth import match_trial_notes
from wave_classifier.metadata_card import attach_metadata_card, build_metadata_card
from wave_classifier.triage import TrialReport
from wave_classifier.waveform import CycleSummary, WaveformResult, summarize_cycle_time
from wave_classifier.xlsx_loader import ZoneLayoutHint, trial_from_dict


def _wr(cls="square", period=400.0, conf=0.8, cycles=2.0, irregular=False):
    return WaveformResult(
        waveform_class="irregular" if irregular else cls,
        confidence=conf,
        freq_hz=1000.0 / period if period else None,
        amplitude=100.0,
        estimated_period_ms=period,
        estimated_frequency_hz=1000.0 / period if period else None,
        estimated_amplitude=100.0,
        cycle_count_observed=cycles,
    )


def _trial(**kw):
    rec = {
        "sheet": kw.get("sheet", "efx_cross"),
        "row_id": kw.get("row_id", "efx_cross:14"),
        "hex_full": kw.get("hex_full", "8301E100E91100440F475558F44882D1460607D06536B0"),
        "effect_label": kw.get("effect_label", "Cross-saw"),
        "description": kw.get("description", "5-zones, async, sawtooth"),
        "source_sheet_kind": "op_codes_captured",
        "color_count": kw.get("color_count", 2),
    }
    t = trial_from_dict(rec, source_kind="op_codes_captured")
    t.description = kw.get("description", rec["description"])
    t.color_count = kw.get("color_count", 2)
    t.effect_label = kw.get("effect_label", "Cross-saw")
    t.zone_layout_hint = kw.get("hint") or ZoneLayoutHint(five_zones="Y", sync="N")
    t.notes = kw.get("notes", [])
    return t


def _report(trial, **kw):
    return TrialReport(
        trial=trial,
        inferred_label=kw.get("inferred_label", "Cross-saw"),
        waveform_class_r=kw.get("r", "sawtooth"),
        waveform_class_g=kw.get("g", "sawtooth"),
        waveform_class_b=kw.get("b", "flat"),
        waveform_class_brightness=kw.get("bri", "sawtooth"),
        is_blend=kw.get("is_blend", True),
        blend_style=kw.get("blend_style", "Cross-saw"),
        confidence=kw.get("confidence", 0.81),
        status=kw.get("status", "agree"),
        capture_status=kw.get("capture_status", "ok"),
        n_repeats=1,
        re_run_recommended=False,
        notes=list(kw.get("notes", [])),
        zone_layout=kw.get("zone_layout", "five-corner"),
        zone_layout_assumed=kw.get("assumed", False),
        zone_relationship=kw.get("rel", "async"),
        outer_chase_direction=kw.get("chase", None),
        primary_zone=kw.get("primary", "center"),
        zone_results=kw.get("zone_results") or {},
    )


def test_match_trial_notes_keywords():
    t = _trial(description="downward chase w/tail, five zone, async")
    terms = match_trial_notes(t)
    assert "chase" in terms
    assert "async" in terms
    assert "sync" not in terms  # must not steal from async
    assert any(x in terms for x in ("five zone", "five-zone", "5-zone"))


def test_cycle_prefers_outer_on_chase():
    waves = {
        ("center", "brightness"): _wr("flat", period=None, conf=1.0),
        ("topLeft", "brightness"): _wr("square", period=1180.0, conf=0.7, cycles=2.4),
        ("bottomRight", "brightness"): _wr("square", period=1200.0, conf=0.9, cycles=2.3),
    }
    # center "flat" with period=None — _wr always sets period. Fix:
    waves[("center", "brightness")] = WaveformResult(
        waveform_class="flat", confidence=1.0, freq_hz=None, amplitude=2.0
    )
    s = summarize_cycle_time(waves, "center", prefer_outer=True)
    assert s.source_zone in {"topLeft", "bottomRight"}
    assert s.period_ms in {1180.0, 1200.0}
    assert s.source_zone == "bottomRight"  # higher confidence


def test_cycle_falls_back_to_r_when_brightness_irregular():
    waves = {
        ("all", "brightness"): _wr("irregular", period=None, conf=0.1),
        ("all", "r"): _wr("sine", period=500.0, conf=0.88),
        ("all", "g"): _wr("sine", period=510.0, conf=0.4),
    }
    waves[("all", "brightness")] = WaveformResult(
        waveform_class="irregular", confidence=0.1, freq_hz=None, amplitude=1.0
    )
    s = summarize_cycle_time(waves, "all", prefer_outer=False)
    assert s.source_channel == "r"
    assert s.period_ms == 500.0


def test_single_zone_sync_na():
    t = _trial(hint=ZoneLayoutHint(five_zones="N"), description="")
    r = _report(t, zone_layout="single", rel="single_zone", is_blend=False, blend_style=None, color_count=1)
    t.color_count = 1
    r.trial.color_count = 1
    r.waveform_class_brightness = "square"
    card = build_metadata_card(r)
    assert card.sync_status == "n/a (single zone)"
    assert card.color_transition == "n/a (single color)"


def test_two_color_no_blend_is_cuts():
    t = _trial(description="")
    r = _report(t, is_blend=False, blend_style=None, inferred_label="Strobe", status="unlabeled")
    r.trial.color_count = 2
    card = build_metadata_card(r)
    assert card.color_transition == "cuts"


def test_strobe_async_warning():
    t = _trial(effect_label="Strobe", description="strobe")
    r = _report(t, inferred_label="Strobe", rel="async", is_blend=False, blend_style=None)
    card = build_metadata_card(r)
    assert card.sync_status == "async"
    assert any("strobe" in w.lower() and "async" in w.lower() for w in card.warnings)


def test_notes_disagree_sawtooth_vs_smooth():
    t = _trial(description="smooth crossfade")
    r = _report(
        t,
        inferred_label="Cross-saw",
        blend_style="Cross-saw",
        is_blend=True,
        bri="sawtooth",
        status="agree",
    )
    card = build_metadata_card(r)
    assert card.notes_vs_measured_agreement == "disagree"
    attach_metadata_card(r)
    from wave_classifier.triage import _needs_review

    assert _needs_review(r, 0.6) is True


def test_cli_cards_flag():
    from wave_classifier.cli import build_parser

    p = build_parser()
    ns = p.parse_args(["report-only", "--cards"])
    assert ns.cards is True
    ns2 = p.parse_args(["report-only"])
    assert ns2.cards is False


def main() -> None:
    tests = [
        test_match_trial_notes_keywords,
        test_cycle_prefers_outer_on_chase,
        test_cycle_falls_back_to_r_when_brightness_irregular,
        test_single_zone_sync_na,
        test_two_color_no_blend_is_cuts,
        test_strobe_async_warning,
        test_notes_disagree_sawtooth_vs_smooth,
        test_cli_cards_flag,
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
