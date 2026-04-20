"""SQLite storage for OHLCV bars. Thread-local connections, WAL mode, idempotent upserts."""
import logging
import os
import sqlite3
import threading
from pathlib import Path

import pandas as pd

from data.providers.base import Bar
from data import metrics

log = logging.getLogger("data.market")

SCHEMA_VERSION = 1

_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = str(_ROOT / "data" / "ohlcv.db")

_tls = threading.local()


def _conn() -> sqlite3.Connection:
    """Lazy thread-local connection with WAL pragmas applied."""
    if not hasattr(_tls, "conn"):
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None, timeout=5)
        _apply_pragmas(conn)
        _tls.conn = conn
    return _tls.conn


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA cache_size = -20000;
        PRAGMA temp_store = MEMORY;
    """)


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS ohlcv (
    symbol     TEXT    NOT NULL,
    timeframe  TEXT    NOT NULL,
    open_time  INTEGER NOT NULL,
    open       REAL    NOT NULL,
    high       REAL    NOT NULL,
    low        REAL    NOT NULL,
    close      REAL    NOT NULL,
    volume     REAL    NOT NULL,
    provider   TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, timeframe, open_time)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_ohlcv_time
    ON ohlcv(symbol, timeframe, open_time DESC);

CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS symbol_earliest (
    symbol         TEXT    NOT NULL,
    timeframe      TEXT    NOT NULL,
    first_bar_ms   INTEGER NOT NULL,
    PRIMARY KEY (symbol, timeframe)
);
"""


def init_schema() -> None:
    """Create tables and seed schema_version if new DB."""
    conn = _conn()
    conn.executescript(_SCHEMA_SQL)
    current = conn.execute("SELECT v FROM meta WHERE k='schema_version'").fetchone()
    if current is None:
        conn.execute(
            "INSERT INTO meta (k, v) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )


def first_bar_ms(symbol: str, timeframe: str) -> int | None:
    row = _conn().execute(
        "SELECT first_bar_ms FROM symbol_earliest WHERE symbol=? AND timeframe=?",
        (symbol, timeframe),
    ).fetchone()
    return row[0] if row else None


def set_first_bar_ms(symbol: str, timeframe: str, value_ms: int) -> None:
    _conn().execute(
        "INSERT OR REPLACE INTO symbol_earliest (symbol, timeframe, first_bar_ms) VALUES (?, ?, ?)",
        (symbol, timeframe, value_ms),
    )


def _is_valid_bar(bar: Bar) -> bool:
    if bar.high < bar.low:
        return False
    if bar.high < max(bar.open, bar.close):
        return False
    if bar.low > min(bar.open, bar.close):
        return False
    if bar.volume < 0:
        return False
    if bar.open <= 0 or bar.close <= 0:
        return False
    return True


_UPSERT_SQL = """
INSERT OR REPLACE INTO ohlcv
    (symbol, timeframe, open_time, open, high, low, close, volume, provider, fetched_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def upsert_many(bars: list[Bar]) -> int:
    """Insert or replace a batch of bars. Returns count persisted.

    Invalid bars (failing _is_valid_bar) are dropped with a WARN log + metric.
    """
    if not bars:
        return 0
    valid = [b for b in bars if _is_valid_bar(b)]
    dropped = len(bars) - len(valid)
    if dropped:
        metrics.inc("invalid_bars_dropped_total", dropped)
        log.warning("Dropped %d invalid bars during upsert_many", dropped)
    if not valid:
        return 0
    conn = _conn()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.executemany(_UPSERT_SQL, [b.as_tuple() for b in valid])
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    metrics.inc("bars_upserted_total", len(valid))
    return len(valid)


def max_open_time(symbol: str, timeframe: str) -> int | None:
    row = _conn().execute(
        "SELECT MAX(open_time) FROM ohlcv WHERE symbol=? AND timeframe=?",
        (symbol, timeframe),
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def count_tail(symbol: str, timeframe: str, end_time_inclusive: int, limit: int) -> int:
    """Count bars with open_time <= end_time_inclusive, up to `limit`."""
    row = _conn().execute(
        """SELECT COUNT(*) FROM (
               SELECT 1 FROM ohlcv
               WHERE symbol=? AND timeframe=? AND open_time <= ?
               ORDER BY open_time DESC LIMIT ?
           )""",
        (symbol, timeframe, end_time_inclusive, limit),
    ).fetchone()
    return row[0]


_OHLCV_COLUMNS = ["open_time", "open", "high", "low", "close", "volume", "provider", "fetched_at"]


def _empty_ohlcv_df() -> pd.DataFrame:
    """Typed empty frame. Needed because pd.DataFrame([], columns=...) yields
    all-object dtypes, which silently promote numerics to object on concat."""
    return pd.DataFrame({
        "open_time": pd.Series(dtype="int64"),
        "open": pd.Series(dtype="float64"),
        "high": pd.Series(dtype="float64"),
        "low": pd.Series(dtype="float64"),
        "close": pd.Series(dtype="float64"),
        "volume": pd.Series(dtype="float64"),
        "provider": pd.Series(dtype="object"),
        "fetched_at": pd.Series(dtype="int64"),
    })


def tail(symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    """Last `limit` bars ordered ascending."""
    rows = _conn().execute(
        """SELECT open_time, open, high, low, close, volume, provider, fetched_at
           FROM ohlcv WHERE symbol=? AND timeframe=?
           ORDER BY open_time DESC LIMIT ?""",
        (symbol, timeframe, limit),
    ).fetchall()
    if not rows:
        return _empty_ohlcv_df()
    df = pd.DataFrame(rows, columns=_OHLCV_COLUMNS)
    return df.iloc[::-1].reset_index(drop=True)


def range_(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> pd.DataFrame:
    """Bars with open_time in [start_ms, end_ms] inclusive, ordered ascending."""
    rows = _conn().execute(
        """SELECT open_time, open, high, low, close, volume, provider, fetched_at
           FROM ohlcv WHERE symbol=? AND timeframe=? AND open_time BETWEEN ? AND ?
           ORDER BY open_time ASC""",
        (symbol, timeframe, start_ms, end_ms),
    ).fetchall()
    if not rows:
        return _empty_ohlcv_df()
    return pd.DataFrame(rows, columns=_OHLCV_COLUMNS)


def range_stats(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> tuple[int | None, int | None, int]:
    """Return (min_open_time, max_open_time, count) for bars in [start_ms, end_ms] inclusive."""
    row = _conn().execute(
        """SELECT MIN(open_time), MAX(open_time), COUNT(*) FROM ohlcv
           WHERE symbol=? AND timeframe=? AND open_time BETWEEN ? AND ?""",
        (symbol, timeframe, start_ms, end_ms),
    ).fetchone()
    return (row[0], row[1], row[2] or 0)


def times_in_range(symbol: str, timeframe: str, start_ms: int, end_ms: int) -> list[int]:
    """List of open_time values present in [start_ms, end_ms] inclusive."""
    rows = _conn().execute(
        """SELECT open_time FROM ohlcv
           WHERE symbol=? AND timeframe=? AND open_time BETWEEN ? AND ?""",
        (symbol, timeframe, start_ms, end_ms),
    ).fetchall()
    return [r[0] for r in rows]
