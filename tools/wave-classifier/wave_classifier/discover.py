"""Open-ended bit-position discovery pass over captured trials.

Surfaces *candidates* for human review. Does not confirm findings, does not
write into docs/ble-packets-details/. Language in the report is hedged
(candidate / worth testing / separates cleanly in this sample).
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .triage import TrialReport

# Starting bit-groups: whole byte, nibbles, plus TIMING_BYTE_BIT_PRESET
# (web/src/lib/ble/byteAnalyzer.ts) and the unfiled b7:3 note.
BIT_GROUPS = [
    ("byte", 0, 8),
    ("hi_nibble", 4, 4),
    ("lo_nibble", 0, 4),
    ("bits_3_0", 0, 4),
    ("bits_5_4", 4, 2),
    ("bits_6_4", 4, 3),
    ("bits_7_3", 3, 5),
    ("bit_6", 6, 1),
    ("bit_7", 7, 1),
]

CONFIRMED_FIELDS = [
    {
        "name": "style-flags Pulse/Heartbeat bit 6 (after 5B F0)",
        "finding": "F-2026-08-17-01",
        "groups": {("bit_6",)},
        "tail_index_hint": None,
    },
    {
        "name": "E9-0B trailing timing bits[6:4] speed/step-rate",
        "finding": "F-2026-08-26-01",
        "groups": {("bits_6_4",)},
        "tail_index_hint": "last",
    },
    {
        "name": "length byte (sub / len role)",
        "finding": "length-byte.md",
        "groups": set(),
        "role": "len",
    },
    {
        "name": "vibration high nibble 0xB",
        "finding": "vibration-byte.md",
        "groups": {("hi_nibble",)},
        "role": "vib",
    },
]


def _bit_value(byte: int, start: int, width: int) -> int:
    return (int(byte) >> start) & ((1 << width) - 1)


def _parse_tail_int(hex_str: str) -> int | None:
    s = str(hex_str).strip().replace("0x", "").replace("0X", "")
    try:
        return int(s, 16) & 0xFF
    except ValueError:
        return None


@dataclass
class Candidate:
    tail_index: int
    group_name: str
    bit_start: int
    bit_width: int
    outcome: str
    score: float
    groups: dict[int, dict[str, Any]]
    n_trials: int
    confirmed_match: str | None
    unfiled_overlap: str | None


def _purity(labels: list[str]) -> tuple[str | None, float]:
    if not labels:
        return None, 0.0
    counts: dict[str, int] = {}
    for lab in labels:
        counts[lab] = counts.get(lab, 0) + 1
    mode = max(counts, key=counts.get)
    return mode, counts[mode] / len(labels)


def _cv(values: list[float]) -> float | None:
    vals = [v for v in values if v is not None and math.isfinite(v)]
    if len(vals) < 2:
        return None
    mean = sum(vals) / len(vals)
    if abs(mean) < 1e-9:
        return None
    var = sum((v - mean) ** 2 for v in vals) / len(vals)
    return math.sqrt(var) / abs(mean)


def discover_candidates(
    reports: list[TrialReport],
    *,
    min_group: int = 3,
    unfiled_hypotheses: list[dict[str, str]] | None = None,
) -> list[Candidate]:
    usable = [r for r in reports if r.capture_status == "ok" and r.status != "capture_failed"]
    by_index: dict[int, list[tuple[TrialReport, int]]] = defaultdict(list)
    for r in usable:
        for idx, hx in r.trial.tail_bytes:
            val = _parse_tail_int(hx)
            if val is None:
                continue
            by_index[idx].append((r, val))

    unfiled = unfiled_hypotheses or []
    out: list[Candidate] = []
    for tail_index, rows in by_index.items():
        if len(rows) < min_group * 2:
            continue
        for gname, start, width in BIT_GROUPS:
            buckets: dict[int, list[TrialReport]] = defaultdict(list)
            for r, byte in rows:
                buckets[_bit_value(byte, start, width)].append(r)
            sized = {k: v for k, v in buckets.items() if len(v) >= min_group}
            if len(sized) < 2:
                continue
            # Categorical: inferred_label / waveform / zone_relationship
            for outcome, getter in (
                ("inferred_label", lambda r: r.inferred_label or "unclassified"),
                ("waveform_brightness", lambda r: r.waveform_class_brightness or "irregular"),
                ("zone_relationship", lambda r: getattr(r, "zone_relationship", None) or "single_zone"),
            ):
                modes = []
                purities = []
                group_tbl: dict[int, dict[str, Any]] = {}
                for val, grp in sorted(sized.items()):
                    labels = [getter(x) for x in grp]
                    mode, pur = _purity(labels)
                    modes.append(mode)
                    purities.append(pur)
                    group_tbl[val] = {
                        "n": len(grp),
                        "mode": mode,
                        "purity": pur,
                        "samples": [x.trial.row_id for x in grp[:8]],
                    }
                n_distinct = len({m for m in modes if m})
                if n_distinct < 2:
                    continue
                score = (sum(purities) / len(purities)) * n_distinct
                if sum(purities) / len(purities) < 0.65:
                    continue
                out.append(
                    _finish_candidate(
                        tail_index, gname, start, width, outcome, score, group_tbl,
                        n_trials=sum(g["n"] for g in group_tbl.values()),
                        unfiled=unfiled,
                    )
                )
            # Continuous: estimated frequency
            freq_tbl: dict[int, dict[str, Any]] = {}
            cvs = []
            means = []
            for val, grp in sorted(sized.items()):
                freqs = [x.freq_hz for x in grp if x.freq_hz]
                cv = _cv(freqs)
                mean = (sum(freqs) / len(freqs)) if freqs else None
                freq_tbl[val] = {"n": len(grp), "mean_hz": mean, "cv": cv}
                if cv is not None:
                    cvs.append(cv)
                if mean is not None:
                    means.append(mean)
            if len(means) >= 2 and cvs and (max(means) - min(means)) > 0.15 * (sum(means) / len(means)):
                within = sum(cvs) / len(cvs)
                sep = (max(means) - min(means)) / (abs(sum(means) / len(means)) + 1e-9)
                score = sep / (within + 0.05)
                if score > 1.5:
                    out.append(
                        _finish_candidate(
                            tail_index, gname, start, width, "estimated_frequency_hz", score, freq_tbl,
                            n_trials=sum(g["n"] for g in freq_tbl.values()),
                            unfiled=unfiled,
                        )
                    )
    out.sort(key=lambda c: c.score, reverse=True)
    return out[:40]


def _finish_candidate(
    tail_index, gname, start, width, outcome, score, group_tbl, n_trials, unfiled
) -> Candidate:
    confirmed = None
    for field in CONFIRMED_FIELDS:
        if gname in {g[0] if isinstance(g, tuple) else g for g in field.get("groups", set())}:
            if field.get("tail_index_hint") == "last" and gname == "bits_6_4":
                confirmed = f"matches existing confirmed field: {field['name']} ({field['finding']})"
            elif field.get("tail_index_hint") != "last":
                confirmed = f"matches existing confirmed field: {field['name']} ({field['finding']})"
    overlap = None
    for hyp in unfiled:
        if gname == "bits_7_3" and "b7:3" in (hyp.get("position") or ""):
            overlap = f"overlaps unfiled hypothesis: {hyp.get('hypothesis')}"
        if f"byte {tail_index}" in (hyp.get("position") or "") or f"byte {tail_index + 1}" in (hyp.get("hypothesis") or "").lower():
            overlap = f"overlaps unfiled hypothesis: {hyp.get('hypothesis')}"
    return Candidate(
        tail_index=tail_index,
        group_name=gname,
        bit_start=start,
        bit_width=width,
        outcome=outcome,
        score=float(score),
        groups=group_tbl,
        n_trials=n_trials,
        confirmed_match=confirmed,
        unfiled_overlap=overlap,
    )


def write_discovered_patterns(path: Path, candidates: list[Candidate], generated_at: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Discovered pattern candidates — {generated_at}",
        "",
        "These are **candidates worth testing**, not findings. Separation is computed",
        "from this capture sample (field-sample evidence), not a controlled",
        "single-variable sweep. Do not file them under `docs/ble-packets-details/findings/`",
        "without a human filling Status/Confidence and running the suggested test.",
        "",
        f"Surfaced {len(candidates)} candidates (ranked by between/within separation).",
        "",
    ]
    if not candidates:
        lines.append("No bit-group cleared the minimum group size and separation thresholds.")
    for i, c in enumerate(candidates, start=1):
        bits = f"[{c.bit_start + c.bit_width - 1}:{c.bit_start}]" if c.bit_width > 1 else f"[{c.bit_start}]"
        lines += [
            f"## C-{i:02d}: T{c.tail_index:02d} {c.group_name} {bits} vs {c.outcome}",
            "",
            f"**Position (xlsx tail index):** T{c.tail_index:02d} — "
            f"{c.bit_width}-bit field {bits}. Anchor-relative: the Tnn column is the "
            f"animation-engine tail as labeled in the xlsx, not a fixed opcode offset.",
            "",
            f"**Outcome variable this sample separates:** `{c.outcome}`",
            "",
            f"**Separation strength (triage ranking, not a p-value):** {c.score:.2f} "
            f"across {c.n_trials} trials.",
            "",
            "| Group value | n | Observed |",
            "|---|---|---|",
        ]
        for val, info in c.groups.items():
            if "mode" in info:
                obs = f"mode={info['mode']} purity={info['purity']:.2f}"
            else:
                mean = info.get("mean_hz")
                cv = info.get("cv")
                obs = f"mean_hz={mean:.3f} cv={cv:.2f}" if mean is not None and cv is not None else str(info)
            lines.append(f"| `0x{val:02X}` ({val}) | {info['n']} | {obs} |")
        lines += [
            "",
            "**Suggested Test:** Hold every other byte constant. Sweep only "
            f"T{c.tail_index:02d} {bits} across the group values in the table above, "
            "one step at a time, via `python -m wave_classifier build --tail ... --show` "
            "(or WandSimulator POST /show). A monotonic change in "
            f"`{c.outcome}` would raise this from a candidate to a controlled-test finding.",
            "",
        ]
        if c.confirmed_match:
            lines += [f"**Existing field:** {c.confirmed_match} — expected, not novel.", ""]
        if c.unfiled_overlap:
            lines += [f"**Unfiled note overlap:** {c.unfiled_overlap}", ""]
    path.write_text("\n".join(lines), encoding="utf-8")
