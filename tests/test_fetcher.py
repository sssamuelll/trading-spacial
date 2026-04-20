import threading
import pytest
from data import _fetcher


class TestLockRegistry:
    def test_returns_lock_instance(self):
        lock = _fetcher._get_or_create_lock("BTCUSDT", "1h")
        assert hasattr(lock, "acquire") and hasattr(lock, "release")

    def test_same_key_returns_same_lock(self):
        a = _fetcher._get_or_create_lock("BTCUSDT", "1h")
        b = _fetcher._get_or_create_lock("BTCUSDT", "1h")
        assert a is b

    def test_different_keys_different_locks(self):
        a = _fetcher._get_or_create_lock("BTCUSDT", "1h")
        b = _fetcher._get_or_create_lock("ETHUSDT", "1h")
        c = _fetcher._get_or_create_lock("BTCUSDT", "5m")
        assert a is not b
        assert a is not c
        assert b is not c

    def test_thread_safe_registry(self):
        # Concurrent creation of the same lock must return the same object
        results = []
        def worker():
            results.append(_fetcher._get_or_create_lock("CONCURRENT", "1h"))
        threads = [threading.Thread(target=worker) for _ in range(16)]
        for t in threads: t.start()
        for t in threads: t.join()
        assert len(set(id(r) for r in results)) == 1


from data.providers.base import (
    ProviderRateLimited, ProviderTemporaryError, ProviderInvalidSymbol,
    AllProvidersFailedError,
)
from _fakes import make_bar


class TestFetchWithFailover:
    def test_primary_success(self, fake_providers):
        primary, fallback = fake_providers
        bars = [make_bar("BTCUSDT", "1h", 1000)]
        primary.set_bars("BTCUSDT", "1h", bars)
        result = _fetcher.fetch_with_failover("BTCUSDT", "1h", 0, 2000)
        assert len(result) == 1
        assert len(primary.calls) == 1
        assert len(fallback.calls) == 0

    def test_primary_temporary_error_triggers_counter(self, fake_providers):
        primary, fallback = fake_providers
        primary.set_error("BTCUSDT", "1h", ProviderTemporaryError("503"))
        fallback.set_bars("BTCUSDT", "1h", [make_bar("BTCUSDT", "1h", 1000)])
        result = _fetcher.fetch_with_failover("BTCUSDT", "1h", 0, 2000)
        assert len(result) == 1
        assert len(fallback.calls) == 1
        # Counter accumulates on primary failure — fallback success does NOT
        # reset it, otherwise the threshold could never trigger.
        assert _fetcher._consecutive_failures == 1

    def test_threshold_triggers_sticky_switch(self, fake_providers):
        primary, fallback = fake_providers
        primary.set_error("BTCUSDT", "1h", ProviderRateLimited("429"))
        fallback.set_bars("BTCUSDT", "1h", [make_bar("BTCUSDT", "1h", 1000)])
        for _ in range(_fetcher.FAILOVER_THRESHOLD):
            _fetcher.fetch_with_failover("BTCUSDT", "1h", 0, 2000)
        assert _fetcher._active_idx == 1  # switched to fallback

    def test_invalid_symbol_does_not_trigger_failover(self, fake_providers):
        primary, fallback = fake_providers
        primary.set_error("FAKE", "1h", ProviderInvalidSymbol("not found"))
        with pytest.raises(ProviderInvalidSymbol):
            _fetcher.fetch_with_failover("FAKE", "1h", 0, 2000)
        assert _fetcher._active_idx == 0
        assert _fetcher._consecutive_failures == 0

    def test_all_providers_fail_raises(self, fake_providers):
        primary, fallback = fake_providers
        primary.set_error("BTCUSDT", "1h", ProviderTemporaryError("503"))
        fallback.set_error("BTCUSDT", "1h", ProviderTemporaryError("504"))
        with pytest.raises(AllProvidersFailedError):
            _fetcher.fetch_with_failover("BTCUSDT", "1h", 0, 2000)

    def test_recovery_probe_reverts_active(self, fake_providers, monkeypatch):
        primary, fallback = fake_providers
        # Force active_idx = 1 (fallback) and simulate probe interval elapsed
        _fetcher._active_idx = 1
        _fetcher._last_probe_ms = 0
        primary.healthy = True
        fallback.set_bars("BTCUSDT", "1h", [make_bar("BTCUSDT", "1h", 1000)])
        primary.set_bars("BTCUSDT", "1h", [make_bar("BTCUSDT", "1h", 1000)])
        _fetcher.fetch_with_failover("BTCUSDT", "1h", 0, 2000)
        assert _fetcher._active_idx == 0  # recovered
