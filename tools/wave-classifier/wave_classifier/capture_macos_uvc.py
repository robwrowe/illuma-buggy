"""macOS UVC camera lock via `uvc-util` (set then get — never trust a silent -s).

C920 / Logitech Camera Settings mapping is unit-specific. ISO→gain is skipped
until `capture.macos_uvc.gain_for_iso_400` is calibrated (not guessed).
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any

UVC_BIN = "uvc-util"

# Names we try first; list_uvc_controls() may reveal aliases on this unit.
CONTROL_ALIASES = {
    "auto-exposure-mode": ("auto-exposure-mode", "auto_exposure_mode", "ae-mode"),
    "exposure-time-abs": ("exposure-time-abs", "exposure_time_abs", "exposure-absolute"),
    "gain": ("gain", "gain-abs"),
    "auto-focus": ("auto-focus", "focus-auto", "autofocus"),
    "focus-abs": ("focus-abs", "focus_abs", "absolute-focus"),
}

# UVC exposure-time-abs is in 100 µs units. 1/60 s ≈ 166.7 → round after step snap.
SHUTTER_1_60_100US = 167

# Manual mode is typically 1 in the UVC AE bitmask (1=Manual, 2=Auto, 4=Shutter
# Priority, 8=Aperture Priority). Confirm via `uvc-util -S auto-exposure-mode`
# on this unit before treating a mismatch as a code bug — some C920s ignore
# this write (jtfrey/uvc-util#6).
AE_MANUAL_DEFAULT = 1


class UvcError(Exception):
    pass


@dataclass
class UvcControlTarget:
    control_name: str
    requested_value: Any
    unit_note: str = ""


@dataclass
class UvcSetResult:
    control_name: str
    requested_value: Any
    actual_value: Any = None
    matched: bool = False
    warning: str | None = None
    skipped: bool = False


def uvc_util_available() -> bool:
    return shutil.which(UVC_BIN) is not None


def _run(args: list[str]) -> str:
    proc = subprocess.run(
        [UVC_BIN, *args],
        capture_output=True,
        text=True,
        timeout=20,
    )
    out = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
    if proc.returncode != 0:
        raise UvcError(out.strip() or f"{UVC_BIN} {' '.join(args)} exited {proc.returncode}")
    return out


def list_uvc_controls(camera_index: int) -> list[str]:
    """`uvc-util -I <index> -c` → control name list (discovery, cached by caller)."""
    text = _run(["-I", str(camera_index), "-c"])
    names = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        # Typical: "auto-exposure-mode" or "  auto-exposure-mode { ... }"
        m = re.match(r"^[\-\w]+", line)
        if m and not line.lower().startswith("device"):
            names.append(m.group(0))
    return names


def _resolve_name(camera_index: int, logical: str, available: list[str] | None = None) -> str | None:
    have = available if available is not None else list_uvc_controls(camera_index)
    have_l = {n.lower(): n for n in have}
    for alias in CONTROL_ALIASES.get(logical, (logical,)):
        if alias.lower() in have_l:
            return have_l[alias.lower()]
    return None


def describe_uvc_control(camera_index: int, control_name: str) -> dict:
    """Parse `uvc-util -I <i> -S <name>` into min/max/step/default/type."""
    text = _run(["-I", str(camera_index), "-S", control_name])
    info: dict[str, Any] = {"raw": text, "name": control_name}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, val = [p.strip() for p in line.split(":", 1)]
        key_l = key.lower().replace(" ", "-").replace("_", "-")
        num = _maybe_number(val)
        if num is not None and key_l in {
            "minimum",
            "min",
            "maximum",
            "max",
            "step-size",
            "step",
            "default-value",
            "default",
            "current-value",
            "current",
        }:
            canon = {
                "min": "minimum",
                "max": "maximum",
                "step": "step-size",
                "default": "default-value",
                "current": "current-value",
            }.get(key_l, key_l)
            info[canon] = num
        elif key_l == "type":
            info["type"] = val
    return info


def _maybe_number(val: str):
    s = val.strip().split()[0].rstrip(",")
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    return None


def snap_to_step(value: float, info: dict) -> int:
    lo = info.get("minimum")
    hi = info.get("maximum")
    step = info.get("step-size") or 1
    if lo is None:
        lo = value
    if hi is None:
        hi = value
    try:
        step = float(step)
    except (TypeError, ValueError):
        step = 1.0
    if step <= 0:
        step = 1.0
    clamped = min(max(float(value), float(lo)), float(hi))
    n = round((clamped - float(lo)) / step)
    snapped = float(lo) + n * step
    snapped = min(max(snapped, float(lo)), float(hi))
    if abs(snapped - round(snapped)) < 1e-6:
        return int(round(snapped))
    return int(round(snapped))


def get_uvc_value(camera_index: int, control_name: str) -> str:
    text = _run(["-I", str(camera_index), "-g", control_name]).strip()
    # Last non-empty line often holds the value; also accept "name = value"
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line:
            continue
        if "=" in line:
            return line.split("=", 1)[1].strip()
        if ":" in line:
            return line.split(":", 1)[1].strip()
        return line
    return text


_BOOL_TRUE = {"true", "on", "1", "yes"}
_BOOL_FALSE = {"false", "off", "0", "no"}


def _normalize_boolish(v) -> int | None:
    """uvc-util reports bool-style controls as 'true'/'false' text. Returns
    0/1 if v looks bool-ish, else None (caller falls through to numeric compare)."""
    s = str(v).strip().lower()
    if s in _BOOL_TRUE:
        return 1
    if s in _BOOL_FALSE:
        return 0
    return None

def _values_match(requested, actual, step=None) -> bool:
    if actual is None:
        return False
    if str(requested).strip().lower() == str(actual).strip().lower():
        return True

    # Bool-style controls: uvc-util reports "true"/"false", we request 0/1.
    req_bool = _normalize_boolish(requested)
    act_bool = _normalize_boolish(actual)
    if req_bool is not None and act_bool is not None:
        return req_bool == act_bool

    try:
        a = float(str(actual).split()[0])
        r = float(requested)
    except (TypeError, ValueError):
        return False
    if step is not None:
        try:
            st = float(step)
            if st > 0 and abs(a - r) <= st + 1e-6:
                return True
        except (TypeError, ValueError):
            pass
    return abs(a - r) < 1e-6


def set_and_verify(camera_index: int, target: UvcControlTarget, *, info: dict | None = None) -> UvcSetResult:
    """Set then get. matched=True only if the get agrees (optionally within one step)."""
    try:
        _run(["-I", str(camera_index), "-s", f"{target.control_name}={target.requested_value}"])
    except UvcError as exc:
        return UvcSetResult(
            control_name=target.control_name,
            requested_value=target.requested_value,
            matched=False,
            warning=f"set failed: {exc}",
        )
    try:
        actual = get_uvc_value(camera_index, target.control_name)
    except UvcError as exc:
        return UvcSetResult(
            control_name=target.control_name,
            requested_value=target.requested_value,
            actual_value=None,
            matched=False,
            warning=f"get after set failed: {exc}",
        )
    step = (info or {}).get("step-size")
    matched = _values_match(target.requested_value, actual, step=step)
    warning = None
    if not matched:
        warning = (
            f"{target.control_name}: requested {target.requested_value}"
            f"{(' (' + target.unit_note + ')') if target.unit_note else ''} "
            f"but camera reports {actual}. Set this in Logitech's Camera Settings "
            "app before running capture if the lock did not take."
        )
    return UvcSetResult(
        control_name=target.control_name,
        requested_value=target.requested_value,
        actual_value=actual,
        matched=matched,
        warning=warning,
    )


def _ae_manual_value(info: dict) -> int:
    raw = (info.get("raw") or "").lower()
    if "manual" in raw:
        m = re.search(r"manual[^\d]*(\d+)", raw)
        if m:
            return int(m.group(1))
    return AE_MANUAL_DEFAULT


def lock_camera_for_capture(
    camera_index: int,
    *,
    auto_exposure_manual: bool = True,
    shutter_1_60s: bool = True,
    iso_400: bool = True,
    auto_focus_off: bool = True,
    focus_zero: bool = True,
    gain_for_iso_400: int | None = None,
) -> list[UvcSetResult]:
    """One session lock. AE Manual first so exposure/gain writes are accepted."""
    results: list[UvcSetResult] = []
    if not uvc_util_available():
        return [
            UvcSetResult(
                control_name="(uvc-util)",
                requested_value="",
                matched=False,
                warning="uvc-util not on PATH — brew install uvc-util",
                skipped=True,
            )
        ]
    try:
        available = list_uvc_controls(camera_index)
    except UvcError as exc:
        return [
            UvcSetResult(
                control_name="(uvc-util)",
                requested_value="",
                matched=False,
                warning=f"could not list controls: {exc}",
            )
        ]

    def name(logical: str) -> str | None:
        return _resolve_name(camera_index, logical, available)

    if auto_exposure_manual:
        ctl = name("auto-exposure-mode")
        if not ctl:
            results.append(
                UvcSetResult(
                    control_name="auto-exposure-mode",
                    requested_value=AE_MANUAL_DEFAULT,
                    matched=False,
                    warning="control not listed by uvc-util -c on this unit",
                    skipped=True,
                )
            )
        else:
            info = describe_uvc_control(camera_index, ctl)
            val = _ae_manual_value(info)
            results.append(
                set_and_verify(
                    camera_index,
                    UvcControlTarget(ctl, val, "UVC AE mode (1=Manual typical)"),
                    info=info,
                )
            )

    if shutter_1_60s:
        ctl = name("exposure-time-abs")
        if not ctl:
            results.append(
                UvcSetResult(
                    control_name="exposure-time-abs",
                    requested_value=SHUTTER_1_60_100US,
                    matched=False,
                    warning="control not listed",
                    skipped=True,
                )
            )
        else:
            info = describe_uvc_control(camera_index, ctl)
            snapped = snap_to_step(SHUTTER_1_60_100US, info)
            results.append(
                set_and_verify(
                    camera_index,
                    UvcControlTarget(ctl, snapped, "100us units; 1/60s ≈ 167"),
                    info=info,
                )
            )

    if iso_400:
        if gain_for_iso_400 is None:
            results.append(
                UvcSetResult(
                    control_name="gain",
                    requested_value="ISO 400",
                    matched=False,
                    skipped=True,
                    warning=(
                        "ISO→gain not calibrated. In Logitech Camera Settings set ISO 400, "
                        "then `uvc-util -I %s -g gain` and put that integer in "
                        "config.toml [capture.macos_uvc] gain_for_iso_400. "
                        "Skipping gain rather than guessing."
                        % camera_index
                    ),
                )
            )
        else:
            ctl = name("gain")
            if not ctl:
                results.append(
                    UvcSetResult(
                        control_name="gain",
                        requested_value=gain_for_iso_400,
                        matched=False,
                        warning="gain control not listed",
                        skipped=True,
                    )
                )
            else:
                info = describe_uvc_control(camera_index, ctl)
                snapped = snap_to_step(gain_for_iso_400, info)
                results.append(
                    set_and_verify(
                        camera_index,
                        UvcControlTarget(
                            ctl,
                            snapped,
                            "empirically calibrated vs Logitech ISO 400 on this C920 — not a formula",
                        ),
                        info=info,
                    )
                )

    if auto_focus_off:
        ctl = name("auto-focus")
        if not ctl:
            results.append(
                UvcSetResult(
                    control_name="auto-focus",
                    requested_value=0,
                    matched=False,
                    skipped=True,
                    warning="control not listed",
                )
            )
        else:
            info = describe_uvc_control(camera_index, ctl)
            results.append(
                set_and_verify(camera_index, UvcControlTarget(ctl, 0, "0=off"), info=info)
            )

    if focus_zero:
        ctl = name("focus-abs")
        if not ctl:
            results.append(
                UvcSetResult(
                    control_name="focus-abs",
                    requested_value="minimum",
                    matched=False,
                    skipped=True,
                    warning="control not listed",
                )
            )
        else:
            info = describe_uvc_control(camera_index, ctl)
            lo = info.get("minimum", 0)
            results.append(
                set_and_verify(
                    camera_index,
                    UvcControlTarget(ctl, lo, "0% of reported range (minimum)"),
                    info=info,
                )
            )

    return results
