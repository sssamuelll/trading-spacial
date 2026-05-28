#!/usr/bin/env python3
"""
Walk-Forward — Time-anchored cross-validation harness for the trading portfolio.

Scaffold for issue #276. This module computes train/test windows for
walk-forward evaluation while guaranteeing:

  - Test ranges never overlap each other.
  - No window touches the locked holdout (start <= holdout_start).
  - A configurable warmup gap separates train_end from test_start
    (avoids leakage from indicators that look back across the boundary).
  - Anchored mode pins every train_start to history_start
    (expanding window). Rolling mode is not in this commit.

Usage (CLI is a placeholder — no strategy execution yet):
    python walk_forward.py --history-start 2023-01-01 \
                           --history-end 2025-12-31 \
                           --holdout-start 2026-01-01 \
                           --initial-train-months 12 \
                           --test-months 3 \
                           --step-months 3 \
                           --dry-run

The CLI currently only prints the computed windows. The execution
path (running the strategy on each fold) is intentionally not wired
up — see issue #276 for the staged rollout.
"""

from __future__ import annotations

import argparse
import logging
import sys
from dataclasses import dataclass, asdict
from datetime import date, datetime
from typing import Iterable

from dateutil.relativedelta import relativedelta

log = logging.getLogger("walk_forward")


# --------------------------------------------------------------------------- #
# Warmup bar accounting
# --------------------------------------------------------------------------- #
#
# The walk-forward harness must hand each fold enough leading history to let
# every indicator on the active scanner/strategy path reach a stable value
# before the test window begins. The lookbacks below are sourced directly
# from `strategy/constants.py` and the per-TF call sites in `strategy/core.py`,
# `strategy/regime.py`, `strategy/patterns.py`, `backtest.py`, and
# `strategies/trend_following*.py`. Re-verify the table whenever a new
# indicator joins the active path or a period constant changes.
#
# Per-TF active indicator lookbacks (commit 2 of #276):
#
# Scope note: this table tracks **compute-warmup** — the bars an indicator
# needs to produce a non-NaN value. It is a property of the indicator, not
# of the downstream decision path. An indicator that is computed but whose
# output is feature-gated (only consumed when a flag is on) still drives
# warmup, because the computation runs on every bar regardless.
#
#   4h: SMA100 (strategy/core.py:576, strategies/trend_following*.py)
#       → max = 100
#
#   1h: LRC100 (constants.LRC_PERIOD),
#       SMA10/20 (always), SMA50/200 (computed unconditionally; downstream
#       use is feature-gated by `trend_pullback_enabled` — see core.py:546-559),
#       BB20 (constants.BB_PERIOD), RSI14 (constants.RSI_PERIOD),
#       ATR14 (constants.ATR_PERIOD), ADX14 (core.py:566), VOL20
#       → max = 200 (SMA200 1h is computed every bar; its value is exposed
#         in `decision.indicators` regardless of `trend_pullback_enabled`)
#
#   5m: RSI14 (patterns.py:92,116), BB20 (constants.BB_PERIOD), VOL20
#       → max = 20
#
# The daily SMA200 in strategy/regime.py operates on a separate 1d frame
# fetched independently inside `detect_regime()` via `md.get_klines(..., '1d',
# limit=250)`. It is not driven from the fold's OHLCV TF, so it does not
# enlarge the per-TF warmup. If that ever changes, fold it into the table.

_INDICATOR_LOOKBACKS_BY_TF: dict[str, int] = {
    "4h": 100,   # SMA100 on 4h close
    "1h": 200,   # SMA200 1h computed unconditionally (use is feature-gated)
    "5m": 20,    # BB20 / VOL20 dominate; RSI14 / ATR14 trail
}


def compute_warmup_bars(timeframe: str) -> int:
    """Return the **compute-warmup** bars required for every indicator the
    system computes on ``timeframe``.

    "Warmup" is three distinct things this flat signature does not separate.
    This function answers (1) only:

      1. **Compute-warmup** — bars needed for the indicator to produce a
         non-NaN value. Property of the indicator. Deterministic. This is
         what this function returns: the max over indicators the system
         *computes* on the TF, regardless of whether their output is then
         consumed by the decision path.
      2. **Use-warmup** — bars needed for the indicator's output to influence
         a decision. Property of the path; depends on feature flags / regime.
         Not modelled here. An indicator computed-but-not-used still drives
         this function's return value, because computation runs every bar.
      3. **Determinism-warmup** — bars needed for the harness to produce
         reproducible results across reruns. Property of the contract.
         Out of scope.

    Callers should prepend at least this many bars before the test window
    so the first scored bar is not contaminated by indicator initialisation
    noise.

    Args:
        timeframe: One of ``'4h'``, ``'1h'``, ``'5m'``.

    Returns:
        Positive int. Always ``>= max(lookback_for_tf)`` declared above.

    Raises:
        ValueError: If ``timeframe`` is not a recognised active TF.
    """
    if not isinstance(timeframe, str):
        raise ValueError(
            f"timeframe must be str, got {type(timeframe).__name__}"
        )
    key = timeframe.lower().strip()
    if key not in _INDICATOR_LOOKBACKS_BY_TF:
        supported = ", ".join(sorted(_INDICATOR_LOOKBACKS_BY_TF))
        raise ValueError(
            f"Unsupported timeframe {timeframe!r}. Active TFs: {supported}."
        )
    return _INDICATOR_LOOKBACKS_BY_TF[key]


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Window:
    """A single walk-forward fold.

    All boundaries are inclusive on the start side, exclusive on the end
    side ([train_start, train_end), [test_start, test_end)), which matches
    the half-open convention used elsewhere in the project.

    `warmup_gap_days` records the gap actually applied between train_end
    and test_start so callers can audit fold construction.
    """

    index: int
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    warmup_gap_days: int

    def as_dict(self) -> dict:
        d = asdict(self)
        for k in ("train_start", "train_end", "test_start", "test_end"):
            d[k] = d[k].isoformat()
        return d


# --------------------------------------------------------------------------- #
# Window computation
# --------------------------------------------------------------------------- #


def _coerce_date(value) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        return datetime.strptime(value, "%Y-%m-%d").date()
    raise TypeError(f"Cannot coerce {value!r} ({type(value).__name__}) to date")


def compute_windows(
    history_start,
    history_end,
    holdout_start,
    initial_train_months: int,
    test_months: int,
    step_months: int,
    warmup_gap_days: int = 0,
    anchored: bool = True,
) -> list[Window]:
    """Compute the list of walk-forward folds.

    Properties guaranteed (covered by tests/test_walk_forward_windows.py):
      - Anchored: every window.train_start == history_start.
      - Non-overlap: test ranges of consecutive windows are disjoint.
      - Holdout exclusion: window.test_end <= holdout_start for every fold.
      - Warmup gap: test_start - train_end >= warmup_gap_days for every fold.

    Args:
        history_start: First date available for training (inclusive).
        history_end:   Last date available for testing  (exclusive upper bound).
        holdout_start: Start of the locked holdout. No window may touch it.
        initial_train_months: Length of the first training span.
        test_months:   Length of each test span.
        step_months:   Stride between consecutive folds.
        warmup_gap_days: Minimum gap between train_end and test_start.
        anchored:      If True, every fold pins train_start to history_start.

    Returns:
        Ordered list of Window dataclasses. May be empty if no fold fits.
    """
    if initial_train_months <= 0:
        raise ValueError("initial_train_months must be > 0")
    if test_months <= 0:
        raise ValueError("test_months must be > 0")
    if step_months <= 0:
        raise ValueError("step_months must be > 0")
    if warmup_gap_days < 0:
        raise ValueError("warmup_gap_days must be >= 0")
    if not anchored:
        # Rolling mode deliberately deferred. Re-open #276 when needed.
        raise NotImplementedError("Rolling (non-anchored) mode not implemented yet")

    history_start = _coerce_date(history_start)
    history_end = _coerce_date(history_end)
    holdout_start = _coerce_date(holdout_start)

    if history_end > holdout_start:
        # Clip the usable history at the holdout edge — never peek across.
        history_end = holdout_start
    if history_start >= history_end:
        return []

    windows: list[Window] = []
    fold = 0
    # Train span advances by `step_months` per fold in anchored mode by
    # extending train_end, not train_start.
    while True:
        train_end = history_start + relativedelta(
            months=initial_train_months + step_months * fold
        )
        test_start = train_end + relativedelta(days=warmup_gap_days)
        test_end = test_start + relativedelta(months=test_months)

        if test_end > history_end:
            break
        if test_end > holdout_start:
            break

        windows.append(
            Window(
                index=fold,
                train_start=history_start,
                train_end=train_end,
                test_start=test_start,
                test_end=test_end,
                warmup_gap_days=warmup_gap_days,
            )
        )
        fold += 1

    return windows


# --------------------------------------------------------------------------- #
# CLI (placeholder — no strategy execution yet)
# --------------------------------------------------------------------------- #


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="walk_forward",
        description="Walk-forward harness (scaffold — see #276).",
    )
    p.add_argument("--history-start", required=True, help="YYYY-MM-DD")
    p.add_argument("--history-end", required=True, help="YYYY-MM-DD")
    p.add_argument("--holdout-start", required=True, help="YYYY-MM-DD")
    p.add_argument("--initial-train-months", type=int, default=12)
    p.add_argument("--test-months", type=int, default=3)
    p.add_argument("--step-months", type=int, default=3)
    p.add_argument("--warmup-gap-days", type=int, default=0)
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print computed windows and exit. Currently the only mode.",
    )
    return p


def _print_windows(windows: Iterable[Window]) -> None:
    for w in windows:
        print(
            f"[{w.index:02d}] train {w.train_start}..{w.train_end}  "
            f"test {w.test_start}..{w.test_end}  "
            f"(warmup={w.warmup_gap_days}d)"
        )


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s"
    )
    args = _build_arg_parser().parse_args(argv)

    windows = compute_windows(
        history_start=args.history_start,
        history_end=args.history_end,
        holdout_start=args.holdout_start,
        initial_train_months=args.initial_train_months,
        test_months=args.test_months,
        step_months=args.step_months,
        warmup_gap_days=args.warmup_gap_days,
    )

    if not windows:
        log.warning("No windows fit the requested configuration.")
        return 1

    _print_windows(windows)

    if not args.dry_run:
        log.warning(
            "Execution path not implemented yet — see #276. "
            "Re-run with --dry-run to silence this warning."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
