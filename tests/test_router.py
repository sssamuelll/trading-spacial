import pytest
from strategies.router import route, ADX_THRESHOLD


class TestRouteDefaults:
    def test_adx_below_threshold_returns_mean_reversion(self):
        result = route(adx=20.0, symbol="BTCUSDT", config={})
        assert result == "mean_reversion"

    def test_adx_above_threshold_returns_trend_following(self):
        result = route(adx=30.0, symbol="BTCUSDT", config={})
        assert result == "trend_following"

    def test_adx_exact_threshold_returns_trend_following(self):
        result = route(adx=25.0, symbol="BTCUSDT", config={})
        assert result == "trend_following"

    def test_adx_zero_returns_mean_reversion(self):
        result = route(adx=0.0, symbol="BTCUSDT", config={})
        assert result == "mean_reversion"


class TestRouteOverrides:
    def test_forced_trend_following_ignores_adx(self):
        config = {"symbol_overrides": {"SOLUSDT": {"strategy": "trend_following"}}}
        result = route(adx=10.0, symbol="SOLUSDT", config=config)
        assert result == "trend_following"

    def test_forced_mean_reversion_ignores_adx(self):
        config = {"symbol_overrides": {"SOLUSDT": {"strategy": "mean_reversion"}}}
        result = route(adx=40.0, symbol="SOLUSDT", config=config)
        assert result == "mean_reversion"

    def test_auto_strategy_uses_adx(self):
        config = {"symbol_overrides": {"SOLUSDT": {"strategy": "auto"}}}
        result = route(adx=30.0, symbol="SOLUSDT", config=config)
        assert result == "trend_following"

    def test_custom_adx_threshold(self):
        config = {"symbol_overrides": {"SOLUSDT": {"adx_threshold": 30}}}
        result = route(adx=27.0, symbol="SOLUSDT", config=config)
        assert result == "mean_reversion"

    def test_custom_adx_threshold_above(self):
        config = {"symbol_overrides": {"SOLUSDT": {"adx_threshold": 30}}}
        result = route(adx=30.0, symbol="SOLUSDT", config=config)
        assert result == "trend_following"

    def test_unknown_symbol_uses_defaults(self):
        config = {"symbol_overrides": {"BTCUSDT": {"strategy": "trend_following"}}}
        result = route(adx=20.0, symbol="ETHUSDT", config=config)
        assert result == "mean_reversion"

    def test_empty_symbol_overrides(self):
        config = {"symbol_overrides": {}}
        result = route(adx=30.0, symbol="BTCUSDT", config=config)
        assert result == "trend_following"
