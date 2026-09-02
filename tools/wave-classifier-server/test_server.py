"""Pending Observe runs + report-path safety (no camera / WandSimulator)."""

from __future__ import annotations

import sys
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent
CLASSIFIER_ROOT = SERVER_DIR.parent / "wave-classifier"
if str(CLASSIFIER_ROOT) not in sys.path:
    sys.path.insert(0, str(CLASSIFIER_ROOT))
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from fastapi import HTTPException  # noqa: E402

from server import (  # noqa: E402
    accumulate_observe_run,
    discard_observe_run,
    safe_report_path,
)


def test_accumulate_pending_then_write():
    pending = {}
    action, acc = accumulate_observe_run(pending, "run-a", 1, 2, ["c1"])
    assert action == "pending"
    assert acc == ["c1"]
    assert pending["run-a"] == ["c1"]
    action, acc = accumulate_observe_run(pending, "run-a", 2, 2, ["c2"])
    assert action == "write"
    assert acc == ["c1", "c2"]
    assert "run-a" not in pending


def test_accumulate_omitted_total_is_last_chunk():
    pending = {}
    action, acc = accumulate_observe_run(pending, "run-b", 1, None, ["only"])
    assert action == "write"
    assert acc == ["only"]
    assert pending == {}


def test_discard_clears_partial_run():
    pending = {}
    accumulate_observe_run(pending, "run-c", 1, 2, ["c1"])
    discard_observe_run(pending, "run-c")
    assert pending == {}
    # later unrelated run_id is a fresh list
    action, acc = accumulate_observe_run(pending, "run-d", 1, 1, ["fresh"])
    assert action == "write"
    assert acc == ["fresh"]


def test_safe_report_path_rejects_traversal(tmp_path: Path):
    (tmp_path / "observe-ok.md").write_text("# hi\n", encoding="utf-8")
    got = safe_report_path("observe-ok.md", reports_dir=tmp_path)
    assert got.name == "observe-ok.md"
    assert got.read_text(encoding="utf-8") == "# hi\n"

    nested = tmp_path / "timeline-x"
    nested.mkdir()
    (nested / "all-ticks.csv").write_text("row_id\n", encoding="utf-8")
    nested_got = safe_report_path("timeline-x/all-ticks.csv", reports_dir=tmp_path)
    assert nested_got.name == "all-ticks.csv"

    for bad in ("../observe-ok.md", "..", "/etc/passwd", "foo/../observe-ok.md", ""):
        try:
            safe_report_path(bad, reports_dir=tmp_path)
            raise AssertionError(f"expected reject for {bad!r}")
        except HTTPException as exc:
            assert exc.status_code in (400, 404)

    try:
        safe_report_path("missing.md", reports_dir=tmp_path)
        raise AssertionError("expected 404")
    except HTTPException as exc:
        assert exc.status_code == 404


def main() -> None:
    from tempfile import TemporaryDirectory

    tests = [
        test_accumulate_pending_then_write,
        test_accumulate_omitted_total_is_last_chunk,
        test_discard_clears_partial_run,
    ]
    for fn in tests:
        fn()
        print("ok ", fn.__name__)
    with TemporaryDirectory() as d:
        test_safe_report_path_rejects_traversal(Path(d))
        print("ok  test_safe_report_path_rejects_traversal")
    print("4 passed")


if __name__ == "__main__":
    main()
