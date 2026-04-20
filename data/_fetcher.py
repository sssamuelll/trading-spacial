"""Fetcher: orchestrates providers with failover, dedup, rate limiting."""
import threading
import time
import logging

from data.providers.base import (
    ProviderAdapter, ProviderError, ProviderInvalidSymbol,
    ProviderRateLimited, ProviderTemporaryError, AllProvidersFailedError, Bar,
)
from data.providers.binance import BinanceAdapter
from data.providers.bybit import BybitAdapter
from data import metrics, _storage
from data.timeframes import delta_ms, last_closed_bar_time


log = logging.getLogger("data.market")


# ─── Provider registry ──────────────────────────────────────────────────────
_PROVIDERS: list[ProviderAdapter] = [BinanceAdapter(), BybitAdapter()]


# ─── Failover state (module-level, guarded) ─────────────────────────────────
_state_lock = threading.Lock()
_active_idx: int = 0
_consecutive_failures: int = 0
_last_probe_ms: int = 0

FAILOVER_THRESHOLD = 3
RECOVERY_PROBE_INTERVAL_MS = 300_000   # 5 minutes


# ─── Per-(symbol, timeframe) lock registry ──────────────────────────────────
_fetch_locks: dict[tuple[str, str], threading.Lock] = {}
_registry_guard = threading.Lock()


def _get_or_create_lock(symbol: str, timeframe: str) -> threading.Lock:
    """Return per-(symbol, timeframe) lock for in-process fetch dedup."""
    key = (symbol, timeframe)
    with _registry_guard:
        return _fetch_locks.setdefault(key, threading.Lock())


# ─── Rate limiter (minimal token bucket; compatible with existing project API) ──
class _RateLimiter:
    """Per-key token bucket. If the existing project rate limiter is available,
    substitute it here. This simple version refills tokens proportionally by
    elapsed time and blocks with a short sleep when empty."""

    def __init__(self):
        self._lock = threading.Lock()
        self._tokens: dict[str, float] = {}
        self._last_refill: dict[str, float] = {}

    def acquire(self, key: str, limit_per_min: int) -> None:
        while True:
            with self._lock:
                now = time.time()
                refill_rate = limit_per_min / 60.0  # tokens per second
                last = self._last_refill.get(key, now)
                self._tokens[key] = min(
                    limit_per_min,
                    self._tokens.get(key, limit_per_min) + (now - last) * refill_rate,
                )
                self._last_refill[key] = now
                if self._tokens[key] >= 1.0:
                    self._tokens[key] -= 1.0
                    return
                deficit = 1.0 - self._tokens[key]
                sleep_for = deficit / refill_rate
            time.sleep(min(sleep_for, 1.0))


_rate_limiter = _RateLimiter()


def _maybe_probe_primary_recovery() -> None:
    """If we're on a fallback, probe primary health periodically; revert on success."""
    global _active_idx, _last_probe_ms
    with _state_lock:
        if _active_idx == 0:
            return
        now_ms = int(time.time() * 1000)
        if now_ms - _last_probe_ms < RECOVERY_PROBE_INTERVAL_MS:
            return
        _last_probe_ms = now_ms
        primary_to_probe = _PROVIDERS[0]

    healthy = False
    try:
        healthy = primary_to_probe.is_healthy()
    except Exception:
        pass
    if healthy:
        with _state_lock:
            _active_idx = 0
        metrics.inc("provider_recoveries_total", labels={"provider": primary_to_probe.name})
        log.info("Primary provider %s recovered — reverting active", primary_to_probe.name)


def fetch_with_failover(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> list[Bar]:
    """Try providers in priority order (sticky). On failure thresholds, switch active."""
    global _active_idx, _consecutive_failures

    _maybe_probe_primary_recovery()

    with _state_lock:
        ordering = list(range(_active_idx, len(_PROVIDERS))) + list(range(_active_idx))
        primary_name = _PROVIDERS[ordering[0]].name

    for position, idx in enumerate(ordering):
        provider = _PROVIDERS[idx]
        try:
            _rate_limiter.acquire(provider.name, provider.rate_limit_per_min)
            t0 = time.time()
            bars = provider.fetch_klines(symbol, timeframe, start_ms, end_ms)
            latency_ms = int((time.time() - t0) * 1000)
            metrics.observe("fetch_latency_ms", latency_ms, labels={"provider": provider.name})
            metrics.inc("fetches_total", labels={"provider": provider.name, "tf": timeframe})
            if position == 0:
                # Only reset on primary success so fallback coverage still
                # accumulates consecutive primary failures across calls.
                with _state_lock:
                    _consecutive_failures = 0
            else:
                metrics.inc(
                    "fallback_fetches_total",
                    labels={"from": primary_name, "to": provider.name},
                )
            return bars
        except ProviderInvalidSymbol:
            raise
        except (ProviderRateLimited, ProviderTemporaryError) as e:
            metrics.inc(
                "provider_errors_total",
                labels={"provider": provider.name, "kind": type(e).__name__},
            )
            log.warning("%s failed (%s): %s", provider.name, type(e).__name__, e)
            if position == 0:
                with _state_lock:
                    _consecutive_failures += 1
                    if _consecutive_failures >= FAILOVER_THRESHOLD:
                        new_idx = (idx + 1) % len(_PROVIDERS)
                        metrics.inc(
                            "provider_switches_total",
                            labels={"from": provider.name, "to": _PROVIDERS[new_idx].name},
                        )
                        log.warning(
                            "Switching active provider %s → %s after %d consecutive failures",
                            provider.name, _PROVIDERS[new_idx].name, _consecutive_failures,
                        )
                        _active_idx = new_idx
                        _consecutive_failures = 0
            continue

    raise AllProvidersFailedError(
        f"All providers failed for {symbol} {timeframe} [{start_ms}, {end_ms}]"
    )
