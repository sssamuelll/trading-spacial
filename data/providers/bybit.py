"""Bybit v5 kline adapter (fallback provider)."""
import time
import requests

from data.providers.base import (
    Bar, ProviderInvalidSymbol, ProviderRateLimited, ProviderTemporaryError,
)


def _http_get(url, params=None, timeout=10):
    return requests.get(url, params=params, timeout=timeout)


class BybitAdapter:
    name = "bybit"
    rate_limit_per_min = 600
    BASE_URL = "https://api.bybit.com"

    TF_MAP = {
        "5m": "5", "15m": "15", "30m": "30",
        "1h": "60", "4h": "240", "1d": "D", "1w": "W",
    }

    # Bybit retCodes that indicate invalid symbol (non-exhaustive).
    _INVALID_SYMBOL_CODES = {10001}

    def fetch_klines(self, symbol: str, timeframe: str, start_ms: int, end_ms: int) -> list[Bar]:
        params = {
            "category": "spot",
            "symbol": symbol,
            "interval": self.TF_MAP[timeframe],
            "start": start_ms,
            "end": end_ms,
            "limit": 1000,
        }
        try:
            r = _http_get(f"{self.BASE_URL}/v5/market/kline", params=params, timeout=10)
        except (requests.Timeout, requests.ConnectionError) as e:
            raise ProviderTemporaryError(f"{type(e).__name__}: {e}") from e

        if r.status_code in (429, 418):
            raise ProviderRateLimited(f"HTTP {r.status_code}")
        if r.status_code >= 500:
            raise ProviderTemporaryError(f"HTTP {r.status_code}")
        if r.status_code != 200:
            raise ProviderTemporaryError(f"HTTP {r.status_code}: {r.text[:200]}")

        body = r.json() or {}
        ret_code = body.get("retCode", 0)
        if ret_code in self._INVALID_SYMBOL_CODES:
            raise ProviderInvalidSymbol(f"{symbol}: {body.get('retMsg', '')}")
        if ret_code != 0:
            raise ProviderTemporaryError(f"Bybit retCode {ret_code}: {body.get('retMsg', '')}")

        items = ((body.get("result") or {}).get("list") or [])
        now_ms = int(time.time() * 1000)
        bars = [
            Bar(
                symbol=symbol, timeframe=timeframe, open_time=int(row[0]),
                open=float(row[1]), high=float(row[2]), low=float(row[3]),
                close=float(row[4]), volume=float(row[5]),
                provider=self.name, fetched_at=now_ms,
            )
            for row in items
        ]
        # Bybit returns DESCENDING by time; normalize to ascending.
        bars.sort(key=lambda b: b.open_time)
        return bars

    def is_healthy(self) -> bool:
        try:
            r = _http_get(f"{self.BASE_URL}/v5/market/time", timeout=3)
            return r.status_code == 200 and (r.json() or {}).get("retCode", -1) == 0
        except Exception:
            return False
