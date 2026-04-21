import pandas as pd
import pytest
from btc_scanner import _compute_price_score


def _df_daily(closes, highs=None, lows=None):
    n = len(closes)
    return pd.DataFrame({
        "open":  closes,
        "high":  highs if highs is not None else [c + 1 for c in closes],
        "low":   lows if lows is not None else [c - 1 for c in closes],
        "close": closes,
        "volume": [1000] * n,
    }, index=pd.date_range("2020-01-01", periods=n, freq="D"))


class TestComputePriceScore:
    def test_death_cross_price_below_sma_negative_return(self):
        """SMA50 < SMA200, price < SMA200, 30d return < -10% → 100-40-30-20=10."""
        closes = [100.0] * 170 + [100.0 - i for i in range(30)] + [50.0] * 10
        df = _df_daily(closes)
        assert _compute_price_score(df) == 10

    def test_only_death_cross(self):
        """SMA50 < SMA200, price > SMA200, ret30 positive → 100-40=60."""
        closes = [200.0] * 150 + [160.0] * 30 + [140.0] * 15 + [210.0] * 15
        df = _df_daily(closes)
        score = _compute_price_score(df)
        assert 55 <= score <= 75

    def test_bull_market_clean(self):
        """SMA50 > SMA200, price > SMA200, ret30 positive → 100."""
        closes = list(range(100, 310))
        df = _df_daily(closes)
        assert _compute_price_score(df) == 100

    def test_transition_mild(self):
        """SMA50 > SMA200, price < SMA200, ret30 slightly negative → 100-30-10=60."""
        closes = [100.0] * 150 + [105.0] * 40 + [95.0] * 20
        df = _df_daily(closes)
        score = _compute_price_score(df)
        assert 55 <= score <= 70

    def test_insufficient_data_returns_100(self):
        """< 200 bars → fallback 100 (bullish assumption)."""
        df = _df_daily([100.0] * 150)
        assert _compute_price_score(df) == 100

    def test_empty_dataframe_returns_100(self):
        """Empty df → 100."""
        df = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        assert _compute_price_score(df) == 100

    def test_nan_prices_graceful(self):
        """NaN prices don't crash."""
        closes = [100.0] * 200
        closes[50] = float("nan")
        df = _df_daily(closes)
        score = _compute_price_score(df)
        assert 0 <= score <= 100


class TestComputeFngScore:
    def test_pass_through_zero(self):
        from btc_scanner import _compute_fng_score
        assert _compute_fng_score(0) == 0

    def test_pass_through_50(self):
        from btc_scanner import _compute_fng_score
        assert _compute_fng_score(50) == 50

    def test_pass_through_100(self):
        from btc_scanner import _compute_fng_score
        assert _compute_fng_score(100) == 100


class TestComputeFundingScore:
    def test_rate_minus_one_percent(self):
        from btc_scanner import _compute_funding_score
        assert _compute_funding_score(-0.01) == 0

    def test_rate_zero(self):
        from btc_scanner import _compute_funding_score
        assert _compute_funding_score(0) == 50

    def test_rate_plus_one_percent(self):
        from btc_scanner import _compute_funding_score
        assert _compute_funding_score(0.01) == 100

    def test_extreme_positive_clamped(self):
        from btc_scanner import _compute_funding_score
        assert _compute_funding_score(0.05) == 100

    def test_extreme_negative_clamped(self):
        from btc_scanner import _compute_funding_score
        assert _compute_funding_score(-0.05) == 0


class TestComputeRsiScore:
    def test_rsi_30_gives_70(self):
        from btc_scanner import _compute_rsi_score
        assert _compute_rsi_score(30) == 70

    def test_rsi_50_neutral(self):
        from btc_scanner import _compute_rsi_score
        assert _compute_rsi_score(50) == 50

    def test_rsi_70_gives_30(self):
        from btc_scanner import _compute_rsi_score
        assert _compute_rsi_score(70) == 30

    def test_rsi_20_oversold_bullish(self):
        from btc_scanner import _compute_rsi_score
        assert _compute_rsi_score(20) == 80

    def test_rsi_80_overbought_bearish(self):
        from btc_scanner import _compute_rsi_score
        assert _compute_rsi_score(80) == 20


class TestComputeAdxScore:
    def test_adx_below_20_ranging(self):
        from btc_scanner import _compute_adx_score
        assert _compute_adx_score(15) == 75

    def test_adx_20_30_medium(self):
        from btc_scanner import _compute_adx_score
        assert _compute_adx_score(25) == 50

    def test_adx_above_30_trending(self):
        from btc_scanner import _compute_adx_score
        assert _compute_adx_score(35) == 25

    def test_adx_strong_trend(self):
        from btc_scanner import _compute_adx_score
        assert _compute_adx_score(50) == 25
