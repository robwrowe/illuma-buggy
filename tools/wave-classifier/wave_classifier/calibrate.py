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
    wait_for_zones_lit,
    wait_for_zones_off_broadcast,
)
from .palette import mean_rgb_brightest_frames
from .timeline import brightness_of
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


def _measure_palette_color(
    cam: Camera,
    rois: dict[str, tuple[int, int, int, int]],
    *,
    sample_ms: int,
    n_frames: int,
    lit_timeout_ms: int,
    off_max_brightness: float,
    min_sample_brightness: float = 18.0,
) -> tuple[
    dict[str, tuple[int, int, int]],
    tuple[int, int, int],
    dict[str, list[tuple[float, float, float, float]]],
]:
    """Wait for lit ROIs, grab samples, average brightest frames per zone."""
    if not wait_for_zones_lit(
        cam,
        rois,
        min_brightness=max(12.0, off_max_brightness * 0.6),
        timeout_ms=lit_timeout_ms,
    ):
        _log(
            f"  warning: color brightness not seen within {lit_timeout_ms}ms — "
            "sampling anyway (check wand / ROIs)"
        )
    else:
        _log("  → color visible; sampling")
    samples = _grab_until_zones(cam, rois, sample_ms)
    zmap: dict[str, tuple[int, int, int]] = {}
    means: list[tuple[int, int, int]] = []
    for zone, rows in samples.items():
        rgb = mean_rgb_brightest_frames(rows, n_frames)
        if rgb is None:
            continue
        zmap[zone] = rgb
        means.append(rgb)
    if not means:
        raise CameraError("no camera frames during color sample")
    n = len(means)
    overall = (
        int(round(sum(p[0] for p in means) / n)),
        int(round(sum(p[1] for p in means) / n)),
        int(round(sum(p[2] for p in means) / n)),
    )
    if brightness_of(*overall) < min_sample_brightness:
        raise CameraError(
            f"sample too dark {overall} (peak {brightness_of(*overall):.0f} "
            f"< {min_sample_brightness:.0f})"
        )
    return zmap, overall, samples


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
    black_flash_ms: int = 500,
    color_hold_ms: int = 3000,
    off_confirm_timeout_ms: int = 5000,
    off_max_brightness: float = 25.0,
    off_baseline_margin: float = 12.0,
    on_index=None,
) -> PaletteCalibration:
    """Drive 29 solid shows (0–28) and write calibration.toml.

    Before each palette index: broadcast black until the camera confirms all
    five ROIs are dark (for at least *black_flash_ms*), stop black, then show
    the solid color for at least *color_hold_ms* while sampling.
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
        sample_window_ms = settle_margin_ms + sample_ms
        hold_ms = max(sample_window_ms, int(color_hold_ms))
        by_index: dict[int, tuple[int, int, int]] = {}
        by_zone: dict[int, dict[str, tuple[int, int, int]]] = {}
        total = len(CALIBRATE_INDICES)
        for i, idx in enumerate(CALIBRATE_INDICES):
            _log(f"[{i + 1}/{total}] palette {idx}")
            wait_for_zones_off_broadcast(
                session.base_url,
                cam,
                use,
                min_black_ms=black_flash_ms,
                off_confirm_timeout_ms=off_confirm_timeout_ms,
                off_max_brightness=off_max_brightness,
                off_baseline_margin=off_baseline_margin,
                log=_log,
            )
            built = build_solid_palette_payload(idx)
            _log(f"  → show {built.hex} hold={hold_ms}ms")
            color_started = time.monotonic()
            show_single(session.base_url, built.hex_full, hold_ms)
            if not wait_show_started(session.base_url, timeout_s=1.0):
                _log("  warning: palette showActive not confirmed within 1s")
            lit_timeout = max(4000, int(color_hold_ms // 2))
            zmap: dict[str, tuple[int, int, int]]
            overall: tuple[int, int, int]
            samples: dict[str, list[tuple[float, float, float, float]]]
            try:
                zmap, overall, samples = _measure_palette_color(
                    cam,
                    use,
                    sample_ms=sample_ms,
                    n_frames=n_frames,
                    lit_timeout_ms=lit_timeout,
                    off_max_brightness=off_max_brightness,
                )
            except CameraError as exc:
                _log(f"  warning: {exc}; retrying once…")
                try:
                    stop(session.base_url)
                except Exception:
                    pass
                wait_show_idle(session.base_url, timeout_s=1.5)
                wait_for_zones_off_broadcast(
                    session.base_url,
                    cam,
                    use,
                    min_black_ms=black_flash_ms,
                    off_confirm_timeout_ms=off_confirm_timeout_ms,
                    off_max_brightness=off_max_brightness,
                    off_baseline_margin=off_baseline_margin,
                    log=_log,
                )
                show_single(session.base_url, built.hex_full, hold_ms)
                wait_show_started(session.base_url, timeout_s=1.0)
                color_started = time.monotonic()
                zmap, overall, samples = _measure_palette_color(
                    cam,
                    use,
                    sample_ms=sample_ms,
                    n_frames=n_frames,
                    lit_timeout_ms=lit_timeout + 2000,
                    off_max_brightness=off_max_brightness,
                )
            by_zone[idx] = zmap
            by_index[idx] = overall
            _log(f"  → mean RGB {overall}")
            if on_index:
                on_index(i, total, idx)
            elapsed_ms = (time.monotonic() - color_started) * 1000.0
            remain_ms = hold_ms - elapsed_ms
            if remain_ms > 50:
                _log(f"  → holding color {remain_ms:.0f}ms more")
                time.sleep(remain_ms / 1000.0)
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
                        sample_ms = int(1000.0 * max(n_frames, 8) / max(fps, 1.0)) + 200
                        sample_window_ms = settle_margin_ms + sample_ms
                        hold_ms = max(sample_window_ms, int(color_hold_ms))
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
