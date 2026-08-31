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
    off_confirm_ceiling,
    peak_zone_brightness,
    wait_for_zones_lit,
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


def _wait_for_zones_off(
    base_url: str,
    cam: Camera,
    rois: dict[str, tuple[int, int, int, int]],
    *,
    min_black_ms: int,
    off_confirm_timeout_ms: int,
    off_max_brightness: float,
    off_baseline_margin: float = 12.0,
) -> None:
    """Broadcast E905 black until the camera confirms off, then stop before the color."""
    from .wandsim_client import (
        get_status,
        show_single,
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

    pre_peak = peak_zone_brightness(cam, rois)
    min_black = max(0, int(min_black_ms))
    timeout_ms = max(500, int(off_confirm_timeout_ms))
    # Keep black on the air for the whole confirm window (+ slack for min_black).
    black_hold_ms = max(min_black, timeout_ms + 1000)
    built_black = build_solid_palette_payload(29)
    abs_ceiling = off_confirm_ceiling(
        baseline_peak=None,
        baseline_margin=0,
        max_brightness=off_max_brightness,
    )
    if pre_peak is not None:
        _log(
            f"  → black (E905 pal 29) until peak ≤ {abs_ceiling:.0f} "
            f"(pre={pre_peak:.0f}, min {min_black}ms, timeout {timeout_ms}ms)"
        )
    else:
        _log(
            f"  → black (E905 pal 29) until peak ≤ {abs_ceiling:.0f} "
            f"(min {min_black}ms, timeout {timeout_ms}ms)"
        )
    show_single(base_url, built_black.hex_full, black_hold_ms)
    if not wait_show_started(base_url, timeout_s=1.0):
        _log("  warning: black showActive not confirmed within 1s")

    black_started = time.monotonic()
    deadline = black_started + timeout_ms / 1000.0
    baseline_peak: float | None = None
    confirmed = False

    while time.monotonic() < deadline:
        peak = peak_zone_brightness(cam, rois)
        if peak is not None:
            baseline_peak = peak if baseline_peak is None else min(baseline_peak, peak)
        ceiling = off_confirm_ceiling(
            baseline_peak=baseline_peak,
            baseline_margin=off_baseline_margin,
            max_brightness=off_max_brightness,
        )
        min_elapsed = (time.monotonic() - black_started) * 1000.0 >= min_black
        if min_elapsed and confirm_zones_off(
            cam,
            rois,
            max_brightness=off_max_brightness,
            baseline_peak=baseline_peak,
            baseline_margin=off_baseline_margin,
            timeout_ms=250,
        ):
            confirmed = True
            _log(f"  → off confirmed (peak ≤ {ceiling:.0f}); starting color")
            break

    stop(base_url)
    wait_show_idle(base_url, timeout_s=1.5)

    if not confirmed:
        ceiling = off_confirm_ceiling(
            baseline_peak=baseline_peak,
            baseline_margin=off_baseline_margin,
            max_brightness=off_max_brightness,
        )
        last = peak_zone_brightness(cam, rois)
        last_s = f"{last:.0f}" if last is not None else "?"
        raise CameraError(
            f"LED zones did not reach off state within {timeout_ms}ms "
            f"(last peak {last_s}, need ≤ {ceiling:.0f}) — previous color may still "
            "be on; raise --off-confirm-timeout-ms or --black-flash-ms"
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
            _wait_for_zones_off(
                session.base_url,
                cam,
                use,
                min_black_ms=black_flash_ms,
                off_confirm_timeout_ms=off_confirm_timeout_ms,
                off_max_brightness=off_max_brightness,
                off_baseline_margin=off_baseline_margin,
            )
            built = build_solid_palette_payload(idx)
            _log(f"  → show {built.hex} hold={hold_ms}ms")
            color_started = time.monotonic()
            show_single(session.base_url, built.hex_full, hold_ms)
            if not wait_show_started(session.base_url, timeout_s=1.0):
                _log("  warning: palette showActive not confirmed within 1s")
            lit_timeout = max(3000, int(color_hold_ms // 3))
            if not wait_for_zones_lit(
                cam,
                use,
                min_brightness=max(12.0, off_max_brightness * 0.6),
                timeout_ms=lit_timeout,
            ):
                _log(
                    f"  warning: color brightness not seen within {lit_timeout}ms — "
                    "sampling anyway (check wand / ROIs)"
                )
            else:
                _log("  → color visible; sampling")
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
            _log(f"  → mean RGB {by_index[idx]}")
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
