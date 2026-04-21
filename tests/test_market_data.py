from datetime import datetime, timezone
import pytest
from data import market_data as md
from data import _storage, _fetcher
from data.timeframes import last_closed_bar_time, delta_ms
from _fakes import make_bar


def _seed(fake, symbol, tf, count, delta_hours=1):
    bars = [make_bar(symbol, tf, t * delta_hours * 3600_000, price=100.0 + t) for t in range(count)]
    fake.set_bars(symbol, tf, bars)
    return bars


class TestGetKlines:
    def test_cold_fetches_limit(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        # Freeze "now" such that expected_max = 9 * 3600_000 (last closed 1h bar)
        def fake_last_closed(tf, now=None):
            return 9 * 3600_000
        monkeypatch.setattr(md, "last_closed_bar_time", fake_last_closed)
        monkeypatch.setattr(_fetcher, "last_closed_bar_time", fake_last_closed)
        _seed(fake_provider, "BTCUSDT", "1h", 10)
        df = md.get_klines("BTCUSDT", "1h", 5)
        assert len(df) == 5
        assert list(df["open_time"]) == [5 * 3600_000, 6 * 3600_000, 7 * 3600_000, 8 * 3600_000, 9 * 3600_000]

    def test_warm_no_fetch(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        monkeypatch.setattr(_fetcher, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        bars = _seed(fake_provider, "BTCUSDT", "1h", 10)
        _storage.upsert_many(bars)
        fake_provider.calls.clear()
        df = md.get_klines("BTCUSDT", "1h", 5)
        assert len(df) == 5
        assert fake_provider.calls == []

    def test_force_refresh_bypasses_cache(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        monkeypatch.setattr(_fetcher, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        bars = _seed(fake_provider, "BTCUSDT", "1h", 10)
        _storage.upsert_many(bars)
        fake_provider.calls.clear()
        md.get_klines("BTCUSDT", "1h", 5, force_refresh=True)
        assert len(fake_provider.calls) >= 1


class TestGetKlinesLive:
    def test_bypasses_cache_includes_current(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        # Pin "now" so the requested range aligns with the seeded bars; the
        # FakeProvider filters by open_time range.
        pinned_now = datetime(2026, 1, 1, 5, 0, tzinfo=timezone.utc)
        monkeypatch.setattr(md, "_utcnow", lambda: pinned_now)
        d = 3600_000
        pinned_ms = int(pinned_now.timestamp() * 1000)
        current = (pinned_ms // d) * d
        bars = [make_bar("BTCUSDT", "1h", current - (4 - i) * d) for i in range(5)]
        fake_provider.set_bars("BTCUSDT", "1h", bars)
        df = md.get_klines_live("BTCUSDT", "1h", 5)
        assert len(df) == 5
        # Nothing was persisted to the DB
        count = _storage._conn().execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0]
        assert count == 0


from datetime import timedelta


class TestGetKlinesRange:
    def test_cache_hit_no_fetch(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        bars = [make_bar("BTCUSDT", "1h", t * 3600_000) for t in range(10)]
        _storage.upsert_many(bars)
        fake_provider.calls.clear()
        df = md.get_klines_range(
            "BTCUSDT", "1h",
            datetime(1970, 1, 1, 0, 0, tzinfo=timezone.utc),
            datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(hours=9),
        )
        assert len(df) == 10
        assert fake_provider.calls == []

    def test_cold_backfills_whole_range(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        bars = [make_bar("BTCUSDT", "1h", t * 3600_000) for t in range(10)]
        fake_provider.set_bars("BTCUSDT", "1h", bars)
        df = md.get_klines_range(
            "BTCUSDT", "1h",
            datetime(1970, 1, 1, 0, 0, tzinfo=timezone.utc),
            datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(hours=9),
        )
        assert len(df) == 10

    def test_left_edge_gap_filled(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        all_bars = [make_bar("BTCUSDT", "1h", t * 3600_000) for t in range(10)]
        fake_provider.set_bars("BTCUSDT", "1h", all_bars)
        # Cache has only bars 5..9
        _storage.upsert_many(all_bars[5:])
        fake_provider.calls.clear()
        df = md.get_klines_range(
            "BTCUSDT", "1h",
            datetime(1970, 1, 1, 0, 0, tzinfo=timezone.utc),
            datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(hours=9),
        )
        assert len(df) == 10
        # Left edge fetch: [0, 4]
        assert fake_provider.calls[0][2] == 0
        assert fake_provider.calls[0][3] == 4 * 3600_000


class TestPrefetch:
    def test_parallel_cache_fill(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        monkeypatch.setattr(_fetcher, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        for sym in ["BTCUSDT", "ETHUSDT"]:
            _seed(fake_provider, sym, "1h", 10)
            _seed(fake_provider, sym, "4h", 10)
        md.prefetch(["BTCUSDT", "ETHUSDT"], ["1h", "4h"], limit=5)
        # After prefetch, each (sym, tf) should have data cached
        for sym in ["BTCUSDT", "ETHUSDT"]:
            for tf in ["1h", "4h"]:
                assert _storage.max_open_time(sym, tf) is not None

    def test_exception_does_not_abort_batch(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        from data.providers.base import ProviderInvalidSymbol
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        monkeypatch.setattr(_fetcher, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        _seed(fake_provider, "GOODCOIN", "1h", 10)
        fake_provider.set_error("BADCOIN", "1h", ProviderInvalidSymbol("not listed"))
        md.prefetch(["GOODCOIN", "BADCOIN"], ["1h"], limit=5)
        assert _storage.max_open_time("GOODCOIN", "1h") is not None
        assert _storage.max_open_time("BADCOIN", "1h") is None


class TestBackfill:
    def test_idempotent(self, tmp_ohlcv_db, fake_provider):
        bars = [make_bar("BTCUSDT", "1h", t * 3600_000) for t in range(50)]
        fake_provider.set_bars("BTCUSDT", "1h", bars)
        start = datetime(1970, 1, 1, 0, 0, tzinfo=timezone.utc)
        end = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(hours=49)
        md.backfill("BTCUSDT", "1h", start, end)
        count1 = _storage._conn().execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0]
        md.backfill("BTCUSDT", "1h", start, end)
        count2 = _storage._conn().execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0]
        assert count1 == count2
        assert count1 >= 1


class TestRepair:
    def test_overwrites_existing_bars(self, tmp_ohlcv_db, fake_provider):
        original = [make_bar("BTCUSDT", "1h", t * 3600_000, price=100.0) for t in range(10)]
        revised = [make_bar("BTCUSDT", "1h", t * 3600_000, price=200.0) for t in range(10)]
        _storage.upsert_many(original)
        fake_provider.set_bars("BTCUSDT", "1h", revised)
        # end=10h so last_closed_bar_time caps at 9h and repair covers bars 0..9
        md.repair(
            "BTCUSDT", "1h",
            datetime(1970, 1, 1, 0, 0, tzinfo=timezone.utc),
            datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(hours=10),
        )
        rows = _storage._conn().execute(
            "SELECT close FROM ohlcv WHERE symbol='BTCUSDT' AND timeframe='1h' ORDER BY open_time").fetchall()
        assert all(r[0] == 200.0 for r in rows)


class TestSymbolEarliestSelfHeal:
    """Regression for the 'symbol_earliest says 2023-03-24 but ohlcv has 2021 data' bug.
    When symbol_earliest is stale (older bars exist in ohlcv than it claims),
    get_klines_range used to clamp the caller's start to the stale value and
    silently truncate the returned range."""

    def test_migration_repairs_stale_earliest(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        """Simulate a legacy DB: ohlcv has bars 0..9 but symbol_earliest says earliest=5.
        Running the v2 migration must repair earliest to 0, so subsequent range queries
        return all 10 bars."""
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        bars = [make_bar("BTCUSDT", "1h", t * 3600_000) for t in range(10)]
        _storage.upsert_many(bars)
        _storage.set_first_bar_ms("BTCUSDT", "1h", 5 * 3600_000)  # stale — mimic legacy state
        assert _storage.first_bar_ms("BTCUSDT", "1h") == 5 * 3600_000  # confirm stale
        fake_provider.calls.clear()

        _storage._migrate_repair_symbol_earliest(_storage._conn())

        assert _storage.first_bar_ms("BTCUSDT", "1h") == 0, "migration should have repaired"
        df = md.get_klines_range(
            "BTCUSDT", "1h",
            datetime(1970, 1, 1, 0, 0, tzinfo=timezone.utc),
            datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(hours=9),
        )
        assert len(df) == 10
        assert fake_provider.calls == [], "warm cache should not re-fetch after repair"

    def test_upsert_updates_earliest_when_bars_are_older(self, tmp_ohlcv_db):
        """Upserting bars older than current symbol_earliest must revise earliest down."""
        # Seed: earliest = 5 (stale)
        _storage.set_first_bar_ms("BTCUSDT", "1h", 5 * 3600_000)
        # Upsert older bars (t=0..4)
        older_bars = [make_bar("BTCUSDT", "1h", t * 3600_000) for t in range(5)]
        _storage.upsert_many(older_bars)
        # earliest should now be 0
        assert _storage.first_bar_ms("BTCUSDT", "1h") == 0

    def test_upsert_does_not_regress_earliest(self, tmp_ohlcv_db):
        """Upserting newer bars does not push earliest forward — earliest stays at min."""
        _storage.set_first_bar_ms("BTCUSDT", "1h", 0)
        newer_bars = [make_bar("BTCUSDT", "1h", (10 + t) * 3600_000) for t in range(5)]
        _storage.upsert_many(newer_bars)
        assert _storage.first_bar_ms("BTCUSDT", "1h") == 0


class TestGetCachedDataNoRedundantBackfill:
    """Regression for the 'backtest.get_cached_data calls md.backfill on every call' bug.
    When the DB already has the full requested range, no HTTP fetch should happen."""

    def test_warm_cache_triggers_no_fetch(self, tmp_ohlcv_db, fake_provider, monkeypatch):
        import backtest
        monkeypatch.setattr(md, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        monkeypatch.setattr(_fetcher, "last_closed_bar_time", lambda tf, now=None: 9 * 3600_000)
        # Mock "now" so get_cached_data's `datetime.now(tz=utc)` end falls in range
        class _FixedNow:
            @staticmethod
            def now(tz=None):
                return datetime(1970, 1, 1, 10, 0, tzinfo=timezone.utc)
        monkeypatch.setattr(backtest, "datetime", _FixedNow)

        bars = [make_bar("BTCUSDT", "1h", t * 3600_000) for t in range(10)]
        _storage.upsert_many(bars)
        fake_provider.calls.clear()

        df = backtest.get_cached_data(
            "BTCUSDT", "1h",
            start_date=datetime(1970, 1, 1, 0, 0, tzinfo=timezone.utc),
        )
        assert len(df) == 10
        assert fake_provider.calls == [], (
            f"warm cache should not re-fetch; got {len(fake_provider.calls)} provider calls")
