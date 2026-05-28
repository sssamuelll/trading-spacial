"""Property tests for `walk_forward.compute_windows`.

Four invariants the harness must guarantee for #276:

  1. Anchored: every window.train_start == history_start.
  2. Non-overlap: consecutive test ranges are disjoint.
  3. Holdout-exclusion: no window's test span touches holdout_start.
  4. Warmup-gap: test_start - train_end >= warmup_gap_days.

These tests are intentionally small and deterministic — no strategy
execution, no data files, no DB. The scaffold passes them and any future
edit to the window math has to keep passing them.
"""

from __future__ import annotations

from datetime import date

import pytest

from walk_forward import Window, compute_windows


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture
def base_config() -> dict:
    """Three-year history, 12-month initial train, 3-month test, 3-month step.

    Yields six folds before bumping against the holdout edge.
    """
    return dict(
        history_start=date(2023, 1, 1),
        history_end=date(2025, 12, 31),
        holdout_start=date(2026, 1, 1),
        initial_train_months=12,
        test_months=3,
        step_months=3,
    )


# --------------------------------------------------------------------------- #
# Property 1: anchored
# --------------------------------------------------------------------------- #


def test_anchored_mode_pins_train_start(base_config):
    windows = compute_windows(**base_config)
    assert len(windows) > 0, "fixture should yield at least one fold"
    for w in windows:
        assert w.train_start == base_config["history_start"], (
            f"window {w.index} train_start={w.train_start} drifted from "
            f"history_start={base_config['history_start']}"
        )


# --------------------------------------------------------------------------- #
# Property 2: non-overlap
# --------------------------------------------------------------------------- #


def test_test_ranges_do_not_overlap(base_config):
    windows = compute_windows(**base_config)
    assert len(windows) >= 2, "need at least two folds to test overlap"
    for prev, curr in zip(windows, windows[1:]):
        assert prev.test_end <= curr.test_start, (
            f"overlap: window {prev.index} test_end={prev.test_end} > "
            f"window {curr.index} test_start={curr.test_start}"
        )


def test_test_ranges_strictly_advance(base_config):
    """Stronger than non-overlap: each test_start is past the previous one."""
    windows = compute_windows(**base_config)
    for prev, curr in zip(windows, windows[1:]):
        assert curr.test_start > prev.test_start
        assert curr.test_end > prev.test_end


# --------------------------------------------------------------------------- #
# Property 3: holdout exclusion
# --------------------------------------------------------------------------- #


def test_no_window_touches_holdout(base_config):
    windows = compute_windows(**base_config)
    for w in windows:
        assert w.test_end <= base_config["holdout_start"], (
            f"window {w.index} test_end={w.test_end} crosses holdout_start="
            f"{base_config['holdout_start']}"
        )
        assert w.train_end <= base_config["holdout_start"]


def test_holdout_clips_history_end(base_config):
    """history_end past holdout_start gets silently clipped to holdout_start."""
    cfg = {**base_config, "history_end": date(2030, 1, 1)}
    windows = compute_windows(**cfg)
    for w in windows:
        assert w.test_end <= base_config["holdout_start"]


def test_holdout_at_history_start_yields_no_folds():
    windows = compute_windows(
        history_start=date(2024, 1, 1),
        history_end=date(2025, 1, 1),
        holdout_start=date(2024, 1, 1),
        initial_train_months=12,
        test_months=3,
        step_months=3,
    )
    assert windows == []


# --------------------------------------------------------------------------- #
# Property 4: warmup gap
# --------------------------------------------------------------------------- #


def test_warmup_gap_zero_default(base_config):
    windows = compute_windows(**base_config)
    for w in windows:
        assert (w.test_start - w.train_end).days == 0
        assert w.warmup_gap_days == 0


def test_warmup_gap_respected_when_positive(base_config):
    gap = 7
    windows = compute_windows(**base_config, warmup_gap_days=gap)
    assert len(windows) > 0
    for w in windows:
        delta_days = (w.test_start - w.train_end).days
        assert delta_days >= gap, (
            f"window {w.index} warmup gap {delta_days}d < requested {gap}d"
        )
        assert w.warmup_gap_days == gap


# --------------------------------------------------------------------------- #
# Sanity / construction tests
# --------------------------------------------------------------------------- #


def test_window_is_frozen_dataclass(base_config):
    windows = compute_windows(**base_config)
    w = windows[0]
    assert isinstance(w, Window)
    with pytest.raises(Exception):
        w.train_start = date(1999, 1, 1)  # type: ignore[misc]


def test_string_dates_accepted():
    windows = compute_windows(
        history_start="2023-01-01",
        history_end="2025-12-31",
        holdout_start="2026-01-01",
        initial_train_months=12,
        test_months=3,
        step_months=3,
    )
    assert all(w.train_start == date(2023, 1, 1) for w in windows)


@pytest.mark.parametrize(
    "kwargs",
    [
        dict(initial_train_months=0),
        dict(test_months=0),
        dict(step_months=0),
        dict(warmup_gap_days=-1),
    ],
)
def test_invalid_arguments_raise(base_config, kwargs):
    cfg = {**base_config, **kwargs}
    with pytest.raises(ValueError):
        compute_windows(**cfg)


def test_rolling_mode_not_implemented(base_config):
    with pytest.raises(NotImplementedError):
        compute_windows(**base_config, anchored=False)
