import pytest
from unittest.mock import MagicMock, patch
from data.providers.base import (
    ProviderInvalidSymbol, ProviderRateLimited, ProviderTemporaryError,
)
from data.providers.bybit import BybitAdapter


def _mock_response(status_code=200, json_data=None):
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = json_data if json_data is not None else {"result": {"list": []}, "retCode": 0}
    r.text = ""
    return r


class TestBybitAdapter:
    def test_name_and_rate_limit(self):
        a = BybitAdapter()
        assert a.name == "bybit"
        assert a.rate_limit_per_min == 600

    def test_fetch_klines_parses_response(self):
        # Bybit v5 kline: list is DESCENDING by time; we must reverse.
        # fields: [startTime, open, high, low, close, volume, turnover]
        raw = {
            "retCode": 0,
            "result": {
                "list": [
                    ["5000", "105.0", "115.0", "100.0", "110.0", "60.0", "0"],
                    ["1000", "100.0", "110.0", "95.0", "105.0", "50.0", "0"],
                ]
            }
        }
        a = BybitAdapter()
        with patch("data.providers.bybit._http_get", return_value=_mock_response(json_data=raw)):
            bars = a.fetch_klines("BTCUSDT", "1h", 1000, 5000)
        assert len(bars) == 2
        # After reverse: ascending by open_time
        assert bars[0].open_time == 1000
        assert bars[1].open_time == 5000
        assert bars[0].provider == "bybit"

    def test_http_429_raises_rate_limited(self):
        a = BybitAdapter()
        with patch("data.providers.bybit._http_get", return_value=_mock_response(429)):
            with pytest.raises(ProviderRateLimited):
                a.fetch_klines("BTCUSDT", "1h", 0, 1000)

    def test_retcode_invalid_symbol(self):
        raw = {"retCode": 10001, "retMsg": "Invalid symbol"}
        a = BybitAdapter()
        with patch("data.providers.bybit._http_get", return_value=_mock_response(200, raw)):
            with pytest.raises(ProviderInvalidSymbol):
                a.fetch_klines("FAKEUSDT", "1h", 0, 1000)

    def test_http_5xx_raises_temporary(self):
        a = BybitAdapter()
        with patch("data.providers.bybit._http_get", return_value=_mock_response(502)):
            with pytest.raises(ProviderTemporaryError):
                a.fetch_klines("BTCUSDT", "1h", 0, 1000)

    def test_timeout_raises_temporary(self):
        import requests
        a = BybitAdapter()
        with patch("data.providers.bybit._http_get", side_effect=requests.Timeout()):
            with pytest.raises(ProviderTemporaryError):
                a.fetch_klines("BTCUSDT", "1h", 0, 1000)

    def test_empty_result_list(self):
        a = BybitAdapter()
        with patch("data.providers.bybit._http_get", return_value=_mock_response(200)):
            bars = a.fetch_klines("BTCUSDT", "1h", 0, 1000)
        assert bars == []

    def test_is_healthy_true(self):
        a = BybitAdapter()
        raw = {"retCode": 0, "result": {"timeSecond": str(int(1e9))}}
        with patch("data.providers.bybit._http_get", return_value=_mock_response(200, raw)):
            assert a.is_healthy() is True

    def test_is_healthy_false(self):
        import requests
        a = BybitAdapter()
        with patch("data.providers.bybit._http_get", side_effect=requests.Timeout()):
            assert a.is_healthy() is False
