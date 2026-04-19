import os
import sqlite3
import threading
import pytest
from data import _storage


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
