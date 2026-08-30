"""Webcam capture: ROI picker, exposure lock, per-trial CSV writer."""

from __future__ import annotations

import csv
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


class Camera:
    def __init__(self, device_index: int = 0, target_fps: float | None = None):
        self.device_index = device_index
        self.target_fps = target_fps
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
    """Live preview; SPACE freezes a frame and opens cv2.selectROI."""
    cv2 = _cv2()
    with Camera(device_index) as cam:
        assert cam.cap is not None
        print("Live preview: press SPACE to freeze and drag an ROI, or Q to cancel.")
        frozen = None
        while True:
            frame = cam.grab()
            if frame is None:
                raise CameraError("camera returned no frames")
            preview = frame.copy()
            cv2.putText(
                preview,
                "SPACE=select ROI  Q=quit",
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
                frozen = frame
                break
        cv2.destroyWindow("wave-classifier preview")
        x, y, w, h = cv2.selectROI("Select LED ROI", frozen, showCrosshair=True, fromCenter=False)
        cv2.destroyAllWindows()
        if w <= 0 or h <= 0:
            raise CameraError("empty ROI — drag a rectangle around the lit patch")
        roi = (int(x), int(y), int(w), int(h))
        print(f"saved ROI: x={roi[0]} y={roi[1]} w={roi[2]} h={roi[3]}")
        return roi


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


def capture_file_path(captures_dir: Path, trial: TrialRow, repeat_index: int | None = None) -> Path:
    name = trial.row_id_safe if repeat_index is None else f"{trial.row_id_safe}__r{repeat_index}"
    return captures_dir / trial.sheet_safe / f"{name}.csv"


def _grab_until(
    cam: Camera,
    roi: tuple[int, int, int, int],
    duration_ms: float,
) -> list[tuple[float, float, float, float]]:
    samples: list[tuple[float, float, float, float]] = []
    start = time.monotonic()
    deadline = start + duration_ms / 1000.0
    while time.monotonic() < deadline:
        frame = cam.grab()
        now = time.monotonic()
        if frame is None:
            continue
        r, g, b = _mean_rgb(frame, roi)
        samples.append(((now - start) * 1000.0, r, g, b))
    return samples


def capture_trial(
    cam: Camera,
    session,
    trial: TrialRow,
    *,
    captures_dir: Path,
    roi: tuple[int, int, int, int],
    hold_ms: int,
    settle_margin_ms: int,
    repeat_index: int | None = None,
) -> tuple[Path | None, str, int, bool, str | None]:
    from .wandsim_client import WandSimError, show_single, stop, wait_show_started

    path = capture_file_path(captures_dir, trial, repeat_index)
    show_started = False
    try:
        stop(session.base_url)
        show_single(session.base_url, trial.hex_full, hold_ms)
        show_started = wait_show_started(session.base_url)
        samples = _grab_until(cam, roi, hold_ms + settle_margin_ms)
    except WandSimError as exc:
        return None, "wandsim_error", 0, False, str(exc)
    except CameraError as exc:
        return None, "camera_error", 0, False, str(exc)
    finally:
        try:
            stop(session.base_url)
        except Exception:
            pass

    if len(samples) < 8:
        return None, "too_few_frames", len(samples), show_started, f"only {len(samples)} frames"
    write_samples_csv(path, samples)
    if cam.measured_fps is None and samples:
        elapsed = (samples[-1][0] - samples[0][0]) / 1000.0
        if elapsed > 0:
            cam.measured_fps = (len(samples) - 1) / elapsed
    note = None if show_started else "showActive never confirmed; captured anyway (steps=1)"
    return path, "ok", len(samples), show_started, note


def run_captures(
    trial_rows: list[TrialRow],
    *,
    base_url: str,
    captures_dir: Path,
    device_index: int,
    roi,
    hold_ms: int,
    settle_margin_ms: int,
    gap_seconds: float,
    repeats: int,
    target_fps: float | None = None,
    on_trial: Callable[[int, int, TrialRow], None] | None = None,
) -> list[CaptureResult]:
    from .wandsim_client import WandSimSession

    roi_t = _roi_tuple(roi)
    results: list[CaptureResult] = []
    n = len(trial_rows)
    with Camera(device_index, target_fps=target_fps) as cam, WandSimSession(base_url) as session:
        if cam.measured_fps is None:
            # One short grab to log fps before the first /show.
            probe = _grab_until(cam, roi_t, 400)
            if len(probe) >= 2:
                elapsed = (probe[-1][0] - probe[0][0]) / 1000.0
                if elapsed > 0:
                    cam.measured_fps = (len(probe) - 1) / elapsed
                    print(f"measured fps: {cam.measured_fps:.1f}")
        for i, trial in enumerate(trial_rows):
            if on_trial:
                on_trial(i, n, trial)
            paths: list[Path] = []
            n_frames: list[int] = []
            last_status = "ok"
            last_error = None
            show_started = False
            try:
                for r in range(repeats):
                    repeat_index = r if repeats > 1 else None
                    path, status, frames, started, err = capture_trial(
                        cam,
                        session,
                        trial,
                        captures_dir=captures_dir,
                        roi=roi_t,
                        hold_ms=hold_ms,
                        settle_margin_ms=settle_margin_ms,
                        repeat_index=repeat_index,
                    )
                    last_status = status
                    last_error = err
                    show_started = show_started or started
                    n_frames.append(frames)
                    if path is not None:
                        paths.append(path)
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
                )
            )
            if i + 1 < n:
                time.sleep(gap_seconds)
    return results


def find_capture_csvs(captures_dir: Path, trial: TrialRow) -> list[Path]:
    """Match `row_id.csv` and `row_id__rN.csv` for report-only."""
    folder = captures_dir / trial.sheet_safe
    if not folder.is_dir():
        # Duplicates may have been captured under the first sheet's folder.
        if trial.capture_source_row_id and trial.capture_source_row_id != trial.row_id:
            source_safe = fs_safe(trial.capture_source_row_id)
            found = sorted(captures_dir.glob(f"*/{source_safe}.csv")) + sorted(
                captures_dir.glob(f"*/{source_safe}__r*.csv")
            )
            return _dedupe_paths(found)
        return []
    single = folder / f"{trial.row_id_safe}.csv"
    repeats = sorted(folder.glob(f"{trial.row_id_safe}__r*.csv"))
    if repeats:
        return repeats
    if single.is_file():
        return [single]
    if trial.capture_source_row_id and trial.capture_source_row_id != trial.row_id:
        source_safe = fs_safe(trial.capture_source_row_id)
        found = sorted(captures_dir.glob(f"*/{source_safe}.csv")) + sorted(
            captures_dir.glob(f"*/{source_safe}__r*.csv")
        )
        return _dedupe_paths(found)
    return []


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
