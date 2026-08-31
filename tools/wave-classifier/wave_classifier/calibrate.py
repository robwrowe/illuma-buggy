"""Five-corner palette calibration: show each index 0–28 solid, sample webcam RGB."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

from .capture import Camera, CameraError, MissingRoiSet, _grab_until_zones
from .palette import (
    CALIBRATE_INDICES,
    PaletteCalibration,
    default_calibration_path,
    save_calibration,
)
from .payload_builder import build_solid_palette_payload
from .zones import FIVE_CORNER_IDS


def run_palette_calibration(
    *,
    base_url: str,
    five_corner_rois: dict[str, tuple[int, int, int, int]],
    device_index: int = 0,
    settle_margin_ms: int = 500,
    n_frames: int = 30,
    macos_uvc: dict | None = None,
    dest: Path | None = None,
    cam: Camera | None = None,
    session=None,
    gap_seconds: float = 0.25,
    on_index=None,
) -> PaletteCalibration:
    """Drive 29 solid shows (0–28) and write calibration.toml.

    Requires a saved five-corner ROI set. inner-outer / single RGB is derived
    later from those five measurements.
    """
    from .wandsim_client import WandSimSession, show_single, stop, wait_show_started

    needed = set(FIVE_CORNER_IDS)
    if not needed.issubset(five_corner_rois.keys()):
        missing = sorted(needed - set(five_corner_rois.keys()))
        raise MissingRoiSet([f"five-corner (missing {missing})"])
    use = {k: five_corner_rois[k] for k in FIVE_CORNER_IDS}

    owns_cam = cam is None
    owns_session = session is None
    if owns_cam:
        cam = Camera(device_index, macos_uvc=macos_uvc)
        cam.open()
    if owns_session:
        session = WandSimSession(base_url)
        session.__enter__()
    assert cam is not None
    try:
        fps = cam.measured_fps or 30.0
        sample_ms = int(1000.0 * max(n_frames, 8) / max(fps, 1.0)) + 200
        hold_ms = settle_margin_ms + sample_ms
        by_index: dict[int, tuple[int, int, int]] = {}
        by_zone: dict[int, dict[str, tuple[int, int, int]]] = {}
        for i, idx in enumerate(CALIBRATE_INDICES):
            if on_index:
                on_index(i, len(CALIBRATE_INDICES), idx)
            built = build_solid_palette_payload(idx)
            stop(session.base_url)
            show_single(session.base_url, built.hex_full, hold_ms)
            wait_show_started(session.base_url)
            time.sleep(max(0, settle_margin_ms) / 1000.0)
            samples = _grab_until_zones(cam, use, sample_ms)
            zmap: dict[str, tuple[int, int, int]] = {}
            means = []
            for zone, rows in samples.items():
                if not rows:
                    continue
                tail = rows[-min(len(rows), n_frames) :]
                r = sum(x[1] for x in tail) / len(tail)
                g = sum(x[2] for x in tail) / len(tail)
                b = sum(x[3] for x in tail) / len(tail)
                rgb = (int(round(r)), int(round(g)), int(round(b)))
                zmap[zone] = rgb
                means.append(rgb)
            if not means:
                raise CameraError(f"no frames while calibrating palette {idx}")
            by_zone[idx] = zmap
            n = len(means)
            by_index[idx] = (
                int(round(sum(p[0] for p in means) / n)),
                int(round(sum(p[1] for p in means) / n)),
                int(round(sum(p[2] for p in means) / n)),
            )
            try:
                stop(session.base_url)
            except Exception:
                pass
            if gap_seconds > 0:
                time.sleep(gap_seconds)
            if cam.measured_fps is None:
                probe = next(iter(samples.values()), [])
                if len(probe) >= 2:
                    elapsed = (probe[-1][0] - probe[0][0]) / 1000.0
                    if elapsed > 0:
                        cam.measured_fps = (len(probe) - 1) / elapsed
                        fps = cam.measured_fps
        cal = PaletteCalibration(
            source="measured",
            by_index=by_index,
            by_zone=by_zone,
            captured_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            measured_fps=cam.measured_fps,
            age_s=0.0,
        )
        save_calibration(cal, dest or default_calibration_path())
        return cal
    finally:
        if owns_session and session is not None:
            session.__exit__(None, None, None)
        if owns_cam and cam is not None:
            cam.close()
