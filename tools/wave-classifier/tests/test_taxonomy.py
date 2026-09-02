#!/usr/bin/env python3
"""Addendum 7: clustering taxonomy — labels are naming hints, not features."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from wave_classifier.metadata_card import TrialMetadataCard
from wave_classifier.taxonomy import (
    FeatureVector,
    build_feature_vectors,
    suggest_cluster_name,
)
from wave_classifier.xlsx_loader import trial_from_dict


def _card(**kw):
    return TrialMetadataCard(
        row_id=kw.get("row_id", "r1"),
        hex_full=kw.get("hex", "8301"),
        source_sheet="efx",
        effect_pattern=kw.get("pattern"),
        effect_pattern_source="inferred",
        zone_model=kw.get("zone", "five-corner"),
        zone_model_assumed=False,
        zone_model_downgraded=False,
        color_transition=kw.get("color", "cuts"),
        cycle_time_ms=kw.get("cycle", 400.0),
        cycle_count_observed=2.0,
        sync_status=kw.get("sync", "async"),
        fade_curve=kw.get("fade", "sawtooth"),
        fade_curve_source_channel="brightness",
        notes_matched_terms=kw.get("notes", []),
        notes_vs_measured_agreement="no_notes",
        confidence=0.8,
    )


def _report(card, label="Chase", status="ok"):
    trial = trial_from_dict(
        {
            "sheet": "efx_chase",
            "row_id": card.row_id,
            "hex_full": "8301E100E9DEAD",
            "effect_label": label,
            "color_count": 2,
        },
        source_kind="op_codes_captured",
    )
    trial.color_count = 2
    return SimpleNamespace(
        trial=trial,
        card=card,
        status="unlabeled" if status == "ok" else status,
        capture_status=status if status != "unlabeled" else "ok",
        inferred_label=label,
        outer_chase_direction="topLeft→bottomLeft",
    )


def test_excludes_missing_cycle():
    ok = _card(row_id="ok", cycle=500.0)
    bad = _card(row_id="flat", cycle=None, fade="flat")
    usable, excluded = build_feature_vectors(
        [_report(ok, "Chase"), _report(bad, "Solid")]
    )
    # capture_status ok + cycle present vs cycle None
    r_bad = _report(bad, "Solid")
    r_bad.card.cycle_time_ms = None
    usable, excluded = build_feature_vectors([_report(ok, "Chase"), r_bad])
    assert len(usable) == 1
    assert usable[0].row_id == "ok"
    assert len(excluded) == 1
    assert "insufficient" in excluded[0][1]


def test_excludes_capture_failed():
    c = _card(cycle=400.0)
    r = _report(c, "Chase", status="capture_failed")
    r.status = "capture_failed"
    r.capture_status = "camera_error"
    usable, excluded = build_feature_vectors([r])
    assert usable == []
    assert excluded


def test_high_purity_uses_existing_label():
    vecs = [
        FeatureVector(
            zone_model="five-corner",
            color_transition="cuts",
            sync_status="async",
            fade_curve="square",
            chase_direction="n/a",
            cycle_time_ms=400.0,
            cycle_count_observed=2.0,
            color_count=2,
            fade_curve_confidence=0.8,
            row_id=f"c{i}",
            hex_full="8301",
            effect_label="Chase",
            inferred_label="Chase",
            notes_matched_terms=["chase"],
        )
        for i in range(8)
    ]
    sug = suggest_cluster_name(vecs, min_label_purity=0.6)
    assert sug.candidate_name == "Chase"
    assert sug.needs_human_review is False
    assert sug.label_purity == 1.0
    assert "5zone" in sug.feature_based_slug or "async" in sug.feature_based_slug


def test_mixed_labels_need_review():
    vecs = []
    for i, lab in enumerate(["Flicker"] * 3 + ["Chase"] * 4 + ["Unique"]):
        vecs.append(
            FeatureVector(
                zone_model="five-corner",
                color_transition="cuts",
                sync_status="async",
                fade_curve="sawtooth",
                chase_direction="n/a",
                cycle_time_ms=340.0,
                cycle_count_observed=2.0,
                color_count=2,
                fade_curve_confidence=0.7,
                row_id=f"m{i}",
                hex_full="8301",
                effect_label=lab,
                inferred_label=lab,
                notes_matched_terms=["ping-pong"],
            )
        )
    sug = suggest_cluster_name(vecs, min_label_purity=0.6)
    assert sug.needs_human_review is True
    assert sug.existing_label_hint in {"Chase", "Flicker"}
    assert sug.feature_based_slug
    assert sug.candidate_name != ""  # slug or ping-pong, not a high-purity Chase


def test_cli_taxonomy_flag():
    from wave_classifier.cli import build_parser

    p = build_parser()
    ns = p.parse_args(["taxonomy", "--method", "both", "--k-range", "4", "12"])
    assert ns.method == "both"
    assert ns.k_range == [4, 12]
    ns2 = p.parse_args(["check-camera-lock"])
    assert ns2.cmd == "check-camera-lock"


def test_agglomerative_separates_two_blobs():
    try:
        import sklearn  # noqa: F401
    except ImportError:
        print("skip test_agglomerative_separates_two_blobs (no sklearn)")
        return
    from wave_classifier.taxonomy import cluster_trials

    def blob(fade, period, n, label):
        return [
            FeatureVector(
                zone_model="five-corner",
                color_transition="cuts",
                sync_status="sync" if fade == "sine" else "async",
                fade_curve=fade,
                chase_direction="n/a",
                cycle_time_ms=period,
                cycle_count_observed=3.0,
                color_count=2,
                fade_curve_confidence=0.9,
                row_id=f"{label}{i}",
                hex_full="8301",
                effect_label=label,
                inferred_label=label,
                notes_matched_terms=[],
            )
            for i in range(n)
        ]

    vecs = blob("sine", 2000.0, 8, "Glow") + blob("square", 300.0, 8, "Strobe")
    result = cluster_trials(vecs, method="agglomerative", k_range=(2, 6))
    assert result.k is not None
    assert result.silhouette is not None
    # Two compact groups should not all share one cluster
    assert len([c for c in result.cluster_members if c >= 0]) >= 2


def test_write_report_includes_excluded():
    from wave_classifier.taxonomy import ClusterResult, write_taxonomy_markdown

    vecs = [
        FeatureVector(
            zone_model="five-corner",
            color_transition="cuts",
            sync_status="async",
            fade_curve="sawtooth",
            chase_direction="n/a",
            cycle_time_ms=340.0,
            cycle_count_observed=2.0,
            color_count=2,
            fade_curve_confidence=0.7,
            row_id="a",
            hex_full="8301DEADBEEF",
            effect_label="Flicker",
            inferred_label="Flicker",
            notes_matched_terms=[],
        )
    ]
    sug = suggest_cluster_name(vecs)
    result = ClusterResult(
        method="agglomerative",
        labels=[0],
        silhouette=0.4,
        k=1,
        cluster_members={0: [0], -1: []},
        weak_structure=False,
        note="test",
    )
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "taxonomy.md"
        write_taxonomy_markdown(
            path,
            result=result,
            vectors=vecs,
            names={0: sug},
            excluded=[(SimpleNamespace(trial=SimpleNamespace(row_id="flat:1")), "insufficient data (flat — no cycle)")],
            generated_at="test",
        )
        text = path.read_text()
        assert "Flicker" in text or sug.feature_based_slug in text
        assert "flat:1" in text
        assert "Excluded from clustering" in text


def main() -> None:
    tests = [
        test_excludes_missing_cycle,
        test_excludes_capture_failed,
        test_high_purity_uses_existing_label,
        test_mixed_labels_need_review,
        test_cli_taxonomy_flag,
        test_agglomerative_separates_two_blobs,
        test_write_report_includes_excluded,
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
