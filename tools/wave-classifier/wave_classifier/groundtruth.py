"""Ingest a second labeled sheet and free-text field notes.

Does not replace xlsx_loader — merged with it before capture.

Payload-only hex (E9-leading, no 8301) is converted to hex_full via
xlsx_loader.ensure_hex_full (8301E100 + payload) so capture can POST /show.
/send is not used: it blocks for the advertisement hold, so a webcam grab
started after the HTTP response would miss the effect.
"""

from __future__ import annotations

import csv
import re
from collections import Counter
from pathlib import Path

from .xlsx_loader import (
    SOURCE_KEYED_NOTES,
    SOURCE_SECOND_LABELED,
    TrialRow,
    TrialSet,
    _cell_str,
    _norm_header,
    _retag,
    decode_hex_structure,
    ensure_hex_full,
    tail_bytes_from_decoded,
    trial_from_dict,
)

VOCAB_TERMS = (
    "sawtooth",
    "crossfade",
    "cross-fade",
    "cross fade",
    "cross-saw",
    "cross saw",
    "shimmer",
    "chase",
    "pulse",
    "heartbeat",
    "twinkle",
    "flicker",
    "strobe",
    "glow",
    "ping-pong",
    "pingpong",
    "blend",
    "inner",
    "outer",
    "downward",
    "upward",
    "sync",
    "async",
    "solid",
    "twinkle",
)

BYTE_N_RE = re.compile(r"\bbyte\s*(\d+)\b", re.I)
BIT_RANGE_RE = re.compile(r"\bb(\d+)\s*:\s*(\d+)\b", re.I)
N_ZONE_RE = re.compile(r"\b(\d+)\s*[- ]?zones?\b", re.I)

# Known overlap: F-2026-08-26-01 is bits[6:4] of the trailing timing byte.
# Notes saying b7:3 is a different range — keep them separate.
OVERLAP_NOTE = (
    "Possible overlap with F-2026-08-26-01 (bits[6:4] of the E9-0B trailing "
    "timing byte = 3-bit speed). This note's b7:3 is a different bit range — "
    "do not merge without a controlled test."
)


def load_groundtruth_tsv(path: str | Path) -> TrialSet:
    """3-column TSV/CSV: Effective Code, Effect, Description (payload-only hex)."""
    p = Path(path)
    raw = p.read_text(encoding="utf-8-sig")
    dialect = csv.Sniffer().sniff(raw.splitlines()[0] if raw else "a\tb", delimiters="\t,;")
    reader = csv.reader(raw.splitlines(), dialect)
    rows = list(reader)
    if not rows:
        return _retag([])
    header = [_norm_header(c) for c in rows[0]]
    start = 1
    col = {"hex": 0, "effect": 1, "description": 2}
    if "effectivecode" in header or "hex" in header or "effect" in header:
        for i, n in enumerate(header):
            if n in {"effectivecode", "hex", "payload"}:
                col["hex"] = i
            elif n in {"effect", "effectlabel"}:
                col["effect"] = i
            elif n in {"description", "desc", "notes"}:
                col["description"] = i
    else:
        start = 0
    trials: list[TrialRow] = []
    for i, row in enumerate(rows[start:], start=start + 1):
        if not row:
            continue
        hex_raw = _cell_str(row[col["hex"]]) if col["hex"] < len(row) else None
        if not hex_raw:
            continue
        effect = _cell_str(row[col["effect"]]) if col["effect"] < len(row) else None
        desc = _cell_str(row[col["description"]]) if col["description"] < len(row) else None
        full, env_assumed = ensure_hex_full(hex_raw)
        decoded = decode_hex_structure(full)
        notes = []
        if env_assumed:
            notes.append("envelope_assumed: prepended 8301E100 (payload-only hex)")
        if decoded.length_mismatch:
            notes.append(
                f"length mismatch: length_byte+2={decoded.derived_payload_length} "
                f"but Disney payload is {decoded.actual_payload_length} bytes"
            )
        tail = tail_bytes_from_decoded(decoded, None)
        trials.append(
            TrialRow(
                sheet=p.stem,
                row_id=f"{p.stem}:{i}",
                row_index=i,
                op_code=None,
                length_byte=decoded.length_byte,
                derived_payload_length=decoded.derived_payload_length,
                color_count=None,
                color_format_1=None,
                color_format_2=None,
                effect_label=effect,
                description=desc,
                hex_full=full,
                hex_key=full,
                location=None,
                show=None,
                date=None,
                tail_start_index=None,
                tail_bytes=tail,
                vibration_byte=None if decoded.vibration_byte is None else f"{decoded.vibration_byte:02X}",
                notes=notes,
                decoded=decoded,
                source_sheet_kind=SOURCE_SECOND_LABELED,
                envelope_assumed=env_assumed,
            )
        )
    return _retag(trials)


def load_keyed_notes_tsv(path: str | Path) -> TrialSet:
    """Preferred notes path: TSV with hex (or row_id) plus a notes column."""
    p = Path(path)
    raw = p.read_text(encoding="utf-8-sig")
    dialect = csv.Sniffer().sniff(raw.splitlines()[0] if raw else "a\tb", delimiters="\t,;")
    reader = csv.reader(raw.splitlines(), dialect)
    rows = list(reader)
    if not rows:
        return _retag([])
    header = [_norm_header(c) for c in rows[0]]
    col_hex = next((i for i, n in enumerate(header) if n in {"hex", "effectivecode", "hexfull", "payload"}), None)
    col_notes = next((i for i, n in enumerate(header) if n in {"notes", "description", "note", "observation"}), None)
    col_effect = next((i for i, n in enumerate(header) if n in {"effect", "effectlabel"}), None)
    if col_hex is None or col_notes is None:
        raise ValueError(
            f"{p} does not look keyed (need hex + notes columns). "
            "For an unkeyed one-note-per-line file use --notes-file instead."
        )
    trials: list[TrialRow] = []
    for i, row in enumerate(rows[1:], start=2):
        if col_hex >= len(row):
            continue
        hex_raw = _cell_str(row[col_hex])
        if not hex_raw:
            continue
        note = _cell_str(row[col_notes]) if col_notes < len(row) else None
        effect = _cell_str(row[col_effect]) if col_effect is not None and col_effect < len(row) else None
        rec = {
            "sheet": p.stem,
            "row_id": f"{p.stem}:{i}",
            "row_index": i,
            "hex_full": hex_raw,
            "effect_label": effect,
            "description": note,
            "notes": [note] if note else [],
            "source_sheet_kind": SOURCE_KEYED_NOTES,
        }
        trials.append(trial_from_dict(rec, source_kind=SOURCE_KEYED_NOTES))
    return _retag(trials)


def extract_vocabulary(notes: list[str]) -> list[tuple[str, int]]:
    blob = "\n".join(notes).lower()
    counts: Counter[str] = Counter()
    for term in VOCAB_TERMS:
        n = blob.count(term)
        if n:
            counts[term] = n
    for m in N_ZONE_RE.finditer(blob):
        counts[f"{m.group(1)}-zone"] += 1
    return counts.most_common()


def extract_byte_hypotheses(notes: list[str]) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    seen: set[str] = set()
    for note in notes:
        text = note.strip()
        if not text:
            continue
        byte_m = BYTE_N_RE.search(text)
        bit_m = BIT_RANGE_RE.search(text)
        if not byte_m and not bit_m:
            continue
        key = re.sub(r"\s+", " ", text.lower())
        if key in seen:
            # still count a second occurrence in the entry
            for item in found:
                if item["key"] == key:
                    item["count"] = str(int(item["count"]) + 1)
            continue
        seen.add(key)
        pos = ""
        if byte_m:
            pos = f"byte {byte_m.group(1)}"
        if bit_m:
            hi, lo = bit_m.group(1), bit_m.group(2)
            pos = (pos + "; " if pos else "") + f"b{hi}:{lo}"
        overlap = ""
        if bit_m and {bit_m.group(1), bit_m.group(2)} & {"7", "6", "4", "3"}:
            overlap = OVERLAP_NOTE
        found.append({
            "key": key,
            "hypothesis": text,
            "position": pos,
            "count": "1",
            "overlap": overlap,
        })
    return found


def load_unkeyed_notes(path: str | Path) -> list[str]:
    text = Path(path).read_text(encoding="utf-8-sig")
    return [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]


def write_vocabulary_csv(path: Path, counts: list[tuple[str, int]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["term", "count"])
        for term, n in counts:
            w.writerow([term, n])


def write_unfiled_hypotheses(path: Path, items: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Unfiled byte-position hypotheses (extracted from field notes)",
        "",
        "Status: **Unconfirmed** — extracted from field notes, not yet a filed finding.",
        "Do not copy these into `docs/ble-packets-details/findings/` without a human filling",
        "`Status` / `Confidence` per `_template.md`. This is field-sample evidence only.",
        "",
    ]
    if not items:
        lines.append("No byte/bit-position notes matched the extractor regex.")
    for i, item in enumerate(items, start=1):
        lines += [
            f"## U-{i:02d}: {item['position']}",
            "",
            f"**Hypothesis:** {item['hypothesis']}",
            "",
            f"**Byte/bit position (as stated):** {item['position']}",
            "",
            f"**Occurrences in notes file:** {item['count']}",
            "",
            "**Status:** Unconfirmed — extracted from field notes, not yet a filed finding.",
            "",
            "**Test:** Not yet run. Field-sample-only.",
            "",
        ]
        if item.get("overlap"):
            lines += [f"**Possible overlap:** {item['overlap']}", ""]
    path.write_text("\n".join(lines), encoding="utf-8")
