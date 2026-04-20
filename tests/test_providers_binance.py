import pytest
from unittest.mock import MagicMock, patch
from data.providers.base import (
    ProviderInvalidSymbol, ProviderRateLimited, ProviderTemporaryError,
)
from data.providers.binance import BinanceAdapter


def _mock_response(status_code=200, json_data=None):
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = json_data if json_data is not None else []
    r.text = ""
    return r


class TestBinanceAdapter:
    def test_name_and_rate_limit(self):
        a = BinanceAdapter()
        assert a.name == "binance"
        assert a.rate_limit_per_min == 1200

    def test_fetch_klines_parses_response(self):
        raw = [
            # open_time, open, high, low, close, volume, close_time, quote_vol, trades, ...
            [1000, "100.0", "110.0", "95.0", "105.0", "50.0", 1999, "0", 0, "0", "0", "0"],
            [5000, "105.0", "115.0", "100.0", "110.0", "60.0", 5999, "0", 0, "0", "0", "0"],
        ]
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", return_value=_mock_response(json_data=raw)):
            bars = a.fetch_klines("BTCUSDT", "1h", 1000, 5000)
        assert len(bars) == 2
        assert bars[0].symbol == "BTCUSDT"
        assert bars[0].timeframe == "1h"
        assert bars[0].open_time == 1000
        assert bars[0].open == 100.0
        assert bars[0].high == 110.0
        assert bars[0].provider == "binance"

    def test_http_429_raises_rate_limited(self):
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", return_value=_mock_response(429)):
            with pytest.raises(ProviderRateLimited):
                a.fetch_klines("BTCUSDT", "1h", 0, 1000)

    def test_http_418_raises_rate_limited(self):
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", return_value=_mock_response(418)):
            with pytest.raises(ProviderRateLimited):
                a.fetch_klines("BTCUSDT", "1h", 0, 1000)

    def test_http_400_raises_invalid_symbol(self):
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", return_value=_mock_response(400)):
            with pytest.raises(ProviderInvalidSymbol):
                a.fetch_klines("FAKEUSDT", "1h", 0, 1000)

    def test_http_5xx_raises_temporary(self):
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", return_value=_mock_response(503)):
            with pytest.raises(ProviderTemporaryError):
                a.fetch_klines("BTCUSDT", "1h", 0, 1000)

    def test_timeout_raises_temporary(self):
        import requests
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", side_effect=requests.Timeout()):
            with pytest.raises(ProviderTemporaryError):
                a.fetch_klines("BTCUSDT", "1h", 0, 1000)

    def test_empty_response(self):
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", return_value=_mock_response(json_data=[])):
            bars = a.fetch_klines("BTCUSDT", "1h", 0, 1000)
        assert bars == []

    def test_is_healthy_true(self):
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", return_value=_mock_response(200)):
            assert a.is_healthy() is True

    def test_is_healthy_false(self):
        import requests
        a = BinanceAdapter()
        with patch("data.providers.binance._http_get", side_effect=requests.Timeout()):
            assert a.is_healthy() is False
