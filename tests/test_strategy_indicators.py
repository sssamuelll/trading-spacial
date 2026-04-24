"""Parity tests: strategy.indicators must match btc_scanner's existing output."""
import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def sample_close_series():
    np.random.seed(42)
    prices = 100.0 + np.cumsum(np.random.randn(200) * 0.5)
    return pd.Series(prices)


@pytest.fixture
def sample_ohlcv_df(sample_close_series):
    n = len(sample_close_series)
    noise = np.abs(np.random.randn(n)) * 0.3
    return pd.DataFrame({
        "open":  sample_close_series.shift(1).bfill(),
        "high":  sample_close_series + noise,
        "low":   sample_close_series - noise,
        "close": sample_close_series,
        "volume": np.random.rand(n) * 1000,
        "taker_buy_base": np.random.rand(n) * 500,
    })


def test_calc_lrc_parity(sample_close_series):
    from strategy.indicators import calc_lrc as new_impl
    from btc_scanner import calc_lrc as old_impl
    new_result = new_impl(sample_close_series, 100, 2.0)
    old_result = old_impl(sample_close_series, 100, 2.0)
    # calc_lrc returns tuple (lrc_pct, upper, lower, mid)
    assert new_result[0] == pytest.approx(old_result[0], rel=1e-9)
    for i in range(1, 4):
        assert new_result[i] == pytest.approx(old_result[i], rel=1e-9)


def test_calc_rsi_parity(sample_close_series):
    from strategy.indicators import calc_rsi as new_impl
    from btc_scanner import calc_rsi as old_impl
    pd.testing.assert_series_equal(
        new_impl(sample_close_series, 14),
        old_impl(sample_close_series, 14),
        check_names=False,
    )


def test_calc_bb_parity(sample_close_series):
    from strategy.indicators import calc_bb as new_impl
    from btc_scanner import calc_bb as old_impl
    new_up, new_mid, new_dn = new_impl(sample_close_series, 20, 2.0)
    old_up, old_mid, old_dn = old_impl(sample_close_series, 20, 2.0)
    pd.testing.assert_series_equal(new_up, old_up, check_names=False)
    pd.testing.assert_series_equal(new_mid, old_mid, check_names=False)
    pd.testing.assert_series_equal(new_dn, old_dn, check_names=False)


def test_calc_sma_parity(sample_close_series):
    from strategy.indicators import calc_sma as new_impl
    from btc_scanner import calc_sma as old_impl
    pd.testing.assert_series_equal(
        new_impl(sample_close_series, 50),
        old_impl(sample_close_series, 50),
        check_names=False,
    )


def test_calc_atr_parity(sample_ohlcv_df):
    from strategy.indicators import calc_atr as new_impl
    from btc_scanner import calc_atr as old_impl
    pd.testing.assert_series_equal(
        new_impl(sample_ohlcv_df, 14),
        old_impl(sample_ohlcv_df, 14),
        check_names=False,
    )


def test_calc_adx_parity(sample_ohlcv_df):
    from strategy.indicators import calc_adx as new_impl
    from btc_scanner import calc_adx as old_impl
    pd.testing.assert_series_equal(
        new_impl(sample_ohlcv_df, 14),
        old_impl(sample_ohlcv_df, 14),
        check_names=False,
    )


def test_calc_cvd_delta_parity(sample_ohlcv_df):
    from strategy.indicators import calc_cvd_delta as new_impl
    from btc_scanner import calc_cvd_delta as old_impl
    assert new_impl(sample_ohlcv_df, 3) == pytest.approx(old_impl(sample_ohlcv_df, 3), rel=1e-9)
