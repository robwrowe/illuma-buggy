"""Thin HTTP client for firmware/WandSimulator (see firmware/WandSimulator/API.md).

Prefer POST /show with the full advertisement hex (8301 prefix included) — that
is the capture-file convention and avoids the off-by-one prefix bug /send hex
is known for. /show returns immediately; playback is asynchronous. Do not
parallelize requests to one board.
"""

from __future__ import annotations

import re
import time
from typing import Any

import requests

STATUS_TIMEOUT_S = 2.0
STOP_TIMEOUT_S = 3.0
SHOW_POLL_S = 1.5
SHOW_POLL_INTERVAL_S = 0.05
SHOW_POST_TIMEOUT_S = 8.0  # /show returns immediately — not hold_ms
CONNECT_TIMEOUT_S = 3.0


def _request_timeout(read_s: float = STATUS_TIMEOUT_S) -> tuple[float, float]:
    return (CONNECT_TIMEOUT_S, read_s)


class WandSimError(Exception):
    def __init__(self, message: str, payload: Any = None):
        super().__init__(message)
        self.payload = payload


def _join(base_url: str, path: str) -> str:
    return base_url.rstrip("/") + path


def compact_hex(hex_full: str) -> str:
    return re.sub(r"[^0-9a-fA-F]", "", hex_full)


def get_status(base_url: str, timeout: float = STATUS_TIMEOUT_S) -> dict[str, Any]:
    resp = requests.get(_join(base_url, "/status"), timeout=_request_timeout(timeout))
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict):
        raise WandSimError(f"/status returned non-object: {data!r}", data)
    return data


def stop(base_url: str, timeout: float = STOP_TIMEOUT_S) -> dict[str, Any]:
    resp = requests.post(_join(base_url, "/stop"), timeout=_request_timeout(timeout))
    resp.raise_for_status()
    data = resp.json() if resp.content else {"ok": True}
    if isinstance(data, dict) and data.get("ok") is False:
        raise WandSimError(f"/stop failed: {data}", data)
    return data if isinstance(data, dict) else {"ok": True, "raw": data}


def show_single(base_url: str, hex_full: str, hold_ms: int) -> dict[str, Any]:
    """POST /show with a single `<holdMs> <hex>` line. Full hex, 8301 included.

    /show returns immediately; playback is async on the board. HTTP timeout is
    only for the round-trip (not hold_ms).
    """
    hex_compact = compact_hex(hex_full)
    if not hex_compact:
        raise WandSimError("empty hex; nothing to send")
    body = f"{int(hold_ms)} {hex_compact}"
    resp = requests.post(
        _join(base_url, "/show"),
        data=body.encode("utf-8"),
        headers={"Content-Type": "text/plain"},
        timeout=_request_timeout(SHOW_POST_TIMEOUT_S),
    )
    if resp.status_code >= 400:
        try:
            payload = resp.json()
        except ValueError:
            payload = {"text": resp.text}
        raise WandSimError(
            f"/show HTTP {resp.status_code}: {payload}",
            payload,
        )
    data = resp.json()
    if not isinstance(data, dict):
        raise WandSimError(f"/show returned non-object: {data!r}", data)
    if not data.get("ok"):
        raise WandSimError(f"/show rejected: {data}", data)
    steps = data.get("steps")
    if steps != 1:
        raise WandSimError(
            f"/show parsed {steps!r} steps, expected 1 "
            "(malformed hex is dropped silently — check compact hex)",
            data,
        )
    return data


def send_black_flash(base_url: str, duration_ms: int = 150) -> dict[str, Any]:
    """POST /show an E9 all-black solid (palette 29). `stop()` is not a zero-point.

    duration_ms should be short — this is a reference edge, not a trial. Caller
    should warn when measured_fps * (duration_ms/1000) < 2 (fewer than two frames).
    """
    from .payload_builder import build_solid_palette_payload

    ms = max(1, int(duration_ms))
    built = build_solid_palette_payload(29)
    return show_single(base_url, built.hex_full, ms)


def ping_wandsim(base_url: str, timeout: float = 5.0) -> dict[str, Any]:
    """GET /status — fail fast with a clear error if the board is unreachable."""
    st = get_status(base_url, timeout=timeout)
    if not st.get("ok", True):
        raise WandSimError(f"WandSimulator /status not ok: {st!r}", st)
    return st


def wait_show_started(base_url: str, timeout_s: float = SHOW_POLL_S) -> bool:
    """Poll GET /status until showActive, or timeout. Returns whether it started."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            status = get_status(base_url)
        except (requests.RequestException, ValueError, WandSimError):
            time.sleep(SHOW_POLL_INTERVAL_S)
            continue
        if status.get("showActive"):
            return True
        time.sleep(SHOW_POLL_INTERVAL_S)
    return False


def wait_show_idle(base_url: str, timeout_s: float = SHOW_POLL_S) -> bool:
    """Poll GET /status until showActive is false, or timeout."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            status = get_status(base_url)
        except (requests.RequestException, ValueError, WandSimError):
            time.sleep(SHOW_POLL_INTERVAL_S)
            continue
        if not status.get("showActive"):
            return True
        time.sleep(SHOW_POLL_INTERVAL_S)
    return False


class WandSimSession:
    """Defensive stop() on enter and exit (Ctrl+C / exception)."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def __enter__(self) -> WandSimSession:
        try:
            stop(self.base_url)
        except Exception as exc:  # noqa: BLE001 — connection check
            raise WandSimError(
                f"cannot reach WandSimulator at {self.base_url}: {exc}"
            ) from exc
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is KeyboardInterrupt:
            return
        try:
            stop(self.base_url, timeout=0.75)
        except Exception:
            pass
