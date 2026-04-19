"""SQLite storage for OHLCV bars. Thread-local connections, WAL mode, idempotent upserts."""
import os
import sqlite3
import threading
from pathlib import Path

from data.providers.base import Bar


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
