"""Zone-layout mapping for multi-ROI capture.

Single place that turns xlsx hint columns into a layout name. Capture and
triage both call this — do not sniff 5-Zones?/Layout columns elsewhere.

Names match web/src/lib/ble/mbConstants.ts FIVE_CORNER_IDS.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from .xlsx_loader import TrialRow

ZoneLayoutName = Literal["single", "five-corner", "inner-outer"]

FIVE_CORNER_IDS = ["topLeft", "bottomLeft", "bottomRight", "topRight", "center"]
INNER_OUTER_IDS = ["center", "outer"]

YES = {"y", "yes", "true", "1"}
NO = {"n", "no", "false", "0"}


@dataclass
class ZoneLayout:
    layout: ZoneLayoutName
    assumed: bool = False
    downgraded: bool = False


def preferred_capture_layout(rois_by_layout: dict | None) -> ZoneLayout:
    """Richest ROI set that is actually configured.

    Observe must not ask a human to classify inner/outer vs five-corner —
    both are commonly two-color sawtooth, and the packet bits that switch
    them are not known yet. Capture five-corner when those ROIs exist so
    measured stagger (or four corners in lockstep vs center) can tell them
    apart later. This is capture geometry, not an effect label.
    """
    rois = rois_by_layout or {}
    if rois.get("five-corner"):
        return ZoneLayout("five-corner")
    if rois.get("inner-outer"):
        return ZoneLayout("inner-outer")
    if rois.get("single"):
        return ZoneLayout("single", assumed=True)
    return ZoneLayout("single", assumed=True)


def zone_names_for_layout(layout: str) -> list[str]:
    if layout == "five-corner":
        return list(FIVE_CORNER_IDS)
    if layout == "inner-outer":
        return list(INNER_OUTER_IDS)
    return ["all"]


def _truthy(value: str | None) -> bool | None:
    if value is None or not str(value).strip():
        return None
    s = str(value).strip().lower()
    if s in YES:
        return True
    if s in NO:
        return False
    return None


def resolve_zone_layout(trial_row: TrialRow) -> ZoneLayout:
    """Map a trial's zone-hint columns to a capture layout.

    5-Zones? Y → five-corner, N → single.
    Layout "Inner/Outer" → inner-outer.
    Otherwise single, with assumed=True so the report can flag it.
    """
    hint = getattr(trial_row, "zone_layout_hint", None)
    five = _truthy(getattr(hint, "five_zones", None) if hint else None)
    if five is True:
        return ZoneLayout("five-corner")
    if five is False:
        return ZoneLayout("single")

    layout_col = (getattr(hint, "layout", None) if hint else None) or ""
    layout_l = layout_col.strip().lower()
    if layout_l:
        if "inner" in layout_l or "outer" in layout_l:
            return ZoneLayout("inner-outer")
        if "five" in layout_l or "5-corner" in layout_l or "5 corner" in layout_l:
            return ZoneLayout("five-corner")
        if layout_l in {"single", "one", "all"}:
            return ZoneLayout("single")

    desc = (getattr(trial_row, "description", None) or "").lower()
    if "inner/outer" in desc or "inner / outer" in desc:
        return ZoneLayout("inner-outer")

    return ZoneLayout("single", assumed=True)


def primary_zone_name(trial_row: TrialRow, layout: str) -> str:
    """Zone whose waveform is compared to effect_label — never an all-zone average."""
    if layout == "single":
        return "all"
    sheet = (trial_row.sheet or "").lower()
    effect = (trial_row.effect_label or "").lower()
    hint = getattr(trial_row, "zone_layout_hint", None)
    layout_col = ((getattr(hint, "layout", None) if hint else None) or "").lower()
    desc = (trial_row.description or "").lower()
    inner_outer = (
        layout == "inner-outer"
        or "inner" in layout_col
        or "outer" in layout_col
        or "inner" in desc
        or "outer" in desc
    )
    chase_like = "chase" in sheet or effect in {"chase", "flicker chase"}
    if chase_like and layout == "five-corner":
        return "outer"  # consensus of the 4 corners, not a CSV zone name
    if inner_outer:
        return "center"
    if layout == "five-corner":
        return "center"
    return "all"
