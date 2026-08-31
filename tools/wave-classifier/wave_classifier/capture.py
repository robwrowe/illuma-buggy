"""Webcam capture: ROI picker, exposure lock, per-trial CSV writer."""

from __future__ import annotations

import csv
import platform
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .xlsx_loader import TrialRow, fs_safe


class CameraError(Exception):
    pass


_cv2_mod = None


def _cv2():
    """Lazy-import OpenCV so --help / dry-run / report-only don't load it."""
    global _cv2_mod
    if _cv2_mod is None:
        import cv2 as cv2_mod

        _cv2_mod = cv2_mod
    return _cv2_mod


AUTO_EXPOSURE_WARNING = (
    "Auto-exposure could not be disabled on this camera/OS — waveform shape may be "
    "distorted by the camera's own gain-adjustment; on Linux try "
    "`v4l2-ctl -d /dev/videoN -c auto_exposure=1`"
)


@dataclass
class CaptureResult:
    trial: TrialRow
    csv_paths: list[Path]
    capture_status: str
    measured_fps: float | None
    n_frames: list[int]
    error: str | None = None
    show_started: bool = False
    baseline_frame_range: tuple[int, int] | None = None


def _roi_tuple(roi) -> tuple[int, int, int, int]:
    x, y, w, h = (int(v) for v in roi)
    if w <= 0 or h <= 0:
        raise CameraError(f"invalid ROI {roi!r} — run select-roi")
    return x, y, w, h


def _mean_rgb(frame_bgr: np.ndarray, roi: tuple[int, int, int, int]) -> tuple[float, float, float]:
    x, y, w, h = roi
    h_img, w_img = frame_bgr.shape[:2]
    x0 = max(0, min(x, w_img - 1))
    y0 = max(0, min(y, h_img - 1))
    x1 = max(x0 + 1, min(x + w, w_img))
    y1 = max(y0 + 1, min(y + h, h_img))
    patch = frame_bgr[y0:y1, x0:x1]
    # OpenCV is BGR; write RGB so CSVs aren't silently transposed.
    b, g, r = patch.mean(axis=(0, 1))
    return float(r), float(g), float(b)


def _try_disable_auto(cap) -> bool:
    """Best-effort lock. Driver support varies; warn rather than fail."""
    cv2 = _cv2()
    locked = True
    # Common conventions: 0.25 / 1 = manual (DirectShow / V4L2), 0.75 / 3 = auto.
    for value in (0.25, 1.0, 0.0):
        cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, value)
    read_ae = cap.get(cv2.CAP_PROP_AUTO_EXPOSURE)
    # If it still looks like the auto values, flag it.
    if abs(read_ae - 0.75) < 0.05 or abs(read_ae - 3.0) < 0.05:
        locked = False
    if hasattr(cv2, "CAP_PROP_AUTO_WB"):
        cap.set(cv2.CAP_PROP_AUTO_WB, 0)
        if cap.get(cv2.CAP_PROP_AUTO_WB) not in (0, 0.0):
            locked = False
    return locked


def _try_macos_uvc_lock(device_index: int, macos_uvc: dict | None) -> bool:
    """Session-once UVC lock. Warn-and-continue if a control doesn't verify."""
    from .capture_macos_uvc import lock_camera_for_capture, uvc_util_available

    if not uvc_util_available():
        print(
            "warning: uvc-util not on PATH — brew install uvc-util "
            "(OpenCV AE lock on macOS usually cannot drive a C920)"
        )
        return False
    cfg = macos_uvc or {}
    idx = cfg.get("camera_index")
    if idx is None:
        idx = device_index
    gain = cfg.get("gain_for_iso_400")
    if gain in (None, "", "null"):
        gain = None
    else:
        gain = int(gain)
    results = lock_camera_for_capture(int(idx), gain_for_iso_400=gain)
    any_unmatched = False
    for r in results:
        flag = "ok" if r.matched else ("skip" if r.skipped else "MISMATCH")
        print(
            f"uvc-util {flag}: {r.control_name} requested={r.requested_value} "
            f"actual={r.actual_value}"
        )
        if r.warning:
            print(f"warning: {r.warning}")
        if not r.matched and not r.skipped:
            any_unmatched = True
    return not any_unmatched and any(r.matched for r in results)


class Camera:
    def __init__(
        self,
        device_index: int = 0,
        target_fps: float | None = None,
        macos_uvc: dict | None = None,
    ):
        self.device_index = device_index
        self.target_fps = target_fps
        self.macos_uvc = macos_uvc or {}
        self.cap = None
        self.auto_locked = False
        self.measured_fps: float | None = None

    def open(self) -> None:
        cv2 = _cv2()
        cap = cv2.VideoCapture(self.device_index)
        if not cap.isOpened():
            raise CameraError(f"cannot open camera device_index={self.device_index}")
        if self.target_fps:
            cap.set(cv2.CAP_PROP_FPS, float(self.target_fps))
        self.auto_locked = False
        if platform.system() == "Darwin":
            self.auto_locked = _try_macos_uvc_lock(self.device_index, self.macos_uvc)
            if not self.auto_locked:
                self.auto_locked = _try_disable_auto(cap)
        else:
            self.auto_locked = _try_disable_auto(cap)
        if not self.auto_locked:
            print(f"warning: {AUTO_EXPOSURE_WARNING}")
        # Warm-up so AE/WB (if still on) and USB settle before the first trial.
        for _ in range(8):
            cap.read()
        self.cap = cap

    def close(self) -> None:
        if self.cap is not None:
            self.cap.release()
            self.cap = None

    def __enter__(self) -> Camera:
        self.open()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def grab(self) -> np.ndarray | None:
        assert self.cap is not None
        ok, frame = self.cap.read()
        if not ok or frame is None:
            return None
        return frame


def pick_roi(device_index: int = 0) -> tuple[int, int, int, int]:
    """Back-compat: pick the `all` ROI for the single layout."""
    rois = pick_rois("single", device_index)
    return rois["all"]


def pick_rois(layout: str, device_index: int = 0) -> dict[str, tuple[int, int, int, int]]:
    """Pick one ROI per zone in `layout`, then show a composite preview."""
    from .zones import zone_names_for_layout

    cv2 = _cv2()
    names = zone_names_for_layout(layout)
    rois: dict[str, tuple[int, int, int, int]] = {}
    with Camera(device_index) as cam:
        frozen = _freeze_frame(cam, cv2)
        for name in names:
            x, y, w, h = cv2.selectROI(
                f"Select ROI: {name}",
                frozen,
                showCrosshair=True,
                fromCenter=False,
            )
            cv2.destroyWindow(f"Select ROI: {name}")
            if w <= 0 or h <= 0:
                raise CameraError(f"empty ROI for {name} — drag a rectangle around that LED")
            rois[name] = (int(x), int(y), int(w), int(h))
            print(f"ROI {name}: x={int(x)} y={int(y)} w={int(w)} h={int(h)}")
        _warn_overlaps(rois)
        composite = frozen.copy()
        colors = [(0, 255, 255), (0, 255, 0), (255, 0, 0), (255, 0, 255), (0, 128, 255)]
        for i, (name, (x, y, w, h)) in enumerate(rois.items()):
            c = colors[i % len(colors)]
            cv2.rectangle(composite, (x, y), (x + w, y + h), c, 2)
            cv2.putText(composite, name, (x, max(12, y - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, c, 1, cv2.LINE_AA)
        cv2.imshow("ROI composite — any key to save, Q to cancel", composite)
        key = cv2.waitKey(0) & 0xFF
        cv2.destroyAllWindows()
        if key in (ord("q"), ord("Q"), 27):
            raise CameraError("ROI selection cancelled at composite preview")
    return rois


def _freeze_frame(cam: Camera, cv2):
    print("Live preview: press SPACE to freeze, then drag each zone ROI. Q cancels.")
    while True:
        frame = cam.grab()
        if frame is None:
            raise CameraError("camera returned no frames")
        preview = frame.copy()
        cv2.putText(
            preview,
            "SPACE=freeze  Q=quit",
            (12, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (0, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.imshow("wave-classifier preview", preview)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), ord("Q"), 27):
            cv2.destroyAllWindows()
            raise CameraError("ROI selection cancelled")
        if key in (ord(" "), 13):
            cv2.destroyWindow("wave-classifier preview")
            return frame


def _warn_overlaps(rois: dict[str, tuple[int, int, int, int]]) -> None:
    names = list(rois)
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            if _rects_overlap(rois[a], rois[b]):
                print(
                    f"warning: ROI {a} overlaps {b} — expected for a wide `outer` box; "
                    "otherwise re-run select-rois so each box lands on one LED"
                )


def _rects_overlap(a, b) -> bool:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and ax + aw > bx and ay < by + bh and ay + ah > by


def write_samples_csv(path: Path, rows: list[tuple[float, float, float, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["t_ms", "r", "g", "b"])
        for t_ms, r, g, b in rows:
            writer.writerow([f"{t_ms:.3f}", f"{r:.4f}", f"{g:.4f}", f"{b:.4f}"])


def read_samples_csv(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    t, r, g, b = [], [], [], []
    with path.open(newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            t.append(float(row["t_ms"]))
            r.append(float(row["r"]))
            g.append(float(row["g"]))
            b.append(float(row["b"]))
    return (
        np.asarray(t, dtype=float),
        np.asarray(r, dtype=float),
        np.asarray(g, dtype=float),
        np.asarray(b, dtype=float),
    )


def capture_file_path(
    captures_dir: Path,
    trial: TrialRow,
    zone_name: str = "all",
    repeat_index: int | None = None,
) -> Path:
    parts = [trial.row_id_safe, zone_name]
    if repeat_index is not None:
        parts.append(f"r{repeat_index}")
    return captures_dir / trial.sheet_safe / ("__".join(parts) + ".csv")


def _grab_until_zones(
    cam: Camera,
    rois: dict[str, tuple[int, int, int, int]],
    duration_ms: float,
    *,
    samples: dict[str, list[tuple[float, float, float, float]]] | None = None,
    clock_start: float | None = None,
) -> dict[str, list[tuple[float, float, float, float]]]:
    out = samples if samples is not None else {n: [] for n in rois}
    start = clock_start if clock_start is not None else time.monotonic()
    deadline = time.monotonic() + duration_ms / 1000.0
    while time.monotonic() < deadline:
        frame = cam.grab()
        now = time.monotonic()
        if frame is None:
            continue
        t_ms = (now - start) * 1000.0
        for name, roi in rois.items():
            r, g, b = _mean_rgb(frame, roi)
            out[name].append((t_ms, r, g, b))
    return out


class MissingRoiSet(Exception):
    def __init__(self, layouts: list[str]):
        self.layouts = layouts
        cmds = " ; ".join(f"python -m wave_classifier select-rois --zone-layout {lay}" for lay in layouts)
        super().__init__(
            "no saved ROI set for layout(s): "
            + ", ".join(layouts)
            + f" — run: {cmds}"
        )


def rois_for_layout(cfg_rois: dict, layout: str) -> dict[str, tuple[int, int, int, int]] | None:
    """Look up [capture.rois.<layout>] ; fall back to legacy capture.roi as single.all."""
    if not cfg_rois:
        return None
    block = cfg_rois.get(layout)
    if isinstance(block, dict) and block:
        out = {}
        for name, val in block.items():
            try:
                out[name] = _roi_tuple(val)
            except (TypeError, ValueError, CameraError):
                return None
        return out or None
    return None


def capture_trial(
    cam: Camera,
    session,
    trial: TrialRow,
    *,
    captures_dir: Path,
    rois: dict[str, tuple[int, int, int, int]],
    hold_ms: int,
    settle_margin_ms: int,
    repeat_index: int | None = None,
    resume: bool = False,
    black_flash_ms: int = 0,
) -> tuple[list[Path], str, int, bool, str | None, tuple[int, int] | None]:
    from .wandsim_client import WandSimError, send_black_flash, show_single, stop, wait_show_started

    paths_expected = [capture_file_path(captures_dir, trial, z, repeat_index) for z in rois]
    if resume and all(p.is_file() for p in paths_expected):
        return paths_expected, "ok", 0, True, "resume: skipped (per-zone CSVs already present)", None

    show_started = False
    samples: dict[str, list[tuple[float, float, float, float]]] = {n: [] for n in rois}
    clock_start = time.monotonic()
    baseline_range: tuple[int, int] | None = None
    try:
        stop(session.base_url)
        flash_ms = max(0, int(black_flash_ms or 0))
        if flash_ms > 0:
            fps = cam.measured_fps or 30.0
            if fps * (flash_ms / 1000.0) < 2:
                print(
                    f"warning: black_flash_ms={flash_ms} at {fps:.1f}fps yields <2 frames — "
                    "raise --black-flash-ms or check camera fps"
                )
            send_black_flash(session.base_url, flash_ms)
            wait_show_started(session.base_url)
            _grab_until_zones(
                cam, rois, flash_ms, samples=samples, clock_start=clock_start,
            )
            k = min((len(v) for v in samples.values()), default=0)
            baseline_range = (0, k)
        show_single(session.base_url, trial.hex_full, hold_ms)
        show_started = wait_show_started(session.base_url)
        _grab_until_zones(
            cam, rois, hold_ms + settle_margin_ms, samples=samples, clock_start=clock_start,
        )
    except WandSimError as exc:
        return [], "wandsim_error", 0, False, str(exc), None
    except CameraError as exc:
        return [], "camera_error", 0, False, str(exc), None
    finally:
        try:
            stop(session.base_url)
        except Exception:
            pass

    n_frames = min((len(v) for v in samples.values()), default=0)
    if n_frames < 8:
        return [], "too_few_frames", n_frames, show_started, f"only {n_frames} frames", baseline_range
    paths: list[Path] = []
    for zone, rows in samples.items():
        path = capture_file_path(captures_dir, trial, zone, repeat_index)
        write_samples_csv(path, rows)
        paths.append(path)
        if cam.measured_fps is None and rows:
            elapsed = (rows[-1][0] - rows[0][0]) / 1000.0
            if elapsed > 0:
                cam.measured_fps = (len(rows) - 1) / elapsed
    note = None if show_started else "showActive never confirmed; captured anyway (steps=1)"
    return paths, "ok", n_frames, show_started, note, baseline_range


def run_captures(
    trial_rows: list[TrialRow],
    *,
    base_url: str,
    captures_dir: Path,
    device_index: int,
    rois_by_layout: dict[str, dict[str, tuple[int, int, int, int]]],
    hold_ms: int,
    settle_margin_ms: int,
    gap_seconds: float,
    repeats: int,
    target_fps: float | None = None,
    resume: bool = False,
    on_trial: Callable[[int, int, TrialRow], None] | None = None,
    macos_uvc: dict | None = None,
    black_flash_ms: int = 0,
    calibrate: bool = False,
) -> list[CaptureResult]:
    from .wandsim_client import WandSimSession
    from .zones import resolve_zone_layout, zone_names_for_layout

    results: list[CaptureResult] = []
    n = len(trial_rows)
    probe_rois = next(iter(rois_by_layout.values()), {"all": (0, 0, 32, 32)})
    with Camera(device_index, target_fps=target_fps, macos_uvc=macos_uvc) as cam, WandSimSession(base_url) as session:
        probe = _grab_until_zones(cam, {k: probe_rois[k] for k in list(probe_rois)[:1]}, 400)
        rows = next(iter(probe.values()), [])
        if len(rows) >= 2:
            elapsed = (rows[-1][0] - rows[0][0]) / 1000.0
            if elapsed > 0:
                cam.measured_fps = (len(rows) - 1) / elapsed
                print(f"measured fps: {cam.measured_fps:.1f}")
        if calibrate:
            from .calibrate import run_palette_calibration

            five = rois_by_layout.get("five-corner")
            if not five:
                raise MissingRoiSet(["five-corner"])
            print("calibrating palette 0–28 (five-corner)…")
            cal = run_palette_calibration(
                base_url=base_url,
                five_corner_rois=five,
                settle_margin_ms=settle_margin_ms,
                cam=cam,
                session=session,
                on_index=lambda i, n, idx: print(f"  palette {idx} ({i + 1}/{n})"),
            )
            print(f"wrote {cal.path}  source={cal.source}")
            from .palette import calibration_diff_lines

            print("\n".join(calibration_diff_lines(cal)))
        for i, trial in enumerate(trial_rows):
            if on_trial:
                on_trial(i, n, trial)
            zl = resolve_zone_layout(trial)
            layout = zl.layout
            downgraded = False
            rois = rois_by_layout.get(layout)
            if rois is None and layout == "five-corner" and rois_by_layout.get("inner-outer"):
                print(
                    f"warning: {trial.row_id} needs five-corner ROIs; falling back to inner-outer "
                    "(zone_layout_downgraded). Prefer select-rois --zone-layout five-corner."
                )
                layout = "inner-outer"
                rois = rois_by_layout["inner-outer"]
                downgraded = True
                trial.zone_layout_downgraded = True
            if rois is None:
                raise MissingRoiSet([zl.layout])
            needed = set(zone_names_for_layout(layout))
            if not needed.issubset(rois.keys()):
                missing = sorted(needed - set(rois.keys()))
                raise MissingRoiSet([f"{layout} (missing {missing})"])
            use = {k: rois[k] for k in zone_names_for_layout(layout)}
            paths: list[Path] = []
            n_frames: list[int] = []
            last_status = "ok"
            last_error = None
            show_started = False
            last_baseline = None
            try:
                for r in range(repeats):
                    repeat_index = r if repeats > 1 else None
                    pths, status, frames, started, err, baseline = capture_trial(
                        cam,
                        session,
                        trial,
                        captures_dir=captures_dir,
                        rois=use,
                        hold_ms=hold_ms,
                        settle_margin_ms=settle_margin_ms,
                        repeat_index=repeat_index,
                        resume=resume,
                        black_flash_ms=black_flash_ms,
                    )
                    last_status = status
                    last_error = err
                    last_baseline = baseline
                    show_started = show_started or started
                    n_frames.append(frames)
                    paths.extend(pths)
                    if r + 1 < repeats:
                        time.sleep(gap_seconds)
            except KeyboardInterrupt:
                if paths or last_status != "ok":
                    results.append(
                        CaptureResult(
                            trial=trial,
                            csv_paths=paths,
                            capture_status="ok" if paths else last_status,
                            measured_fps=cam.measured_fps,
                            n_frames=n_frames,
                            error=last_error,
                            show_started=show_started,
                            baseline_frame_range=last_baseline,
                        )
                    )
                print("\ninterrupted — keeping completed captures")
                return results
            results.append(
                CaptureResult(
                    trial=trial,
                    csv_paths=paths,
                    capture_status="ok" if paths else last_status,
                    measured_fps=cam.measured_fps,
                    n_frames=n_frames,
                    error=last_error,
                    show_started=show_started,
                    baseline_frame_range=last_baseline,
                )
            )
            if i + 1 < n:
                time.sleep(gap_seconds)
    return results


def parse_capture_stem(stem: str, row_id_safe: str) -> tuple[str, int | None]:
    """Return (zone_name, repeat_index) from a capture filename stem."""
    if stem == row_id_safe:
        return "all", None
    prefix = row_id_safe + "__"
    if not stem.startswith(prefix):
        return "all", None
    rest = stem[len(prefix):]
    parts = rest.split("__")
    zone = "all"
    rep = None
    if parts and parts[-1].startswith("r") and parts[-1][1:].isdigit():
        rep = int(parts[-1][1:])
        parts = parts[:-1]
    if parts:
        zone = parts[0]
    return zone, rep


def find_capture_csvs(captures_dir: Path, trial: TrialRow) -> list[Path]:
    """Match per-zone CSVs, plus legacy single-file names from the original spec."""
    folder = captures_dir / trial.sheet_safe
    source_safe = fs_safe(trial.capture_source_row_id or trial.row_id)
    keys = {trial.row_id_safe, source_safe}
    found: list[Path] = []
    search_dirs = [folder] if folder.is_dir() else []
    if not search_dirs or source_safe != trial.row_id_safe:
        search_dirs = list(captures_dir.glob("*")) if captures_dir.is_dir() else []
    for d in search_dirs:
        if not d.is_dir():
            continue
        for p in d.glob("*.csv"):
            for key in keys:
                if p.stem == key or p.stem.startswith(key + "__"):
                    found.append(p)
                    break
    return _dedupe_paths(sorted(found))


def _dedupe_paths(paths: list[Path]) -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for p in paths:
        rp = p.resolve()
        if rp in seen:
            continue
        seen.add(rp)
        out.append(p)
    return out
