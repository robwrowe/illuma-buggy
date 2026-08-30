#!/usr/bin/env python3
"""Addendum tests: zones, payload builder round-trip, notes extraction, CLI build."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wave_classifier.blend import analyze_zone_relationship
from wave_classifier.groundtruth import extract_byte_hypotheses, extract_vocabulary
from wave_classifier.payload_builder import build_payload, parse_tail_bytes
from wave_classifier.xlsx_loader import (
    ZoneLayoutHint,
    decode_hex_structure,
    hex_to_bytes,
    trial_from_dict,
)
from wave_classifier.zones import resolve_zone_layout, zone_names_for_layout


class Trialish:
    def __init__(self, **kw):
        self.zone_layout_hint = kw.get("hint") or ZoneLayoutHint()
        self.description = kw.get("description")
        self.sheet = kw.get("sheet", "")
        self.effect_label = kw.get("effect_label")


def test_zone_names():
    assert zone_names_for_layout("single") == ["all"]
    assert zone_names_for_layout("five-corner") == [
        "topLeft",
        "bottomLeft",
        "bottomRight",
        "topRight",
        "center",
    ]
    assert zone_names_for_layout("inner-outer") == ["center", "outer"]


def test_resolve_zone_layout():
    five = Trialish(hint=ZoneLayoutHint(five_zones="Y"))
    assert resolve_zone_layout(five).layout == "five-corner"
    assert resolve_zone_layout(five).assumed is False

    one = Trialish(hint=ZoneLayoutHint(five_zones="N"))
    assert resolve_zone_layout(one).layout == "single"

    inner = Trialish(hint=ZoneLayoutHint(layout="Inner/Outer"))
    assert resolve_zone_layout(inner).layout == "inner-outer"

    assumed = Trialish()
    zl = resolve_zone_layout(assumed)
    assert zl.layout == "single"
    assert zl.assumed is True


def test_payload_round_trip():
    built = build_payload(
        tail_bytes="30 7B 00",
        timing_byte=0x64,
        color_format="0f",
        colors=[
            {"palette_idx": 0x12, "mask": 0},
            {"palette_idx": 0x04, "mask": 0},
        ],
        vibration=5,
    )
    assert built.hex_full.startswith("8301E100E9")
    decoded = decode_hex_structure(built.hex_full)
    assert decoded.length_mismatch is False
    assert decoded.length_byte == built.length_byte
    assert decoded.vibration_byte == 0xB5
    assert decoded.vibration_nibble == 5
    assert decoded.derived_payload_length == decoded.actual_payload_length


def test_payload_no_vib_round_trip():
    built = build_payload(
        tail_bytes=[0x30, 0x7B, 0x00],
        timing_byte=100,
        color_format="0f",
        colors=[{"palette_idx": 0x12, "mask": 0}, {"palette_idx": 0x04, "mask": 0}],
    )
    decoded = decode_hex_structure(built.hex_full)
    assert decoded.length_mismatch is False
    assert decoded.vibration_byte is None


def test_payload_d2_color_block():
    built = build_payload(
        tail_bytes="AA",
        timing_byte=0x10,
        color_format="d2",
        colors=[{"r": 0xFF, "g": 0x80, "b": 0x00}],
    )
    raw = hex_to_bytes(built.hex)
    # fmt 0xD2 then 55 FF 80 00 then tail AA
    assert 0xD2 in raw
    idx = list(raw).index(0xD2)
    assert list(raw[idx : idx + 6]) == [0xD2, 0x55, 0xFF, 0x80, 0x00, 0xAA]
    assert decode_hex_structure(built.hex_full).length_mismatch is False


def test_parse_tail_spaces_and_0x():
    assert parse_tail_bytes("30 7B 00") == [0x30, 0x7B, 0x00]
    assert parse_tail_bytes("0x30 0x7B 0x00") == [0x30, 0x7B, 0x00]
    assert parse_tail_bytes("307B00") == [0x30, 0x7B, 0x00]


def test_notes_hypotheses():
    notes = [
        "byte 15 is a blend %",
        "something else entirely",
        "byte 15 is a blend %",
        "3 Zones seems to happen when b7:3 is 15.",
    ]
    hyps = extract_byte_hypotheses(notes)
    assert len(hyps) == 2
    blend = next(h for h in hyps if "byte 15" in h["position"])
    assert blend["count"] == "2"
    assert "blend" in blend["hypothesis"]
    bit = next(h for h in hyps if "b7:3" in h["position"])
    assert "15" in bit["hypothesis"]
    assert bit["overlap"]  # possible overlap with F-2026-08-26-01, kept separate
    vocab = extract_vocabulary(notes)
    terms = dict(vocab)
    assert terms.get("3-zone") == 1


def test_trial_from_built_decode():
    built = build_payload(
        tail_bytes="30 7B 00",
        timing_byte=0x64,
        color_format="0f",
        colors=[{"palette_idx": 0x12, "mask": 0}],
        vibration=5,
    )
    rec = {
        "hex_full": built.hex_full,
        "tail_bytes": [(0, "30"), (1, "7B"), (2, "00")],
        "effect_label": "Chase",
        "sheet": "builder",
    }
    row = trial_from_dict(rec)
    assert row.decoded is not None
    assert row.decoded.length_mismatch is False
    assert row.hex_key.startswith("8301")


def test_zone_relationship_single():
    import numpy as np

    t = np.linspace(0, 1000, 50)
    rel = analyze_zone_relationship({"all": (t, t)}, "single")
    assert rel.zone_relationship == "single_zone"


def test_xlsx_rebuild_if_present():
    """Strongest check: rebuild a real labeled row's hex from its decoded fields."""
    xlsx = ROOT.parent.parent / "Op_Codes_Captured.xlsx"
    if not xlsx.is_file():
        print("skip test_xlsx_rebuild_if_present (no Op_Codes_Captured.xlsx)")
        return
    from wave_classifier.xlsx_loader import load_trials

    ts = load_trials(xlsx)
    candidates = [
        t
        for t in ts.trials
        if t.tail_bytes and t.decoded and t.decoded.length_byte is not None and not t.envelope_assumed
    ]
    if not candidates:
        print("skip test_xlsx_rebuild_if_present (no suitable rows)")
        return
    trial = candidates[0]
    decoded = trial.decoded
    tb = next((p["byte"] for p in decoded.parts if p.get("id") == "tb"), None)
    fmt = next((p["byte"] for p in decoded.parts if p.get("id") == "fmt"), None)
    env = next((p["byte"] for p in decoded.parts if p.get("id") == "env"), 0xE1)
    assert tb is not None and fmt is not None
    fmt_s = f"{fmt:02x}"
    if fmt_s not in {"0f", "0e", "d2"}:
        print(f"skip rebuild: fmt=0x{fmt:02X} not a builder format")
        return
    tail = [int(str(h).replace("0x", ""), 16) & 0xFF for _, h in trial.tail_bytes]
    # Color bytes sit between fmt and tail in the payload after company ID.
    after = list(decoded.after_company_id)
    # Find fmt then skip color_count bytes (0f/0e) or 4*color_count (d2).
    try:
        fmt_at = after.index(fmt, after.index(0xE9))
    except ValueError:
        print("skip rebuild: could not locate format byte")
        return
    rest = after[fmt_at + 1 :]
    if decoded.vibration_byte is not None and rest and rest[-1] == decoded.vibration_byte:
        rest = rest[:-1]
    n_tail = len(tail)
    color_bytes = rest[: max(0, len(rest) - n_tail)]
    colors: list[dict] = []
    if fmt_s == "d2":
        i = 0
        while i + 4 <= len(color_bytes) and color_bytes[i] == 0x55:
            colors.append({"r": color_bytes[i + 1], "g": color_bytes[i + 2], "b": color_bytes[i + 3]})
            i += 4
    else:
        for b in color_bytes:
            colors.append({"palette_idx": b & 0x1F, "mask": (b >> 5) & 0x07})
    vib = decoded.vibration_nibble if decoded.vibration_byte is not None else None
    env_s = "e2" if env == 0xE2 else "e1"
    built = build_payload(
        tail_bytes=tail,
        timing_byte=tb,
        color_format=fmt_s,
        colors=colors,
        vibration=vib,
        envelope=env_s,
    )
    orig = "".join(c for c in trial.hex_full.upper() if c in "0123456789ABCDEF")
    assert built.hex_full == orig, (
        f"rebuild mismatch for {trial.row_id}:\n  orig  {orig}\n  built {built.hex_full}"
    )


def test_groundtruth_payload_only_tsv():
    from wave_classifier.groundtruth import load_groundtruth_tsv

    # Built payload without 8301: E9 + length 0x08 + 8 bytes after sub = 10-byte Disney payload.
    payload = "E90800640F1204307B00"
    with tempfile.NamedTemporaryFile("w", suffix=".tsv", delete=False) as fh:
        fh.write("Effective Code\tEffect\tDescription\n")
        fh.write(f"{payload}\tChase\tinner/outer test\n")
        path = Path(fh.name)
    try:
        ts = load_groundtruth_tsv(path)
        assert len(ts.trials) == 1
        t = ts.trials[0]
        assert t.envelope_assumed is True
        assert t.hex_key.startswith("8301E100E9")
        assert t.decoded is not None
        assert t.decoded.length_mismatch is False
        assert t.effect_label == "Chase"
        assert t.source_sheet_kind == "second_labeled_sheet"
    finally:
        path.unlink()


def test_cli_build_print():
    from wave_classifier.cli import main

    argv = [
        "build",
        "--tail",
        "30 7B 00",
        "--timing-byte",
        "0x64",
        "--color-format",
        "0f",
        "--color",
        "0x12",
        "--mask",
        "0",
        "--color",
        "0x04",
        "--mask",
        "0",
    ]
    try:
        main(argv)
    except SystemExit as exc:
        assert exc.code == 0, exc


def test_cli_help_fast():
    from wave_classifier.cli import main

    try:
        main(["--help"])
    except SystemExit as exc:
        assert exc.code == 0
    try:
        main(["build", "--help"])
    except SystemExit as exc:
        assert exc.code == 0
    try:
        main(["select-rois", "--help"])
    except SystemExit as exc:
        assert exc.code == 0


def test_nested_toml_rois():
    from wave_classifier.cli import _load_toml_minimal, rois_from_config

    text = """
[capture]
device_index = 0

[capture.rois.single]
all = [1, 2, 3, 4]

[capture.rois.five-corner]
topLeft = [10, 20, 30, 40]
center = [1, 1, 2, 2]
"""
    with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as fh:
        fh.write(text)
        path = Path(fh.name)
    try:
        cfg = _load_toml_minimal(path)
        rois = rois_from_config(cfg)
        assert rois["single"]["all"] == (1, 2, 3, 4)
        assert rois["five-corner"]["topLeft"] == (10, 20, 30, 40)
    finally:
        path.unlink()


def test_sine_classify():
    import numpy as np
    from wave_classifier.waveform import classify_channel

    t = np.linspace(0, 4000, 120)
    v = 80 + 60 * np.sin(2 * np.pi * 1.0 * t / 1000.0)
    result = classify_channel(t, v, noise_floor_pct=0.03, min_template_correlation=0.6)
    assert result.waveform_class == "sine"
    assert result.estimated_frequency_hz is not None
    assert result.estimated_period_ms is not None
    assert 800 < result.estimated_period_ms < 1250
    assert result.estimated_amplitude > 50
    assert result.cycle_count_observed is not None


def main() -> None:
    tests = [
        test_zone_names,
        test_resolve_zone_layout,
        test_payload_round_trip,
        test_payload_no_vib_round_trip,
        test_payload_d2_color_block,
        test_parse_tail_spaces_and_0x,
        test_notes_hypotheses,
        test_trial_from_built_decode,
        test_zone_relationship_single,
        test_nested_toml_rois,
        test_sine_classify,
        test_groundtruth_payload_only_tsv,
        test_xlsx_rebuild_if_present,
        test_cli_help_fast,
        test_cli_build_print,
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
