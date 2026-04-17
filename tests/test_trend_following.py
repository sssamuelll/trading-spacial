"""Tests for strategies/trend_following.py — DI components + trend-following signal assessment."""

import numpy as np
import pandas as pd
import pytest


def _make_ohlcv(n=100, base_price=100.0, trend=0.0):
    """Generate synthetic OHLCV data with optional trend."""
    np.random.seed(42)
    dates = pd.date_range("2024-01-01", periods=n, freq="1h")
    closes = [base_price]
    for i in range(1, n):
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


# ---------------------------------------------------------------------------
# Task 2: calc_di_components
# ---------------------------------------------------------------------------

class TestCalcDiComponents:
    def test_returns_two_series(self):
        from strategies.trend_following import calc_di_components
        df = _make_ohlcv(100)
        di_plus, di_minus = calc_di_components(df)
        assert isinstance(di_plus, pd.Series)
        assert isinstance(di_minus, pd.Series)
        assert len(di_plus) == len(df)
        assert len(di_minus) == len(df)

    def test_values_between_0_and_100(self):
        from strategies.trend_following import calc_di_components
        df = _make_ohlcv(200)
        di_plus, di_minus = calc_di_components(df)
        # Drop NaN values at the start, check valid range
        dp = di_plus.dropna()
        dm = di_minus.dropna()
        assert (dp >= 0).all(), f"DI+ has negative values: {dp.min()}"
        assert (dp <= 100).all(), f"DI+ exceeds 100: {dp.max()}"
        assert (dm >= 0).all(), f"DI- has negative values: {dm.min()}"
        assert (dm <= 100).all(), f"DI- exceeds 100: {dm.max()}"

    def test_uptrend_di_plus_greater(self):
        from strategies.trend_following import calc_di_components
        df = _make_ohlcv(200, trend=0.003)
        di_plus, di_minus = calc_di_components(df)
        # In an uptrend, DI+ should be greater than DI- on average (last 50 bars)
        tail_plus = di_plus.iloc[-50:].mean()
        tail_minus = di_minus.iloc[-50:].mean()
        assert tail_plus > tail_minus, (
            f"In uptrend, expected DI+ ({tail_plus:.2f}) > DI- ({tail_minus:.2f})"
        )

    def test_downtrend_di_minus_greater(self):
        from strategies.trend_following import calc_di_components
        df = _make_ohlcv(200, trend=-0.003)
        di_plus, di_minus = calc_di_components(df)
        # In a downtrend, DI- should be greater than DI+ on average (last 50 bars)
        tail_plus = di_plus.iloc[-50:].mean()
        tail_minus = di_minus.iloc[-50:].mean()
        assert tail_minus > tail_plus, (
            f"In downtrend, expected DI- ({tail_minus:.2f}) > DI+ ({tail_plus:.2f})"
        )


# ---------------------------------------------------------------------------
# Task 3: assess_signal
# ---------------------------------------------------------------------------

def _build_assess_args(trend=0.003, regime="LONG", config=None):
    """Helper to build all arguments needed for assess_signal."""
    from strategies.trend_following import calc_di_components
    from btc_scanner import calc_adx

    df1h = _make_ohlcv(200, base_price=100.0, trend=trend)
    # Build 4H by resampling 1H
    df4h = df1h.resample("4h").agg({
        "open": "first", "high": "max", "low": "min",
        "close": "last", "volume": "sum",
    }).dropna()
    df5m = _make_ohlcv(50, base_price=df1h["close"].iloc[-1], trend=trend * 0.2)

    price = float(df1h["close"].iloc[-1])
    adx_series = calc_adx(df1h, 14)
    adx = float(adx_series.iloc[-1]) if not pd.isna(adx_series.iloc[-1]) else 0.0
    di_plus, di_minus = calc_di_components(df1h)
    dp = float(di_plus.iloc[-1]) if not pd.isna(di_plus.iloc[-1]) else 0.0
    dm = float(di_minus.iloc[-1]) if not pd.isna(di_minus.iloc[-1]) else 0.0

    regime_data = {"regime": "BULL" if regime == "LONG" else "BEAR", "score": 75, "details": {}}

    if config is None:
        config = {}

    return dict(
        df1h=df1h, df4h=df4h, df5m=df5m, price=price,
        symbol="TESTUSDT", regime=regime,
        regime_data=regime_data, adx=adx,
        di_plus=dp, di_minus=dm, config=config,
    )


class TestAssessSignal:
    def test_uptrend_direction_not_short(self):
        from strategies.trend_following import assess_signal
        args = _build_assess_args(trend=0.003, regime="LONG")
        result = assess_signal(**args)
        assert result["direction"] != "SHORT"

    def test_downtrend_direction_not_long(self):
        from strategies.trend_following import assess_signal
        args = _build_assess_args(trend=-0.003, regime="SHORT")
        result = assess_signal(**args)
        assert result["direction"] != "LONG"

    def test_regime_blocks_short_in_bull(self):
        from strategies.trend_following import assess_signal
        # Downtrend data but LONG regime should block SHORT
        args = _build_assess_args(trend=-0.003, regime="LONG")
        result = assess_signal(**args)
        assert result["direction"] != "SHORT"

    def test_output_has_strategy_field(self):
        from strategies.trend_following import assess_signal
        args = _build_assess_args(trend=0.003, regime="LONG")
        result = assess_signal(**args)
        assert result["strategy"] == "trend_following"

    def test_output_has_required_fields(self):
        from strategies.trend_following import assess_signal
        args = _build_assess_args(trend=0.003, regime="LONG")
        result = assess_signal(**args)
        required = [
            "strategy", "estado", "direction", "price", "score",
            "score_label", "adx_1h", "sizing_1h", "tf_indicators",
        ]
        for field in required:
            assert field in result, f"Missing required field: {field}"

    def test_output_has_tf_indicators(self):
        from strategies.trend_following import assess_signal
        args = _build_assess_args(trend=0.003, regime="LONG")
        result = assess_signal(**args)
        tf_ind = result["tf_indicators"]
        for key in ["ema_fast", "ema_slow", "ema_filter", "di_plus", "di_minus"]:
            assert key in tf_ind, f"Missing tf_indicator key: {key}"

    def test_sizing_has_trailing_mode(self):
        from strategies.trend_following import assess_signal
        args = _build_assess_args(trend=0.003, regime="LONG")
        result = assess_signal(**args)
        sizing = result["sizing_1h"]
        assert sizing["sl_mode"] == "trailing"
        assert sizing["tp_precio"] is None

    def test_short_blocked_when_allow_short_false(self):
        from strategies.trend_following import assess_signal
        config = {"symbol_overrides": {"TESTUSDT": {"allow_short": False}}}
        args = _build_assess_args(trend=-0.003, regime="SHORT", config=config)
        result = assess_signal(**args)
        assert result["direction"] != "SHORT"

    def test_custom_ema_params_used(self):
        from strategies.trend_following import assess_signal
        config = {"symbol_overrides": {"TESTUSDT": {
            "tf_ema_fast": 5, "tf_ema_slow": 13, "tf_ema_filter": 30,
        }}}
        args = _build_assess_args(trend=0.003, regime="LONG", config=config)
        result = assess_signal(**args)
        # The custom params should be reflected in tf_indicators
        tf_ind = result["tf_indicators"]
        # ema_fast is computed with period 5 — just verify the field is present
        assert "ema_fast" in tf_ind

    def test_score_max_is_9(self):
        from strategies.trend_following import assess_signal
        args = _build_assess_args(trend=0.003, regime="LONG")
        result = assess_signal(**args)
        assert result["score"] <= 9

    def test_score_label_is_valid(self):
        from strategies.trend_following import assess_signal
        args = _build_assess_args(trend=0.003, regime="LONG")
        result = assess_signal(**args)
        valid_labels = [
            "PREMIUM ⭐⭐⭐ (sizing 150%)",
            "ESTÁNDAR ⭐⭐ (sizing 100%)",
            "MÍNIMA ⭐ (sizing 50%)",
            "INSUFICIENTE",
        ]
        assert result["score_label"] in valid_labels, (
            f"Invalid score_label: {result['score_label']}"
        )
