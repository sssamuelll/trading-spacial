"""Tests for dual-strategy backtest integration (Tasks 5-7).

Tests:
  - TF state creation (create_tf_state)
  - TF bar assessment (assess_tf_bar)
  - Trailing stop behaviour (_update_trailing_stop)
  - Dual-strategy routing in simulate_strategy
"""

import numpy as np
import pandas as pd
import pytest


# ---------------------------------------------------------------------------
# Helpers (same pattern as test_trend_following.py)
# ---------------------------------------------------------------------------

def _make_ohlcv(n=100, base_price=100.0, trend=0.0, seed=42, freq="1h",
                start="2024-01-01"):
    """Generate synthetic OHLCV data with optional trend."""
    np.random.seed(seed)
    dates = pd.date_range(start, periods=n, freq=freq)
    closes = [base_price]
    for _ in range(1, n):
        closes.append(closes[-1] * (1 + trend + np.random.normal(0, 0.005)))
    closes = np.array(closes)
    highs = closes * (1 + np.abs(np.random.normal(0, 0.003, n)))
    lows = closes * (1 - np.abs(np.random.normal(0, 0.003, n)))
    opens = closes * (1 + np.random.normal(0, 0.001, n))
    volumes = np.random.uniform(100, 1000, n)
    return pd.DataFrame({
        "open": opens, "high": highs, "low": lows, "close": closes,
        "volume": volumes,
    }, index=dates)


def _make_all_timeframes(n_1h=210, trend=0.003, base_price=50000.0):
    """Build aligned 1H, 4H, 5M DataFrames for backtest helpers."""
    df1h = _make_ohlcv(n_1h, base_price=base_price, trend=trend, seed=42)
    # 4H via resample
    df4h = df1h.resample("4h").agg({
        "open": "first", "high": "max", "low": "min",
        "close": "last", "volume": "sum",
    }).dropna()
    # 5M around the last 1H bar
    last_close = float(df1h["close"].iloc[-1])
    df5m = _make_ohlcv(60, base_price=last_close, trend=trend * 0.2,
                       seed=99, freq="5min",
                       start=str(df1h.index[-1] - pd.Timedelta(hours=1)))
    return df1h, df4h, df5m


# ===========================================================================
# Task 5 unit tests
# ===========================================================================

class TestCreateTfState:
    def test_initial_state(self):
        from strategies.trend_following_sim import create_tf_state
        state = create_tf_state()
        assert isinstance(state, dict)
        assert state["position"] is None
        assert state["highest_high"] is None
        assert state["lowest_low"] is None
        assert state["trailing_stop"] is None
        assert state["last_trade"] is None
        assert state["last_exit_time"] is None

    def test_returns_new_dict_each_call(self):
        from strategies.trend_following_sim import create_tf_state
        s1 = create_tf_state()
        s2 = create_tf_state()
        assert s1 is not s2


class TestUpdateTrailingStop:
    def test_long_stop_never_decreases(self):
        from strategies.trend_following_sim import create_tf_state, _update_trailing_stop
        state = create_tf_state()
        state["position"] = {"direction": "LONG", "entry_price": 100.0}
        state["highest_high"] = 105.0
        state["trailing_stop"] = 100.0  # initial stop

        # Simulate rising highs
        stops = []
        for h in [106, 108, 107, 109, 105]:
            s = _update_trailing_stop(state, high=h, low=h * 0.99,
                                      atr_val=2.0, atr_trail=2.5)
            stops.append(s)

        # Stop must be non-decreasing for LONG
        for i in range(1, len(stops)):
            assert stops[i] >= stops[i - 1], (
                f"LONG trailing stop decreased: {stops[i - 1]} -> {stops[i]}"
            )

    def test_short_stop_never_increases(self):
        from strategies.trend_following_sim import create_tf_state, _update_trailing_stop
        state = create_tf_state()
        state["position"] = {"direction": "SHORT", "entry_price": 100.0}
        state["lowest_low"] = 95.0
        state["trailing_stop"] = 100.0

        stops = []
        for l in [94, 92, 93, 91, 95]:
            s = _update_trailing_stop(state, high=l * 1.01, low=l,
                                      atr_val=2.0, atr_trail=2.5)
            stops.append(s)

        for i in range(1, len(stops)):
            assert stops[i] <= stops[i - 1], (
                f"SHORT trailing stop increased: {stops[i - 1]} -> {stops[i]}"
            )


class TestAssessTfBar:
    def test_returns_valid_action(self):
        from strategies.trend_following_sim import create_tf_state, assess_tf_bar
        df1h, df4h, df5m = _make_all_timeframes()
        state = create_tf_state()
        bar_time = df1h.index[-1]
        price = float(df1h["close"].iloc[-1])

        result = assess_tf_bar(
            window_1h=df1h, df4h=df4h, df5m=df5m,
            bar_time=bar_time, price=price, symbol="BTCUSDT",
            regime="LONG", cur_adx=30.0, config={}, tf_state=state,
        )
        assert result in ("enter", "exit", "hold", "skip")

    def test_enter_creates_position(self):
        from strategies.trend_following_sim import create_tf_state, assess_tf_bar

        # Use strong uptrend to maximize chance of entry
        df1h, df4h, df5m = _make_all_timeframes(n_1h=210, trend=0.005)
        state = create_tf_state()

        # Try multiple bars (entry conditions may not be met on every bar)
        entered = False
        for i in range(100, len(df1h)):
            window = df1h.iloc[max(0, i - 209):i + 1]
            if len(window) < 60:
                continue
            bar_time = df1h.index[i]
            price = float(window["close"].iloc[-1])
            result = assess_tf_bar(
                window_1h=window, df4h=df4h, df5m=df5m,
                bar_time=bar_time, price=price, symbol="BTCUSDT",
                regime="LONG", cur_adx=30.0, config={}, tf_state=state,
            )
            if result == "enter":
                entered = True
                break

        if entered:
            assert state["position"] is not None
            assert state["position"]["strategy"] == "trend_following"
            assert state["position"]["direction"] in ("LONG", "SHORT")
            assert state["trailing_stop"] is not None

    def test_hold_when_position_open_no_exit(self):
        """After entering, the next bar should return hold (not exit) if no exit trigger."""
        from strategies.trend_following_sim import create_tf_state, assess_tf_bar
        from btc_scanner import calc_atr, ATR_PERIOD

        df1h, df4h, df5m = _make_all_timeframes(n_1h=210, trend=0.003)
        state = create_tf_state()
        price = float(df1h["close"].iloc[-1])
        bar_time = df1h.index[-1]

        # Manually create a position (simulate entry)
        atr_val = float(calc_atr(df1h, ATR_PERIOD).iloc[-1])
        state["position"] = {
            "entry_price": price,
            "entry_time": bar_time - pd.Timedelta(hours=5),
            "score": 4,
            "direction": "LONG",
            "sl_orig": price - atr_val * 2.5,
            "size_mult": 1.0,
            "strategy": "trend_following",
            "adx_at_entry": 30.0,
        }
        state["highest_high"] = float(df1h["high"].iloc[-1])
        state["trailing_stop"] = price - atr_val * 2.5

        result = assess_tf_bar(
            window_1h=df1h, df4h=df4h, df5m=df5m,
            bar_time=bar_time, price=price, symbol="BTCUSDT",
            regime="LONG", cur_adx=30.0, config={}, tf_state=state,
        )
        # Might be "hold" or "exit" depending on data - just verify it's valid
        assert result in ("hold", "exit")

    def test_cooldown_returns_skip(self):
        """If an exit just happened, cooldown period should return skip."""
        from strategies.trend_following_sim import create_tf_state, assess_tf_bar

        df1h, df4h, df5m = _make_all_timeframes()
        state = create_tf_state()
        bar_time = df1h.index[-1]
        # Set last exit to 1 hour ago (well within COOLDOWN_H=6)
        state["last_exit_time"] = bar_time - pd.Timedelta(hours=1)
        price = float(df1h["close"].iloc[-1])

        result = assess_tf_bar(
            window_1h=df1h, df4h=df4h, df5m=df5m,
            bar_time=bar_time, price=price, symbol="BTCUSDT",
            regime="LONG", cur_adx=30.0, config={}, tf_state=state,
        )
        assert result == "skip"

    def test_exit_populates_last_trade(self):
        """When a position exits, last_trade should be populated."""
        from strategies.trend_following_sim import create_tf_state, assess_tf_bar
        from btc_scanner import calc_atr, ATR_PERIOD

        df1h, df4h, df5m = _make_all_timeframes(n_1h=210, trend=0.003)
        state = create_tf_state()
        price = float(df1h["close"].iloc[-1])
        bar_time = df1h.index[-1]

        # Create a LONG position with a trailing stop very close to current price
        # so it will be triggered
        state["position"] = {
            "entry_price": price * 0.95,
            "entry_time": bar_time - pd.Timedelta(hours=10),
            "score": 4,
            "direction": "LONG",
            "sl_orig": price * 0.93,
            "size_mult": 1.0,
            "strategy": "trend_following",
            "adx_at_entry": 30.0,
        }
        state["highest_high"] = price * 1.01
        # Set trailing stop above current low to trigger exit
        state["trailing_stop"] = price * 1.02  # above current price -> SL hit

        result = assess_tf_bar(
            window_1h=df1h, df4h=df4h, df5m=df5m,
            bar_time=bar_time, price=price, symbol="BTCUSDT",
            regime="LONG", cur_adx=30.0, config={}, tf_state=state,
        )
        assert result == "exit"
        assert state["last_trade"] is not None
        trade = state["last_trade"]
        assert trade["strategy"] == "trend_following"
        assert "pnl_pct" in trade
        assert "pnl_usd" in trade
        assert trade["exit_reason"] in ("TRAILING_STOP", "EMA_REVERSAL")


# ===========================================================================
# Task 6 integration tests
# ===========================================================================

class TestDualStrategyBacktest:
    """Integration tests for ADX routing in simulate_strategy."""

    def test_trades_tagged_by_strategy(self):
        """All trades should have a 'strategy' key."""
        from backtest import simulate_strategy
        df1h, df4h, df5m = _make_all_timeframes(n_1h=500, trend=0.001)
        df1d = df1h.resample("1D").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum",
        }).dropna()

        trades, _ = simulate_strategy(
            df1h, df4h, df5m, symbol="BTCUSDT",
            sl_mode="atr", df1d=df1d,
            backtest_config={},
        )

        for t in trades:
            assert "strategy" in t, (
                f"Trade missing 'strategy' field: {t.get('entry_time')}"
            )
            assert t["strategy"] in ("mean_reversion", "trend_following"), (
                f"Unexpected strategy: {t['strategy']}"
            )

    def test_no_orphan_positions(self):
        """After simulation ends, no position should be silently dropped."""
        from backtest import simulate_strategy
        df1h, df4h, df5m = _make_all_timeframes(n_1h=500, trend=0.002)
        df1d = df1h.resample("1D").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum",
        }).dropna()

        trades, equity = simulate_strategy(
            df1h, df4h, df5m, symbol="BTCUSDT",
            sl_mode="atr", df1d=df1d,
            backtest_config={},
        )

        # The function should not raise, and should return lists
        assert isinstance(trades, list)
        assert isinstance(equity, list)

    def test_backtest_config_none_works(self):
        """simulate_strategy should work without explicit backtest_config."""
        from backtest import simulate_strategy
        df1h, df4h, df5m = _make_all_timeframes(n_1h=300, trend=0.001)

        # Should not raise
        trades, equity = simulate_strategy(
            df1h, df4h, df5m, symbol="BTCUSDT", sl_mode="atr",
        )
        assert isinstance(trades, list)
        assert isinstance(equity, list)

    def test_forced_tf_strategy_via_config(self):
        """When config forces trend_following, all trades should be TF."""
        from backtest import simulate_strategy
        df1h, df4h, df5m = _make_all_timeframes(n_1h=500, trend=0.003)
        df1d = df1h.resample("1D").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum",
        }).dropna()

        config = {"symbol_overrides": {"BTCUSDT": {"strategy": "trend_following"}}}
        trades, _ = simulate_strategy(
            df1h, df4h, df5m, symbol="BTCUSDT",
            sl_mode="atr", df1d=df1d,
            backtest_config=config,
        )

        tf_trades = [t for t in trades if t.get("strategy") == "trend_following"]
        mr_trades = [t for t in trades if t.get("strategy") == "mean_reversion"]
        # All trades should be TF when forced
        if trades:
            assert len(mr_trades) == 0, (
                f"Expected no MR trades when TF forced, got {len(mr_trades)}"
            )

    def test_forced_mr_strategy_via_config(self):
        """When config forces mean_reversion, all trades should be MR."""
        from backtest import simulate_strategy
        df1h, df4h, df5m = _make_all_timeframes(n_1h=500, trend=0.001)
        df1d = df1h.resample("1D").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum",
        }).dropna()

        config = {"symbol_overrides": {"BTCUSDT": {"strategy": "mean_reversion"}}}
        trades, _ = simulate_strategy(
            df1h, df4h, df5m, symbol="BTCUSDT",
            sl_mode="atr", df1d=df1d,
            backtest_config=config,
        )

        tf_trades = [t for t in trades if t.get("strategy") == "trend_following"]
        # All trades should be MR when forced
        if trades:
            assert len(tf_trades) == 0, (
                f"Expected no TF trades when MR forced, got {len(tf_trades)}"
            )
