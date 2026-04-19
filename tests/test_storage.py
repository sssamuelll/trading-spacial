import os
import sqlite3
import threading
import time
from dataclasses import asdict
import pytest
from data import _storage
from data.providers.base import Bar


class TestSchemaInit:
    def test_init_creates_tables(self, tmp_ohlcv_db):
        conn = _storage._conn()
        names = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        assert "ohlcv" in names
        assert "meta" in names
        assert "symbol_earliest" in names

    def test_init_creates_index(self, tmp_ohlcv_db):
        conn = _storage._conn()
        idx = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ohlcv_time'"
        ).fetchone()
        assert idx is not None

    def test_init_sets_schema_version(self, tmp_ohlcv_db):
        conn = _storage._conn()
        v = conn.execute("SELECT v FROM meta WHERE k='schema_version'").fetchone()
        assert v[0] == "1"

    def test_pragmas_wal_mode(self, tmp_ohlcv_db):
        conn = _storage._conn()
        mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "wal"


class TestSymbolEarliest:
    def test_first_bar_ms_missing_returns_none(self, tmp_ohlcv_db):
        assert _storage.first_bar_ms("BTCUSDT", "1h") is None

    def test_set_and_get_first_bar_ms(self, tmp_ohlcv_db):
        _storage.set_first_bar_ms("BTCUSDT", "1h", 1609459200000)
        assert _storage.first_bar_ms("BTCUSDT", "1h") == 1609459200000

    def test_set_first_bar_ms_upsert(self, tmp_ohlcv_db):
        _storage.set_first_bar_ms("BTCUSDT", "1h", 1000)
        _storage.set_first_bar_ms("BTCUSDT", "1h", 2000)  # update
        assert _storage.first_bar_ms("BTCUSDT", "1h") == 2000


class TestThreadLocalConns:
    def test_different_threads_get_different_conns(self, tmp_ohlcv_db):
        conns = {}
        def worker(name):
            conns[name] = id(_storage._conn())
        t1 = threading.Thread(target=worker, args=("t1",))
        t2 = threading.Thread(target=worker, args=("t2",))
        t1.start(); t2.start(); t1.join(); t2.join()
        assert conns["t1"] != conns["t2"]

    def test_same_thread_reuses_conn(self, tmp_ohlcv_db):
        c1 = _storage._conn()
        c2 = _storage._conn()
        assert c1 is c2


def _mk_bar(open_time=1000, price=100.0, **overrides):
    defaults = dict(
        symbol="BTCUSDT", timeframe="1h", open_time=open_time,
        open=price, high=price * 1.02, low=price * 0.98, close=price, volume=10.0,
        provider="test", fetched_at=int(time.time() * 1000),
    )
    defaults.update(overrides)
    return Bar(**defaults)


class TestUpsertMany:
    def test_insert_new_bars(self, tmp_ohlcv_db):
        bars = [_mk_bar(open_time=t * 3600_000) for t in range(5)]
        n = _storage.upsert_many(bars)
        assert n == 5
        count = _storage._conn().execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0]
        assert count == 5

    def test_upsert_overwrites_same_pk(self, tmp_ohlcv_db):
        _storage.upsert_many([_mk_bar(open_time=1000, price=100.0)])
        _storage.upsert_many([_mk_bar(open_time=1000, price=200.0)])
        row = _storage._conn().execute(
            "SELECT close FROM ohlcv WHERE open_time=1000").fetchone()
        assert row[0] == 200.0

    def test_drops_invalid_bars_high_lt_low(self, tmp_ohlcv_db, caplog):
        bad = _mk_bar(open_time=1000, price=100.0)
        bad = Bar(**{**asdict(bad), "high": 50.0, "low": 150.0})  # swapped
        good = _mk_bar(open_time=2000, price=100.0)
        n = _storage.upsert_many([bad, good])
        assert n == 1
        count = _storage._conn().execute("SELECT COUNT(*) FROM ohlcv").fetchone()[0]
        assert count == 1

    def test_drops_invalid_bars_negative_volume(self, tmp_ohlcv_db):
        bad = _mk_bar(open_time=1000)
        bad = Bar(**{**asdict(bad), "volume": -5.0})
        assert _storage.upsert_many([bad]) == 0

    def test_drops_invalid_bars_zero_price(self, tmp_ohlcv_db):
        bad = _mk_bar(open_time=1000)
        bad = Bar(**{**asdict(bad), "open": 0.0})
        assert _storage.upsert_many([bad]) == 0

    def test_high_below_open_or_close_is_invalid(self, tmp_ohlcv_db):
        bad = _mk_bar(open_time=1000, price=100.0)
        bad = Bar(**{**asdict(bad), "high": 99.0, "low": 95.0, "open": 100.0, "close": 98.0})
        # high (99) < open (100) → invalid
        assert _storage.upsert_many([bad]) == 0

    def test_empty_list_is_noop(self, tmp_ohlcv_db):
        assert _storage.upsert_many([]) == 0


class TestQueryMethods:
    def test_max_open_time_empty(self, tmp_ohlcv_db):
        assert _storage.max_open_time("BTCUSDT", "1h") is None

    def test_max_open_time_returns_latest(self, tmp_ohlcv_db):
        _storage.upsert_many([_mk_bar(open_time=t * 3600_000) for t in [1, 5, 3]])
        assert _storage.max_open_time("BTCUSDT", "1h") == 5 * 3600_000

    def test_count_tail(self, tmp_ohlcv_db):
        _storage.upsert_many([_mk_bar(open_time=t * 3600_000) for t in range(10)])
        # count bars with open_time <= 5*3600_000, up to 3
        assert _storage.count_tail("BTCUSDT", "1h", 5 * 3600_000, 3) == 3
        # no upper bound reached: returns all
        assert _storage.count_tail("BTCUSDT", "1h", 9 * 3600_000, 100) == 10

    def test_tail_returns_ascending(self, tmp_ohlcv_db):
        bars = [_mk_bar(open_time=t * 3600_000, price=float(t)) for t in [3, 1, 4, 1, 5, 9, 2, 6]]
        _storage.upsert_many(bars)
        df = _storage.tail("BTCUSDT", "1h", 3)
        # last 3 bars sorted ascending by open_time
        assert list(df["open_time"]) == [5 * 3600_000, 6 * 3600_000, 9 * 3600_000]

    def test_range_returns_filtered(self, tmp_ohlcv_db):
        _storage.upsert_many([_mk_bar(open_time=t * 3600_000) for t in range(10)])
        df = _storage.range_("BTCUSDT", "1h", 2 * 3600_000, 5 * 3600_000)
        assert list(df["open_time"]) == [t * 3600_000 for t in [2, 3, 4, 5]]

    def test_range_stats(self, tmp_ohlcv_db):
        _storage.upsert_many([_mk_bar(open_time=t * 3600_000) for t in [2, 3, 7, 8]])
        min_t, max_t, count = _storage.range_stats("BTCUSDT", "1h", 0, 10 * 3600_000)
        assert min_t == 2 * 3600_000
        assert max_t == 8 * 3600_000
        assert count == 4

    def test_range_stats_empty(self, tmp_ohlcv_db):
        min_t, max_t, count = _storage.range_stats("BTCUSDT", "1h", 0, 3600_000)
        assert min_t is None
        assert max_t is None
        assert count == 0

    def test_times_in_range(self, tmp_ohlcv_db):
        times_input = [1, 2, 5, 7]
        _storage.upsert_many([_mk_bar(open_time=t * 3600_000) for t in times_input])
        result = _storage.times_in_range("BTCUSDT", "1h", 0, 10 * 3600_000)
        assert set(result) == {t * 3600_000 for t in times_input}
