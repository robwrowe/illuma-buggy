"""Assemble a full advertisement from a tail + timing/color/vib — Python port of
web/src/lib/ble/tailBuilder.ts assembleTailPayload() / buildTailPayloadParts().

Field roles and the derived length byte must match that file exactly so a
payload built here equals one built in Wand Lab for the same inputs. The tail
is inserted verbatim (role 'tail') — this module does not interpret it.

hex (payload only) is what /send {"hex": ...} would want.
hex_full (8301 + payload) is what wandsim_client.show_single() wants.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .xlsx_loader import COMPANY_ID, hex_to_bytes, normalize_hex

COLOR_FORMATS = ("0f", "0e", "d2")


@dataclass
class BuiltPayload:
    bytes: bytes
    hex: str
    hex_full: str
    length_byte: int
    length_byte_hex: str
    parts: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


def envelope_byte(envelope: str | None) -> int:
    """Match tailBuilder.ts envelopeByte(): e1 → 0xE1, e2 → 0xE2, else 1–2 digit hex."""
    raw = str(envelope if envelope is not None else "e1").replace("0x", "").replace("0X", "").strip().lower()
    if raw == "e2":
        return 0xE2
    if raw in {"e1", ""}:
        return 0xE1
    try:
        return int(raw, 16) & 0xFF
    except ValueError:
        return 0xE1


def encode_color_byte(palette_idx: int, mask: int = 0) -> int:
    """mbPayloads.ts mbColorByte(paletteIdx, patternNibble): ((mask & 7) << 5) | (pal & 0x1F)."""
    return ((int(mask) & 0x07) << 5) | (int(palette_idx) & 0x1F)


def mb_vib_byte(vibration: int) -> int:
    return (0xB0 | (int(vibration) & 0x0F)) & 0xFF


def parse_tail_bytes(raw: str | bytes | list[int]) -> list[int]:
    """Match tailBuilder.ts parseTailLine(): spaced hex, packed hex, 0x-prefixed tokens."""
    if isinstance(raw, list):
        return [int(b) & 0xFF for b in raw]
    if isinstance(raw, (bytes, bytearray)):
        return list(raw)
    trimmed = str(raw or "").strip()
    if not trimmed:
        return []
    token_re = re.compile(r"^(?:0x)?([0-9a-fA-F]{1,2})$", re.I)

    def one_token(tok: str) -> int | None:
        m = token_re.match(tok.strip())
        return int(m.group(1), 16) if m else None

    has_delim = bool(re.search(r"[\t,;]", trimmed) or re.search(r"0x", trimmed, re.I))
    if has_delim:
        parts = re.split(r"[\t,;]+|\s+", trimmed)
        out: list[int] = []
        for p in parts:
            if not p:
                continue
            one = one_token(p)
            if one is not None:
                out.append(one)
            else:
                out.extend(list(hex_to_bytes(p)))
        return out
    space_tokens = [t for t in trimmed.split() if t]
    if len(space_tokens) > 1 and all(one_token(t) is not None for t in space_tokens):
        return [one_token(t) for t in space_tokens]  # type: ignore[misc]
    return list(hex_to_bytes(trimmed))


def _color_parts(color_format: str, colors: list[dict[str, int]]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    fmt = color_format.lower().replace("0x", "")
    if fmt == "d2":
        for i, c in enumerate(colors or []):
            parts.append({"id": f"c{i}.55", "role": "color", "colorIdx": i, "byte": 0x55})
            parts.append({"id": f"c{i}.r", "role": "color", "colorIdx": i, "byte": int(c.get("r", 0)) & 0xFF})
            parts.append({"id": f"c{i}.g", "role": "color", "colorIdx": i, "byte": int(c.get("g", 0)) & 0xFF})
            parts.append({"id": f"c{i}.b", "role": "color", "colorIdx": i, "byte": int(c.get("b", 0)) & 0xFF})
        return parts
    for i, c in enumerate(colors or []):
        parts.append({
            "id": f"c{i}",
            "role": "color",
            "colorIdx": i,
            "byte": encode_color_byte(c.get("palette_idx", 0), c.get("mask", 0)),
        })
    return parts


def build_payload(
    *,
    tail_bytes: list[int] | str,
    timing_byte: int,
    color_format: str,
    colors: list[dict[str, int]] | None = None,
    vibration: int | None = None,
    envelope: str = "e1",
) -> BuiltPayload:
    fmt = str(color_format).lower().replace("0x", "").strip()
    if fmt not in COLOR_FORMATS:
        raise ValueError(f"color_format must be 0f/0e/d2, got {color_format!r}")
    fmt_byte = int(fmt, 16) & 0xFF
    tail = parse_tail_bytes(tail_bytes)
    color_list = list(colors or [])

    parts: list[dict[str, Any]] = [
        {"id": "env", "role": "env", "byte": envelope_byte(envelope)},
        {"id": "envPad", "role": "fixed", "byte": 0x00},
        {"id": "e9", "role": "fixed", "byte": 0xE9},
        {"id": "sub", "role": "len", "byte": 0},
        {"id": "pad", "role": "fixed", "byte": 0x00},
        {"id": "tb", "role": "timing", "byte": int(timing_byte) & 0xFF},
        {"id": "fmt", "role": "format", "byte": fmt_byte},
    ]
    parts.extend(_color_parts(fmt, color_list))
    for i, b in enumerate(tail):
        parts.append({"id": f"t{i}", "role": "tail", "tailIdx": i, "byte": int(b) & 0xFF})
    if vibration is not None:
        parts.append({"id": "vib", "role": "vib", "byte": mb_vib_byte(vibration)})

    # kept = every part (this CLI does not expose partEnabled). Length is the
    # count of bytes *after* the sub/len byte — same as tailBuilder.ts:
    #   subOpcode = (kept.length - subAt - 1) & 0xff
    # which is payload_length = length_byte + 2 (E9 + sub themselves).
    kept = parts
    sub_at = next(i for i, p in enumerate(kept) if p["id"] == "sub")
    sub_opcode = (len(kept) - sub_at - 1) & 0xFF
    kept[sub_at] = {**kept[sub_at], "byte": sub_opcode}

    warnings: list[str] = []
    if sub_opcode > 0x1F:
        warnings.append(
            f"Derived length byte 0x{sub_opcode:02X} is unusually large "
            "(known captures top out around 0x14/20 bytes) — double check the tail length."
        )
    if not any(p["role"] == "color" for p in kept):
        warnings.append("No colors selected — color block is empty.")
    if not tail:
        warnings.append("Tail is empty — packet will end right after the color block.")

    raw = bytes(p["byte"] & 0xFF for p in kept)
    payload_hex = raw.hex().upper()
    full = bytes(COMPANY_ID) + raw
    return BuiltPayload(
        bytes=raw,
        hex=payload_hex,
        hex_full=full.hex().upper(),
        length_byte=sub_opcode,
        length_byte_hex=f"{sub_opcode:02X}",
        parts=kept,
        warnings=warnings,
    )


def trial_row_from_built(
    built: BuiltPayload,
    *,
    tail_bytes: list[int],
    label: str | None = None,
    sheet: str = "builder",
    vibration: int | None = None,
) -> dict[str, Any]:
    """JSON-serializable TrialRow-shaped record for --emit-trial-row."""
    short = normalize_hex(built.hex)[:12] or "tail"
    tail_pairs = [(i, f"{b:02X}") for i, b in enumerate(tail_bytes)]
    color_idxs = {p.get("colorIdx") for p in built.parts if p.get("role") == "color"}
    vib_hex = None
    if vibration is not None:
        vib_hex = f"{mb_vib_byte(vibration):02X}"
    elif any(p.get("role") == "vib" for p in built.parts):
        vib_hex = f"{next(p['byte'] for p in built.parts if p.get('role') == 'vib'):02X}"
    return {
        "sheet": sheet,
        "row_id": f"{sheet}:{short}",
        "row_index": 0,
        "op_code": None,
        "length_byte": built.length_byte,
        "derived_payload_length": built.length_byte + 2,
        "color_count": len(color_idxs) if color_idxs else 0,
        "color_format_1": None,
        "color_format_2": None,
        "effect_label": label,
        "description": None,
        "hex_full": built.hex_full,
        "hex_key": normalize_hex(built.hex_full),
        "location": None,
        "show": None,
        "date": None,
        "tail_start_index": None,
        "tail_bytes": tail_pairs,
        "vibration_byte": vib_hex,
        "source_sheet_kind": "builder",
        "notes": list(built.warnings),
    }
