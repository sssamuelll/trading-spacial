"""Binance spot klines adapter (primary provider)."""
import time
import requests

from data.providers.base import (
    Bar, ProviderInvalidSymbol, ProviderRateLimited, ProviderTemporaryError,
)


def _http_get(url, params=None, timeout=10):
    """Thin wrapper so tests can mock just this call."""
    return requests.get(url, params=params, timeout=timeout)


class BinanceAdapter:
    name = "binance"
    rate_limit_per_min = 1200
    BASE_URL = "https://api.binance.com"

    TF_MAP = {
        "5m": "5m", "15m": "15m", "30m": "30m",
        "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w",
    }

    def fetch_klines(self, symbol: str, timeframe: str, start_ms: int, end_ms: int) -> list[Bar]:
        params = {
            "symbol": symbol,
            "interval": self.TF_MAP[timeframe],
            "startTime": start_ms,
            "endTime": end_ms,
            "limit": 1000,
        }
        try:
            r = _http_get(f"{self.BASE_URL}/api/v3/klines", params=params, timeout=10)
        except (requests.Timeout, requests.ConnectionError) as e:
            raise ProviderTemporaryError(f"{type(e).__name__}: {e}") from e

        if r.status_code in (429, 418):
            raise ProviderRateLimited(f"HTTP {r.status_code}: {r.text[:100]}")
        if r.status_code == 400:
            raise ProviderInvalidSymbol(f"{symbol}: {r.text[:200]}")
        if r.status_code >= 500:
            raise ProviderTemporaryError(f"HTTP {r.status_code}")
        if r.status_code != 200:
            raise ProviderTemporaryError(f"HTTP {r.status_code}: {r.text[:200]}")

        now_ms = int(time.time() * 1000)
        return [
            Bar(
                symbol=symbol, timeframe=timeframe, open_time=int(row[0]),
                open=float(row[1]), high=float(row[2]), low=float(row[3]),
                close=float(row[4]), volume=float(row[5]),
                provider=self.name, fetched_at=now_ms,
            )
            for row in r.json()
        ]

    def is_healthy(self) -> bool:
        try:
            r = _http_get(f"{self.BASE_URL}/api/v3/ping", timeout=3)
            return r.status_code == 200
        except Exception:
            return False
