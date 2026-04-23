"""Pure decision logic — the shared kernel between scanner and backtest (#186 A1).

This module exposes `evaluate_signal(...)`: a PURE function that takes market
data (OHLCV dataframes) and state (cfg, regime, health tier) and returns a
`SignalDecision` describing the trading decision. No I/O, no global mutation,
no network, no DB. Same inputs → same outputs.

Callers (`btc_scanner.scan`, `backtest.simulate_strategy`) handle I/O around
this pure kernel: fetching data, loading config, persisting results, publishing
notifications.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import pandas as pd


@dataclass
class SignalDecision:
    """Return shape of `evaluate_signal()`.

    All fields are Python primitives or simple containers — no numpy scalars,
    no pandas objects. Safe to serialize / compare / dataclass-replace.
    """

    # Core decision
    direction: str = "NONE"          # "LONG" | "SHORT" | "NONE"
    score: int = 0                    # 0-9
    score_label: str = ""             # "MINIMA" | "STANDARD" | "PREMIUM"
    is_signal: bool = False
    is_setup: bool = False

    # Entry/exit prices (None when direction == "NONE")
    entry_price: float | None = None
    sl_price: float | None = None
    tp_price: float | None = None

    # Diagnostics — populated incrementally as evaluate_signal runs.
    reasons: dict[str, Any] = field(default_factory=dict)
    indicators: dict[str, Any] = field(default_factory=dict)
    estado: str = ""                  # human-readable Spanish status


def evaluate_signal(
    df1h: pd.DataFrame,
    df4h: pd.DataFrame,
    df5m: pd.DataFrame,
    df1d: pd.DataFrame,
    symbol: str,
    cfg: dict[str, Any],
    regime: dict[str, Any],
    health_state: str = "NORMAL",
    now: datetime | None = None,
) -> SignalDecision:
    """Pure decision from market data + state.

    Args:
        df1h: 1-hour OHLCV bars (primary signal timeframe).
        df4h: 4-hour OHLCV bars (macro context).
        df5m: 5-minute OHLCV bars (entry trigger).
        df1d: 1-day OHLCV bars (regime context — optional / may be unused).
        symbol: Symbol being evaluated (e.g. "BTCUSDT"). Used for per-symbol
            override resolution in `cfg["symbol_overrides"]`.
        cfg: Config dict (typically the merged `load_config()` result). Reads
            `symbol_overrides` for ATR multipliers.
        regime: Regime detector output shape:
            `{"regime": "BULL"|"BEAR"|"NEUTRAL", "score": float, "details": {}}`
        health_state: Kill-switch tier for this symbol. Currently PAUSED short-
            circuits to NONE; other tiers affect size (handled by caller).
        now: Timestamp context (not currently used inside the pure function;
            reserved for future time-aware checks).

    Returns:
        `SignalDecision` with decision fields populated. Never raises on empty
        data — returns a NONE decision instead.
    """
    # Skeleton (commit A): return NONE decision. Subsequent commits populate
    # indicators, score, direction, entry/SL/TP fields.
    return SignalDecision()
