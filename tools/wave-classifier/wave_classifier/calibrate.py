"""Five-corner palette calibration: show each index 0–28 solid, sample webcam RGB."""

from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

from .capture import (
    Camera,
    CameraError,
    MissingRoiSet,
    _grab_until_zones,
    confirm_zones_off,
    peak_brightness_in_samples,
)
from .palette import (
    CALIBRATE_INDICES,
    PaletteCalibration,
    default_calibration_path,
    save_calibration,
)
from .payload_builder import build_solid_palette_payload
from .zones import FIVE_CORNER_IDS


def _log(msg: str) -> None:
    print(msg, flush=True)


def _ensure_zones_off(
    base_url: str,
    cam: Camera,
    rois: dict[str, tuple[int, int, int, int]],
    *,
    black_flash_ms: int,
    off_confirm_timeout_ms: int,
    off_max_brightness: float,
    off_baseline_margin: float = 12.0,
) -> None:
    """Black flash, wait for show idle, then confirm camera sees dark before next color."""
    from .wandsim_client import (
        get_status,
        send_black_flash,
        stop,
        wait_show_idle,
        wait_show_started,
    )

    stop(base_url)
    try:
        if not get_status(base_url, timeout=1.5).get("showActive"):
            pass
        elif not wait_show_idle(base_url, timeout_s=2.0):
            _log("  waiting for wand show to finish…")
            wait_show_idle(base_url, timeout_s=2.0)
    except Exception:
        wait_show_idle(base_url, timeout_s=2.0)

    baseline_peak: float | None = None
    flash_ms = max(0, int(black_flash_ms))
    if flash_ms > 0:
        fps = cam.measured_fps or 30.0
        if fps * (flash_ms / 1000.0) < 2:
            _log(
                f"  warning: black_flash_ms={flash_ms} at {fps:.1f}fps yields <2 frames — "
                "raise --black-flash-ms"
            )
        _log(f"  → black flash {flash_ms}ms (E905 palette 29)")
        send_black_flash(base_url, flash_ms)
        if not wait_show_started(base_url, timeout_s=1.0):
            _log("  warning: black flash showActive not confirmed within 1s")
        black_samples = _grab_until_zones(cam, rois, flash_ms)
        baseline_peak = peak_brightness_in_samples(black_samples)
        wait_show_idle(base_url, timeout_s=flash_ms / 1000.0 + 1.0)

    ceiling = (
        baseline_peak + off_baseline_margin
        if baseline_peak is not None
        else off_max_brightness
    )
    _log(f"  → confirm off (peak ≤ {ceiling:.0f})…")
    if not confirm_zones_off(
        cam,
        rois,
        max_brightness=off_max_brightness,
        baseline_peak=baseline_peak,
        baseline_margin=off_baseline_margin,
        timeout_ms=off_confirm_timeout_ms,
    ):
        raise CameraError(
            f"LED zones did not reach off state (peak > {ceiling:.0f}) — "
            "check wand/WandSim link, ROI boxes, or raise --off-max-brightness / "
            "--off-confirm-timeout-ms"
        )


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
    black_flash_ms: int = 200,
    off_confirm_timeout_ms: int = 2000,
    off_max_brightness: float = 25.0,
    off_baseline_margin: float = 12.0,
    on_index=None,
) -> PaletteCalibration:
    """Drive 29 solid shows (0–28) and write calibration.toml.

    Requires a saved five-corner ROI set. inner-outer / single RGB is derived
    later from those five measurements.

    Before each palette index, sends E905 black (palette 29) and waits until
    the camera confirms all five ROIs are dark (relative to the black flash).
    """
    from .wandsim_client import (
        WandSimError,
        WandSimSession,
        ping_wandsim,
        show_single,
        stop,
        wait_show_idle,
        wait_show_started,
    )

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
        _log(f"WandSimulator: {base_url.rstrip('/')}")
        try:
            st = ping_wandsim(base_url)
            _log(
                f"  ok  wifi={st.get('wifi')} ip={st.get('ip', '?')} "
                f"showActive={st.get('showActive')}"
            )
        except WandSimError as exc:
            raise WandSimError(
                f"{exc} — use the board IP if mDNS is slow "
                "(config [wandsim] base_url = \"http://192.168.x.x\")"
            ) from exc
        session = WandSimSession(base_url)
        session.__enter__()
    assert cam is not None
    try:
        fps = cam.measured_fps or 30.0
        sample_ms = int(1000.0 * max(n_frames, 8) / max(fps, 1.0)) + 200
        hold_ms = settle_margin_ms + sample_ms
        by_index: dict[int, tuple[int, int, int]] = {}
        by_zone: dict[int, dict[str, tuple[int, int, int]]] = {}
        total = len(CALIBRATE_INDICES)
        for i, idx in enumerate(CALIBRATE_INDICES):
            _log(f"[{i + 1}/{total}] palette {idx}")
            _ensure_zones_off(
                session.base_url,
                cam,
                use,
                black_flash_ms=black_flash_ms,
                off_confirm_timeout_ms=off_confirm_timeout_ms,
                off_max_brightness=off_max_brightness,
                off_baseline_margin=off_baseline_margin,
            )
            built = build_solid_palette_payload(idx)
            _log(f"  → show {built.hex} hold={hold_ms}ms")
            show_single(session.base_url, built.hex_full, hold_ms)
            if not wait_show_started(session.base_url, timeout_s=1.0):
                _log("  warning: palette showActive not confirmed within 1s")
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
                raise CameraError(
                    f"no camera frames while calibrating palette {idx} — "
                    "check USB camera; retry calibrate-palette"
                )
            by_zone[idx] = zmap
            n = len(means)
            by_index[idx] = (
                int(round(sum(p[0] for p in means) / n)),
                int(round(sum(p[1] for p in means) / n)),
                int(round(sum(p[2] for p in means) / n)),
            )
            if on_index:
                on_index(i, total, idx)
            try:
                stop(session.base_url)
            except Exception:
                pass
            wait_show_idle(session.base_url, timeout_s=1.5)
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
