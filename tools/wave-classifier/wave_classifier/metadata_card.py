"""Per-trial metadata card: one view of pattern, zone model, cycle time, sync.

No new waveform math — aggregates TrialReport / WaveformResult / notes match.
Does not write into docs/ble-packets-details/.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .groundtruth import match_trial_notes
from .waveform import CycleSummary, summarize_cycle_time
from .zones import FIVE_CORNER_IDS

EFFECT_FAMILY_TERMS = (
    "chase",
    "shimmer",
    "flicker",
    "pulse",
    "heartbeat",
    "strobe",
    "glow",
    "circle",
    "cycle",
    "unique",
    "twinkle",
    "cross-saw",
    "cross-fade",
    "crossfade",
    "cross fade",
    "cross saw",
)

SYNC_MAP = {
    "synchronized": "sync",
    "async": "async",
    "independent": "independent",
    "single_zone": "n/a (single zone)",
    "antiphase": "async",
}

# notes term → expected fade_curve / color_transition / sync_status
FADE_FROM_NOTES = {
    "sawtooth": "sawtooth",
    "cross-saw": "sawtooth",
    "cross saw": "sawtooth",
}
SMOOTH_FADE_NOTES = {"crossfade", "cross-fade", "cross fade", "blend"}
COLOR_FROM_NOTES = {
    "cross-saw": "cross-saw",
    "cross saw": "cross-saw",
    "cross-fade": "cross-fade",
    "crossfade": "cross-fade",
    "cross fade": "cross-fade",
    "blend": "cross-fade",
    "hard cut": "cuts",
    "hard-cut": "cuts",
}
SYNC_FROM_NOTES = {"sync": "sync", "async": "async"}


@dataclass
class TrialMetadataCard:
    row_id: str
    hex_full: str
    source_sheet: str
    effect_pattern: str | None
    effect_pattern_source: str
    zone_model: str
    zone_model_assumed: bool
    zone_model_downgraded: bool
    color_transition: str | None
    cycle_time_ms: float | None
    cycle_count_observed: float | None
    sync_status: str
    fade_curve: str | None
    fade_curve_source_channel: str | None
    notes_matched_terms: list[str]
    notes_vs_measured_agreement: str
    confidence: float
    warnings: list[str] = field(default_factory=list)
    cycle_source_zone: str = ""
    cycle_source_channel: str = ""


def waveforms_from_report(report) -> dict:
    out: dict = {}
    for zone, zr in (getattr(report, "zone_results", None) or {}).items():
        for ch, wr in (zr.waveforms or {}).items():
            out[(zone, ch)] = wr
    return out


def _effect_pattern(report, matched: list[str], review_threshold: float) -> tuple:
    inferred = report.inferred_label
    labeled = report.trial.effect_label
    status = report.status
    conf = report.confidence
    if inferred and (
        status == "agree"
        or (status == "unlabeled" and conf >= review_threshold)
    ):
        return inferred, "inferred"
    if labeled:
        return labeled, "xlsx_label"
    for term in matched:
        if term in EFFECT_FAMILY_TERMS:
            pretty = {
                "crossfade": "Cross-fade",
                "cross fade": "Cross-fade",
                "cross-fade": "Cross-fade",
                "cross saw": "Cross-saw",
                "cross-saw": "Cross-saw",
            }.get(term, term[:1].upper() + term[1:])
            return pretty, "notes_match"
    return None, "unknown"


def _color_transition(report) -> str | None:
    style = (report.blend_style or "").strip()
    if style == "Cross-saw":
        return "cross-saw"
    if style == "Cross-fade":
        return "cross-fade"
    if report.is_blend:
        return style.lower() if style else "blend"
    n = report.trial.color_count
    if n is None:
        return None
    if n <= 1:
        return "n/a (single color)"
    if n == 2:
        return "cuts"
    return "n/a (single color)" if n < 2 else "cuts"


def _fade_curve(report, waveforms: dict) -> tuple:
    bri = report.waveform_class_brightness
    if bri and bri not in {"flat", "irregular"}:
        return bri, "brightness"
    primary = report.primary_zone or "all"
    if primary == "outer":
        zones = [z for z in FIVE_CORNER_IDS[:-1] if (z, "r") in waveforms]
    else:
        zones = [primary] if any((primary, ch) in waveforms for ch in ("r", "g", "b", "brightness")) else []
        if not zones:
            zones = sorted({z for z, _ch in waveforms})
    best = None
    for z in zones:
        for ch in ("r", "g", "b"):
            wr = waveforms.get((z, ch))
            if wr is None or wr.waveform_class in {"flat", "irregular", None}:
                continue
            if best is None or wr.confidence > best[2]:
                best = (wr.waveform_class, ch, wr.confidence)
    if best:
        return best[0], best[1]
    if bri:
        return bri, "brightness"
    return None, None


def _notes_agreement(
    matched: list[str],
    *,
    fade_curve: str | None,
    sync_status: str,
    color_transition: str | None,
    capture_ok: bool,
) -> str:
    if not matched:
        return "no_notes"
    comparable = False
    disagreed = False
    measured_missing = False
    for term in matched:
        if term in FADE_FROM_NOTES:
            comparable = True
            expect = FADE_FROM_NOTES[term]
            if not fade_curve:
                measured_missing = True
            elif fade_curve != expect:
                disagreed = True
        if term in SMOOTH_FADE_NOTES:
            comparable = True
            if not fade_curve and not color_transition:
                measured_missing = True
            elif fade_curve == "sawtooth" or color_transition == "cross-saw":
                disagreed = True
            elif fade_curve not in {None, "sine", "triangle"} and color_transition not in {
                None,
                "cross-fade",
            }:
                if color_transition == "cuts":
                    disagreed = True
        if term in COLOR_FROM_NOTES:
            comparable = True
            expect = COLOR_FROM_NOTES[term]
            if not color_transition:
                measured_missing = True
            elif color_transition != expect:
                disagreed = True
        if term in SYNC_FROM_NOTES:
            comparable = True
            expect = SYNC_FROM_NOTES[term]
            if sync_status.startswith("n/a"):
                measured_missing = True
            elif sync_status != expect:
                disagreed = True
    if not capture_ok and comparable:
        return "no_measurement"
    if measured_missing and not disagreed:
        return "no_measurement"
    if not comparable:
        return "agree"
    return "disagree" if disagreed else "agree"


def build_metadata_card(
    report,
    waveform_results: dict | None = None,
    cycle_summary: CycleSummary | None = None,
    matched_notes_terms: list | None = None,
    *,
    review_threshold: float = 0.6,
) -> TrialMetadataCard:
    trial = report.trial
    waves = waveform_results if waveform_results is not None else waveforms_from_report(report)
    prefer_outer = report.zone_layout == "five-corner" and bool(report.outer_chase_direction)
    cycle = cycle_summary or summarize_cycle_time(
        waves,
        report.primary_zone or "all",
        prefer_outer=prefer_outer,
    )
    matched = list(
        matched_notes_terms if matched_notes_terms is not None else match_trial_notes(trial)
    )
    pattern, pattern_src = _effect_pattern(report, matched, review_threshold)
    color_t = _color_transition(report)
    sync = SYNC_MAP.get(report.zone_relationship, report.zone_relationship or "n/a (single zone)")
    fade, fade_ch = _fade_curve(report, waves)
    capture_ok = report.capture_status == "ok" and report.status != "capture_failed"
    agreement = _notes_agreement(
        matched,
        fade_curve=fade,
        sync_status=sync,
        color_transition=color_t,
        capture_ok=capture_ok,
    )
    warnings = list(report.notes or [])
    if report.zone_layout_assumed:
        warnings.append("zone_layout_assumed: treated as single (no 5-Zones?/Layout hint)")
    if report.zone_layout_downgraded:
        warnings.append("zone_layout_downgraded: captured as inner-outer")
    label_l = (trial.effect_label or "").lower()
    strobeish = "strobe" in matched or "strobe" in label_l
    if strobeish and sync == "async":
        warnings.append(
            "Strobe labeled/noted but zones are async — known strobe failure mode"
        )
    return TrialMetadataCard(
        row_id=trial.row_id,
        hex_full=trial.hex_full,
        source_sheet=trial.sheet,
        effect_pattern=pattern,
        effect_pattern_source=pattern_src,
        zone_model=report.zone_layout,
        zone_model_assumed=report.zone_layout_assumed,
        zone_model_downgraded=report.zone_layout_downgraded,
        color_transition=color_t,
        cycle_time_ms=cycle.period_ms,
        cycle_count_observed=cycle.cycle_count_observed,
        sync_status=sync,
        fade_curve=fade,
        fade_curve_source_channel=fade_ch,
        notes_matched_terms=matched,
        notes_vs_measured_agreement=agreement,
        confidence=report.confidence,
        warnings=warnings,
        cycle_source_zone=cycle.source_zone,
        cycle_source_channel=cycle.source_channel,
    )


def attach_metadata_card(report, *, review_threshold: float = 0.6):
    """Fill report.card from in-memory zone waveforms. No CSV re-read."""
    report.card = build_metadata_card(report, review_threshold=review_threshold)
    return report.card


def card_csv_fields(card: TrialMetadataCard | None) -> dict:
    if card is None:
        return {
            "effect_pattern": "",
            "effect_pattern_source": "",
            "zone_model": "",
            "color_transition": "",
            "cycle_time_ms": "",
            "sync_status": "",
            "fade_curve": "",
            "notes_matched_terms": "",
            "notes_vs_measured_agreement": "",
        }
    return {
        "effect_pattern": card.effect_pattern or "",
        "effect_pattern_source": card.effect_pattern_source,
        "zone_model": card.zone_model,
        "color_transition": card.color_transition or "",
        "cycle_time_ms": "" if card.cycle_time_ms is None else f"{card.cycle_time_ms:.1f}",
        "sync_status": card.sync_status,
        "fade_curve": card.fade_curve or "",
        "notes_matched_terms": ";".join(card.notes_matched_terms),
        "notes_vs_measured_agreement": card.notes_vs_measured_agreement,
    }


def write_metadata_cards_markdown(path: Path, cards: list, *, generated_at: str) -> None:
    """Every trial, grouped by source sheet — a reference, not a triage queue."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Trial metadata cards — {generated_at}",
        "",
        "Webcam-inferred summary of fields already computed by waveform/blend/triage.",
        "**Triage aid, not a finding.** Does not write into `docs/ble-packets-details/`.",
        "",
        f"{len(cards)} trial(s).",
        "",
    ]
    by_sheet: dict[str, list] = {}
    for c in cards:
        by_sheet.setdefault(c.source_sheet or "(no sheet)", []).append(c)
    for sheet in sorted(by_sheet):
        lines += [f"## {sheet}", ""]
        for c in by_sheet[sheet]:
            hex_full = c.hex_full or ""
            lines += [
                f"### {c.row_id} — {hex_full}",
                "",
                "| Field | Value | Source |",
                "|---|---|---|",
            ]
            src_effect = c.effect_pattern_source
            if src_effect == "inferred":
                src_effect = "inferred"
            elif src_effect == "xlsx_label":
                src_effect = "xlsx_label"
            cycle_src = "—"
            if c.cycle_time_ms is not None:
                cycle_src = f"{c.cycle_source_zone or '—'}, {c.cycle_source_channel or '—'}"
            cycle_val = "—"
            if c.cycle_time_ms is not None:
                cycles = ""
                if c.cycle_count_observed is not None:
                    cycles = f" ({c.cycle_count_observed:.1f} cycles observed)"
                cycle_val = f"{c.cycle_time_ms:.0f} ms{cycles}"
            fade_src = "—"
            if c.fade_curve:
                fade_src = f"{c.fade_curve_source_channel or '—'} channel, confidence {c.confidence:.2f}"
            zone_src = "xlsx `5-Zones?` column" if not c.zone_model_assumed else "assumed (no hint)"
            if c.zone_model_downgraded:
                zone_src += "; downgraded to inner-outer"
            lines += [
                f"| Effect pattern | {c.effect_pattern or '—'} | {src_effect} |",
                f"| Zone model | {c.zone_model} | {zone_src} |",
                f"| Color transition | {c.color_transition or '—'} | measured |",
                f"| Cycle time | {cycle_val} | {cycle_src} |",
                f"| Sync status | {c.sync_status} | measured (zone_relationship) |",
                f"| Fade curve | {c.fade_curve or '—'} | {fade_src} |",
                f"| Notes match | {c.notes_matched_terms or '[]'} | trial description |",
                f"| Notes vs. measured | {c.notes_vs_measured_agreement} | — |",
                "",
            ]
            if c.warnings:
                lines += ["Warnings:", ""]
                for w in c.warnings:
                    lines.append(f"- {w}")
                lines.append("")
            else:
                lines += ["_No warnings._", ""]
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
