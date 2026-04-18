# Market Data Layer — Design Spec

**Date:** 2026-04-18
**Status:** Approved design, ready for implementation planning
**Related issues:** Prerequisite for #125 (volatility-normalized position sizing), sub-issue of epic #121 (curated portfolio). Foundation for future #138 (kill switch), #139 (paper trading), #56 (exit signals).

## Context & Motivation

### Current state

Every module in the repo that needs OHLCV data talks directly to Binance/Bybit:

- `btc_scanner.py` — `get_klines` with its own failover logic
- `backtest.py` — its own fetch + bidirectional cache
- `auto_tune.py` — its own fetch for walk-forward windows
- `grid_search_tf.py` — same pattern
- `btc_report.py` — separate fetch path
- `optimize_new_tokens.py` — separate fetch path
- `/ohlcv` endpoint in `btc_api.py` — re-uses scanner's helpers

Scattered pieces of shared infrastructure exist but are not unified:

- Commit `07ad185` — global rate limiter
- Commit `a013534` — regime cache persistence
- Commit `9d02bcd` — bidirectional cache in backtest

### Problem

1. **Duplicated requests.** Scanner, backtest, and reports all fetch the same (symbol, timeframe) bars independently. When all three are active, request rate multiplies.
2. **No cross-module coordination.** Rate limiter is per-module. No single source of truth for what's already been fetched.
3. **Adding new modules reproduces the same plumbing.** Paper trading (#139), kill switch (#138), exit signals (#56) would each reinvent fetching.
4. **Adding the 1d timeframe needed for vol-normalized sizing (#125)** would be yet another parallel fetch path.

### Why this spec first, #125 second

Issue #125 as written requires fetching daily candles for every symbol. Implementing it against the current scattered infrastructure would bake in more duplication. Building a unified market data layer first means #125 becomes a ~40-line consumer.

## Goals & Non-Goals

### Goals

- **Single source of truth** for OHLCV across the entire codebase.
- **Minimum request signature** — fetch only when new closed bars exist.
- **Reusable** by all existing and future modules with a narrow public API.
- **Extensible** along the axes most likely to change (providers, timeframes, metrics).
- **Observable** — metrics exposed through `/status` without new dependencies.
- **Resilient** — sticky failover with recovery probe, graceful degradation, clear error taxonomy.

### Non-goals (v1)

- Indicator caching (RSI/ATR/BB). Indicators are µs to compute; caching them complicates invalidation without meaningful gain.
- Report / signal result caching.
- WebSocket push mode (placeholder left for future).
- Cross-process rate limit coordination.
- DuckDB / Parquet backends (migration path documented, not implemented).

### Measurable success criteria

| Metric | Today | Post-layer target |
|---|---|---|
| Steady-state request rate (10 symbols, scanner + backtest latent, 4 timeframes) | 6 req/min (3 tf, no cache) | ~2.2 req/min (4 tf, cached) |
| Number of modules with independent fetch logic | 6+ | 1 |
| Scanner cold-start latency | ~5s | ~5s (no regression) |
| First 4-year backtest fetch time | ~35s every time | ~35s once, <1s thereafter |
| Public API surface | N/A | 6 functions + 2 utilities |
| Test coverage of `data/` package | N/A | ≥85% |

## Key Design Decisions (Q1–Q8 summary)

These were brainstormed and approved; they are the load-bearing decisions for the rest of the spec.

| # | Decision | Chosen | Alternatives considered |
|---|----------|--------|-------------------------|
| Q1 | Scope | Raw OHLCV only | +indicators, +reports |
| Q2 | Storage | SQLite `ohlcv.db` (new file) | DuckDB, Parquet, reuse `signals.db` |
| Q3 | Freshness | Stale-on-read pull | TTL, scheduler thread |
| Q4 | API shape | 6 module-level functions + utilities | Async, class-based, streaming |
| Q5 | Concurrency | Cooperative optimistic (WAL + idempotent upserts + in-process lock registry) | Single-writer ownership, lock table |
| Q6 | Backfill | Hybrid (lazy tail + explicit range with gap detection + explicit bulk API) | Lazy-only, eager-only |
| Q7 | Failover | Sticky with periodic recovery probe (port existing behavior) | Per-request retry |
| Q8 | Invalidation | Validate at write + explicit `repair()` API + schema versioning | No-op, TTL on historical |

## Architecture

### Package structure

```
data/
    __init__.py                # Re-exports public API
    market_data.py             # Public functions, thin
    _storage.py                # SQLite: thread-local conns, pragmas, upserts, queries
    _fetcher.py                # Provider orchestration, rate limiter, failover, lock registry
    _scheduler.py              # Empty placeholder (future websocket push mode)
    timeframes.py              # TIMEFRAMES registry + delta_ms + last_closed_bar_time
    metrics.py                 # Thread-safe counters + latency histograms + get_stats()
    cli.py                     # python -m data.cli {backfill, repair, stats, init}
    providers/
        __init__.py
        base.py                # Protocol ProviderAdapter, Bar dataclass, exceptions
        binance.py             # BinanceAdapter (primary)
        bybit.py               # BybitAdapter (fallback)
```

**Invariants:**
- Only `market_data.py` and `__init__.py` are public API. Underscore-prefixed modules are private.
- Adding a provider = 1 file in `providers/` + 1 line in the registry.
- Adding a timeframe = 1 line in `TIMEFRAMES` registry.
- Zero new external dependencies (stdlib + pandas + numpy, already in use).

### Storage schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA cache_size = -20000;
PRAGMA temp_store = MEMORY;

CREATE TABLE IF NOT EXISTS ohlcv (
    symbol     TEXT    NOT NULL,
    timeframe  TEXT    NOT NULL,       -- '5m','1h','4h','1d' (extensible)
    open_time  INTEGER NOT NULL,        -- ms UTC, Binance convention
    open       REAL    NOT NULL,
    high       REAL    NOT NULL,
    low        REAL    NOT NULL,
    close      REAL    NOT NULL,
    volume     REAL    NOT NULL,
    provider   TEXT    NOT NULL,        -- 'binance' | 'bybit' | future
    fetched_at INTEGER NOT NULL,        -- ms UTC
    PRIMARY KEY (symbol, timeframe, open_time)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_ohlcv_time
    ON ohlcv(symbol, timeframe, open_time DESC);

CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS symbol_earliest (
    symbol         TEXT NOT NULL,
    timeframe      TEXT NOT NULL,
    first_bar_ms   INTEGER NOT NULL,
    PRIMARY KEY (symbol, timeframe)
);
```

- `WITHOUT ROWID` + composite PK → compact rows, direct lookups.
- Descending index on `open_time` → `tail(limit)` queries are logarithmic.
- `provider` column preserves traceability across failover transitions.
- `symbol_earliest` prevents retry loops for pre-listing historical requests.

### Expected data volume

- ~9M rows total for 4 years × 10 symbols × 4 timeframes
- ~700 MB uncompressed, well below SQLite comfort zone
- Migration path to DuckDB open (same SQL dialect) if backtest analytics ever demand it

### Public API surface (6 functions + utilities)

All live in `data/market_data.py`, re-exported from `data/__init__.py`.

#### `get_klines(symbol, timeframe, limit, force_refresh=False) -> pd.DataFrame`

Last `limit` **closed** bars. Never includes the in-progress bar. Main path for scanner, vol calculation, indicators.

Flow:
1. Compute `expected_max = last_closed_bar_time(timeframe, utcnow())`.
2. Read `cached_max` and `cached_count` from SQLite.
3. If `force_refresh` or cache insufficient, take the per-`(sym, tf)` lock, re-check, fetch only the incremental gap.
4. Return last `limit` bars ordered ascending.

Cache-hit cost: 2 lightweight SELECTs, <1ms.

#### `get_klines_range(symbol, timeframe, start, end) -> pd.DataFrame`

Closed bars in `[start, end)`. Main path for backtest.

Flow:
1. Clamp `end` to last closed bar; clamp `start` to `symbol_earliest.first_bar_ms` if known.
2. Read `(min_t, max_t, count)` from `range_stats`.
3. If `count == expected_count`, return cached range.
4. If `count == 0`, backfill the whole range.
5. Otherwise, backfill edges first (`start..min_t`, `max_t+delta..end`). Recount. If internal gaps remain, run `_fill_internal_gaps`.

Propagates `ProviderError` if a gap cannot be filled; never silently returns partial data.

#### `get_klines_live(symbol, timeframe, limit) -> pd.DataFrame`

Last `limit` bars **including** the in-progress bar. Used only by `/ohlcv` endpoint for the frontend chart.

- Bypasses cache completely.
- Never persists (in-progress bar must not contaminate storage).
- Still subject to rate limiter.

#### `prefetch(symbols, timeframes, limit=210) -> None`

Batch-prefetches all (sym, tf) combinations in parallel using a `ThreadPoolExecutor(max_workers=5)` (configurable). Each worker delegates to `get_klines`, reusing all freshness and locking logic. Rate limiter coordinates between workers. Per-(sym, tf) exceptions log and continue — batch never aborts.

Scanner calls `prefetch(DEFAULT_SYMBOLS, ["5m","1h","4h","1d"], 210)` at the start of each cycle; subsequent per-symbol `get_klines` calls are cache-hits.

#### `backfill(symbol, timeframe, start, end=None) -> int`

Explicit bulk historical fetch. Used by backtest setup and one-time initialization.

- Chunks of 1000 bars per request (below Binance's 1500 limit).
- Progress logs every 1000 bars persisted.
- Idempotent + resumable: crashes mid-backfill continue next run via gap detection.
- Updates `symbol_earliest` when provider returns `[]` for an old chunk (pre-listing).
- Returns count of bars persisted.

#### `repair(symbol, timeframe, start, end=None) -> int`

Force re-fetch and overwrite of a range. Used when a data anomaly is detected.

- Internally: calls the same backfill machinery with INSERT OR REPLACE semantics.
- Tracks `repairs_requested_total` and `bars_overwritten_total` metrics.
- Idempotent.

#### Utility functions (public)

- `get_stats() -> dict` — snapshot of all metrics (counters, latency p50/p95 by label).
- `last_closed_bar_time(timeframe, now=None) -> int` — exposed for callers that need to reason about bar boundaries.

#### CLI helper

`python -m data.cli <command>`:
- `backfill BTCUSDT 1h 2022-01-01` — bulk backfill from date
- `repair BTCUSDT 1h 2026-01-01 2026-02-01` — force refresh
- `stats` — print current metrics
- `init` — create DB + schema (normally done lazily on first use)

### Explicitly NOT in the public API

| Would-be function | Reason omitted |
|---|---|
| `invalidate(...)` | Confusing vs `repair()`. `repair()` covers the case. |
| `evict(...)` | YAGNI at our data volume. |
| `subscribe(...)` / `on_new_bar(...)` | Future push mode, when `_scheduler.py` is filled. |
| `get_providers() / set_providers()` | Providers are static by design. Changing = edit code. |

## Internal Flows

### Boundary conventions (read first)

All `start_ms` / `end_ms` pairs in this spec use **inclusive-both** semantics: both values refer to the `open_time` of real bars. `start_ms` is the open_time of the first bar to include; `end_ms` is the open_time of the last bar to include. This matches Binance's klines API convention (`startTime` and `endTime` are inclusive on open_time).

Expected bar count for a range: `(end_ms - start_ms) / delta_ms(tf) + 1`.

To convert from a half-open datetime range `[start, end)` (common in Python/backtest logic) to our inclusive-both int range: `end_ms = last_closed_bar_time(tf, end)` (clamps end to the most recent fully-closed bar before `end`).

### `get_klines` with double-checked locking

```python
def get_klines(sym, tf, limit, force_refresh=False):
    expected_max = last_closed_bar_time(tf, utcnow())
    cached_max = _storage.max_open_time(sym, tf)
    cached_count = _storage.count_tail(sym, tf, expected_max, limit)
    sufficient = (cached_max is not None
                  and cached_max >= expected_max
                  and cached_count >= limit)
    if force_refresh or not sufficient:
        _fetcher.ensure_fresh(sym, tf, limit, cached_max, expected_max)
    return _storage.tail(sym, tf, limit)

def ensure_fresh(sym, tf, limit, cached_max, expected_max):
    lock = _get_or_create_lock(sym, tf)
    with lock:
        # Re-check after acquiring lock — another thread may have fetched
        new_cached_max = _storage.max_open_time(sym, tf)
        if new_cached_max is not None and new_cached_max >= expected_max:
            metrics.inc("double_checked_hits_total")
            return
        delta = delta_ms(tf)
        start_ms = (new_cached_max + delta) if new_cached_max else expected_max - (limit - 1) * delta
        end_ms = expected_max   # inclusive: open_time of last closed bar
        bars = fetch_with_failover(sym, tf, start_ms, end_ms)
        if bars:
            _storage.upsert_many(bars)
```

**Lock registry:**

```python
_fetch_locks: dict[tuple[str, str], threading.Lock] = {}
_registry_guard = threading.Lock()

def _get_or_create_lock(sym, tf):
    with _registry_guard:
        return _fetch_locks.setdefault((sym, tf), threading.Lock())
```

Memory: max 10 symbols × ~5 timeframes = 50 Lock objects. Negligible.

### Gap detection in `get_klines_range`

```
1. Normalize boundaries (clamp end to last_closed_bar_time, clamp start to first_bar_ms).
   All boundaries are inclusive open_time values.
2. expected_count = (end_ms - start_ms) / delta + 1
3. (min_t, max_t, count) = range_stats(...)
4. if count == expected_count → cache hit, return
5. if count == 0 → backfill whole [start_ms, end_ms]
6. else → backfill edges:
     - if min_t > start_ms → backfill [start_ms, min_t - delta]
     - if max_t < end_ms → backfill [max_t + delta, end_ms]
   Recount. If still < expected, run _fill_internal_gaps over [start_ms, end_ms].
```

Internal gaps algorithm (`_fill_internal_gaps`):

```python
# start_ms and end_ms are inclusive open_time boundaries.
existing = set(_storage.times_in_range(sym, tf, start_ms, end_ms))
delta = delta_ms(tf)
gap_start, cur = None, start_ms
while cur <= end_ms:
    if cur not in existing:
        if gap_start is None:
            gap_start = cur
    else:
        if gap_start is not None:
            _backfill_range(sym, tf, gap_start, cur - delta)  # gap ended just before cur
            gap_start = None
    cur += delta
if gap_start is not None:
    _backfill_range(sym, tf, gap_start, end_ms)
```

Typical case costs:
| Scenario | Path | Fetch cost |
|---|---|---|
| Cached range backtest | Step 4, cache hit | 0 requests |
| First 4-year backtest | Step 5, full backfill | ~350 req (1h) |
| Backtest extending range | Step 6, left edge | ~175 req |
| Historical downtime gap | Step 6, internal fill | ~3 req (just the gap) |

### Backfill chunking

```python
CHUNK_SIZE = 1000
def _backfill_range(sym, tf, start_ms, end_ms):
    # start_ms and end_ms are inclusive open_time boundaries (see conventions).
    delta = delta_ms(tf)
    earliest = _storage.first_bar_ms(sym, tf)
    if earliest is not None:
        start_ms = max(start_ms, earliest)
    if start_ms > end_ms:
        return 0
    cur, total = start_ms, 0
    estimated = (end_ms - start_ms) // delta + 1
    while cur <= end_ms:
        chunk_end = min(cur + (CHUNK_SIZE - 1) * delta, end_ms)  # inclusive
        bars = fetch_with_failover(sym, tf, cur, chunk_end)
        if not bars:
            # Provider returned empty — mark pre-listing and stop.
            _storage.set_first_bar_ms(sym, tf, chunk_end + delta)
            break
        total += _storage.upsert_many(bars)
        cur = bars[-1].open_time + delta  # next bar after last fetched
        if total % 1000 == 0:
            log.info(f"Backfill {sym} {tf}: {total}/{estimated} ({total/estimated*100:.1f}%)")
    return total
```

Resumability comes free: crash + restart → gap detection fills what's missing from where it left off.

### Concurrency model

- **Thread-local connections** via `threading.local()`. Each thread gets its own lazily-initialized `sqlite3.Connection` with WAL pragmas.
- **Cross-process:** SQLite WAL + `busy_timeout=5000` + `INSERT OR REPLACE` = all three combined guarantee correctness without any cross-process coordination mechanism.
- **In-process:** per-`(sym, tf)` `threading.Lock` in a registry prevents duplicate fetches from concurrent threads.
- **Write transactions** use `BEGIN IMMEDIATE` to acquire the write lock at statement start, preventing deadlock retry storms.

Rare cross-process fetch collisions are accepted — `INSERT OR REPLACE` makes them harmless, and the rate limiter absorbs the extra requests.

### Failover state machine

```python
_PROVIDERS = [BinanceAdapter(), BybitAdapter()]
_active_idx = 0
_consecutive_failures = 0
_last_probe_ms = 0

FAILOVER_THRESHOLD = 3
RECOVERY_PROBE_INTERVAL_MS = 300_000

def fetch_with_failover(sym, tf, start_ms, end_ms):
    _maybe_probe_primary_recovery()
    providers_ordered = _PROVIDERS[_active_idx:] + _PROVIDERS[:_active_idx]
    for i, provider in enumerate(providers_ordered):
        try:
            _rate_limiter.acquire(provider.name, provider.rate_limit_per_min)
            bars = provider.fetch_klines(sym, tf, start_ms, end_ms)
            with _state_lock:
                _consecutive_failures = 0
            return bars
        except ProviderInvalidSymbol:
            raise  # fatal, no failover
        except (ProviderRateLimited, ProviderTemporaryError):
            with _state_lock:
                _consecutive_failures += 1
                if _consecutive_failures >= FAILOVER_THRESHOLD and i == 0:
                    _active_idx = (_active_idx + 1) % len(_PROVIDERS)
                    _consecutive_failures = 0
                    metrics.inc("provider_switches_total", ...)
            continue
    raise AllProvidersFailedError(sym, tf, start_ms, end_ms)
```

Recovery probe (every 5 minutes, cheap `is_healthy()` call on primary): if primary comes back up, `_active_idx` reverts to 0. Existing bars persisted from fallback are not overwritten — only new requests use the primary again.

## Extensibility

### Adding a provider (e.g., OKX, Kraken)

1. Create `data/providers/okx.py` implementing `ProviderAdapter`.
2. Add to registry: `_PROVIDERS: list[ProviderAdapter] = [BinanceAdapter(), BybitAdapter(), OKXAdapter()]`.
3. No other code changes. Failover automatically extends; metrics split by provider label.

### Adding a timeframe (e.g., 15m, 30m, 1w)

1. Add entry to `TIMEFRAMES` dict in `timeframes.py`.
2. Ensure each provider's `TF_MAP` translates correctly (one-line addition per provider).

### Adding a metric

1. Call `metrics.inc("my_new_metric", labels={...})` where relevant.
2. Appears automatically in `get_stats()`.

### Migrating storage backend (SQLite → DuckDB/Parquet)

1. Rewrite `_storage.py` against the same internal interface.
2. `market_data.py` consumers are unaffected.
3. Schema remains portable SQL.

### Adding WebSocket push mode

1. Fill `_scheduler.py` with a background thread that subscribes to provider websockets.
2. On new bar close event, call `_storage.upsert_many([bar])` directly.
3. Public API unchanged — `get_klines` returns the same fresh data, just sourced from push instead of pull.

## Observability

### Metrics registered

| Metric | Type | Labels | When |
|---|---|---|---|
| `fetches_total` | counter | provider, tf | each successful fetch |
| `cache_hits_total` | counter | tf | `get_klines` that didn't fetch |
| `fetch_latency_ms` | histogram | provider | each fetch |
| `provider_errors_total` | counter | provider, kind | each provider error |
| `provider_switches_total` | counter | from, to | failover triggered |
| `provider_recoveries_total` | counter | provider | successful recovery probe |
| `fallback_fetches_total` | counter | from, to | request served by fallback |
| `bars_upserted_total` | counter | — | bars persisted |
| `invalid_bars_dropped_total` | counter | — | validation failed |
| `backfill_bars_total` | counter | symbol, tf | bars in explicit backfills |
| `repairs_requested_total` | counter | symbol, tf | `repair()` calls |
| `bars_overwritten_total` | counter | symbol, tf | repairs that changed existing rows |
| `double_checked_hits_total` | counter | — | locking dedup prevented fetch |
| `prefetch_errors_total` | counter | symbol, tf | failures in batch prefetch |

### Integration with `/status`

```python
@app.get("/status")
def status():
    ...
    response["market_data"] = market_data.get_stats()
    return response
```

Zero new endpoints, zero new dependencies.

### Logging policy

- `DEBUG`: cache hits, granular detail (off in prod normally)
- `INFO`: structural events — backfill progress, provider recovery
- `WARNING`: provider errors, failover triggered, invalid bars dropped
- `ERROR`: `AllProvidersFailedError`, schema migration failure
- `CRITICAL`: SQLite corruption, cannot open DB

Logger name: `"data.market"`.

## Error Taxonomy

```
ProviderError (base, may propagate to consumer)
├── ProviderInvalidSymbol      → FATAL for that symbol, NO failover
├── ProviderRateLimited        → triggers failover threshold counter
└── ProviderTemporaryError     → triggers failover threshold counter

AllProvidersFailedError        → raised when every provider has failed
```

**Graceful degradation:**
- `get_klines` with partial cache + provider down → returns cache with `WARN` log; consumer decides.
- `get_klines` with no cache + providers down → raises `AllProvidersFailedError`; consumer decides (scanner skips, backtest aborts).
- Never silently returns empty or partial data where full data was requested.

## Testing Strategy

### Fixtures

```python
@pytest.fixture
def tmp_ohlcv_db(tmp_path, monkeypatch):
    db_path = tmp_path / "ohlcv.db"
    monkeypatch.setattr(data._storage._config, "db_path", str(db_path))
    data._storage._init_schema(data._storage._conn())
    yield db_path

@pytest.fixture
def fake_provider(monkeypatch):
    fake = FakeProvider()
    monkeypatch.setattr(data._fetcher, "_PROVIDERS", [fake])
    return fake
```

`FakeProvider` is a deterministic, injectable stand-in for Binance/Bybit. Tests never hit real APIs.

### Unit test breakdown

| File | Count | Coverage |
|---|---|---|
| `test_timeframes.py` | ~5 | registry, `last_closed_bar_time` boundary cases |
| `test_storage.py` | ~15 | upsert, validation, range queries, thread-local conns, schema init |
| `test_fetcher.py` | ~20 | double-checked locking, failover state, recovery probe, error classification |
| `test_market_data.py` | ~25 | each public function's cache-hit/miss paths, gap detection, pre-listing |
| `test_metrics.py` | ~5 | thread safety, percentile math, get_stats snapshot |
| `test_providers_binance.py` | ~8 | HTTP status mapping, JSON parsing, timeout handling |
| `test_providers_bybit.py` | ~8 | same pattern |

### Integration tests (`tests/test_integration_market_data.py`)

~6 end-to-end scenarios using `FakeProvider` + `tmp_ohlcv_db`:
- `prefetch` + `get_klines` round-trip (scanner cycle)
- `backfill` + `get_klines_range` (backtest flow)
- 10 symbols in parallel, 100 simulated scan cycles → verify total request count
- Crash mid-backfill + restart → verify completion without duplicates
- Cross-fetch failover: primary fails, secondary succeeds, primary recovers, next fetch uses primary

### Property tests (optional, with `hypothesis`)

- For any sequence of `upsert_many` + `range_stats` → count is always ≤ expected_count
- `get_klines_range(sym, tf, X, Y)` always returns bars with `open_time ∈ [X, Y)`
- `repair` after `backfill` leaves ≥ same count of bars

### Explicitly not tested

- Real calls to Binance/Bybit (manual smoke test before deploy)
- Performance benchmarks (v1 target = correctness)
- SQLite corruption recovery (sysadmin/backup responsibility)

Target coverage: ≥85% for `data/` package.

## Consumer: Issue #125 (volatility-normalized sizing)

Once this layer exists, #125 is a thin consumer.

### Yang-Zhang volatility (rationale for #125's formula)

30-day annualized volatility on daily bars using Yang-Zhang estimator. In crypto's 24/7 market, the overnight term collapses toward zero, but Yang-Zhang still captures drift correctly via its weighting factor `k`, and handles the open-close + Rogers-Satchell components optimally.

Statistical efficiency vs close-to-close: ~14x with same sample count. With only 30 daily samples, the ratio `target_vol / asset_vol` is meaningfully more stable than pure CC, which matters because it feeds position sizing.

```python
def annualized_vol_yang_zhang(df_daily: pd.DataFrame) -> float:
    if len(df_daily) < 5:
        return TARGET_VOL_ANNUAL  # neutral fallback
    o, h, l, c = df_daily["open"], df_daily["high"], df_daily["low"], df_daily["close"]
    log_ho = np.log(h / o)
    log_lo = np.log(l / o)
    log_co = np.log(c / o)
    log_oc_prev = np.log(o / c.shift(1)).dropna()
    n = len(df_daily) - 1
    k = 0.34 / (1.34 + (n + 1) / (n - 1))
    sigma_on = log_oc_prev.var(ddof=1)
    sigma_oc = log_co.var(ddof=1)
    sigma_rs = (log_ho * (log_ho - log_co) + log_lo * (log_lo - log_co)).mean()
    var_daily = max(sigma_on + k * sigma_oc + (1 - k) * sigma_rs, 1e-10)
    return float(np.sqrt(var_daily * 365))
```

### Scanner integration

Constants at module top:

```python
TARGET_VOL_ANNUAL = 0.15   # 15% annual, configurable via config.json
VOL_LOOKBACK_DAYS = 30
VOL_MIN_FLOOR = 0.05       # prevents division by near-zero vol
VOL_MAX_CEIL = 0.20        # cap min sizing multiplier to 20% of base
```

In `assess_signal()` where sizing is computed (today around `btc_scanner.py:959`):

```python
# Before:
capital = 1000.0
risk_usd = capital * 0.01

# After:
from data import market_data as md
capital = 1000.0
df_daily = md.get_klines(symbol, "1d", VOL_LOOKBACK_DAYS + 5)  # cache-hit 99%+
asset_vol = annualized_vol_yang_zhang(df_daily)
vol_mult = max(VOL_MAX_CEIL, min(1.0, TARGET_VOL_ANNUAL / max(asset_vol, VOL_MIN_FLOOR)))
risk_usd = capital * 0.01 * vol_mult
# downstream unchanged: qty = risk_usd / sl_dist, val_pos, etc.
```

Report gains 3 new fields: `asset_vol`, `vol_mult`, `risk_usd_adjusted`.

### Clamping rationale

- `max(..., VOL_MAX_CEIL=0.20)`: symbol with 100% annualized vol (e.g., shitcoin pump) → raw ratio 0.15 → clamped to 0.20 → never risk less than 20% of base.
- `min(1.0, ...)`: symbol with 8% vol (e.g., BTC in dead market) → raw ratio 1.88 → clamped to 1.0 → never risk more than base (prevents implicit leverage).

### Backtest integration

```python
# Backtest setup:
for sym in symbols:
    md.backfill(sym, "1d", start_date - timedelta(days=VOL_LOOKBACK_DAYS + 5), end_date)

# In simulation loop, when opening a position:
df_daily_slice = md.get_klines_range(sym, "1d", bar_time - timedelta(days=35), bar_time)
asset_vol = annualized_vol_yang_zhang(df_daily_slice)
vol_mult = ...
risk_amount = capital * RISK_PER_TRADE * position["size_mult"] * vol_mult
```

`get_klines_range(..., end=bar_time)` only returns bars with `open_time < bar_time` — no look-ahead bias.

### Validation plan

- Baseline: current backtest without vol sizing.
- With vol sizing: compare total return, max drawdown, Sharpe, per-symbol P&L contribution.
- Target from epic #121: swing from -$14,655 to +$25,000–$40,000 over 4 years.
- If numbers don't approach target, re-evaluate: clamp values, lookback days, target_vol, or whether vol-normalization stacks with score tier `size_mult`.

## Roadmap

Each phase is independently mergeable. Estimates assume focused work.

| Phase | Scope | Effort | Depends on |
|---|---|---|---|
| 0 | Scaffolding (package layout, empty modules) | 0.5 d | — |
| 1 | `timeframes.py`, `metrics.py`, `providers/base.py` + tests | 0.5 d | 0 |
| 2 | `_storage.py` + tests | 1 d | 1 |
| 3 | `providers/binance.py`, `providers/bybit.py` + tests | 1 d | 1 |
| 4 | `_fetcher.py` with failover + rate limiter + tests | 1 d | 2, 3 |
| 5 | `market_data.py` public API + CLI + integration tests | 1 d | 4 |
| 6 | Migrate `btc_scanner.py` to use the layer, golden-diff validation | 1 d | 5 |
| 7 | Migrate `backtest.py` + ad-hoc scripts to the layer | 0.5 d | 5 |
| 8 | Ship #125 as a consumer (vol sizing in scanner + backtest, comparative run) | 0.5 d | 6, 7 |

**Total: 6–7 focused days (~40–50 hours).**

Parallelizable: Phases 1 and 3 can proceed in parallel (provider adapters don't need timeframes). Phases 6 and 7 can alternate. Phase 8 requires phase 6 stable in production for ≥1 week before shipping.

## Open Questions / Future Work

### Hygiene items (out of scope, should address separately)

- `btc_scanner.py:44` comment says "Top 20 por capitalización" — actual `DEFAULT_SYMBOLS` has 10 after PR #135.
- `CLAUDE.md` still documents 20 symbols — same obsolete text.

### Future enhancements (not required for v1)

- **DuckDB migration:** if backtest analytical queries become a bottleneck, swap `_storage.py` backend. Schema is portable SQL.
- **WebSocket push mode:** populate `_scheduler.py` for real-time bar delivery.
- **Cross-process rate limiter coordination:** if concurrent heavy backfills across 3+ processes become common.
- **Automatic periodic repair** ("sweep bars > 30 days every Sunday"): wait for evidence that Binance historical revisions are a real problem.
- **Cross-provider consistency checks:** compare Binance vs Bybit for the same bar. Double the fetch cost for marginal insight.

## Appendices

### Numeric summary of request rate

Assuming 10 symbols × 4 timeframes (5m, 1h, 4h, 1d):

Steady state (incremental fetches only, cache warm):
- 5m: 10 symbols × (1 fetch / 5 min) = 2.0 req/min
- 1h: 10 symbols × (1 fetch / 60 min) = 0.17 req/min
- 4h: 10 symbols × (1 fetch / 240 min) = 0.04 req/min
- 1d: 10 symbols × (1 fetch / 1440 min) = 0.007 req/min
- **Total: ~2.2 req/min** (vs. 6 req/min today, without cache, with only 3 timeframes)

Cold backfill (4 years, 10 symbols, all timeframes), at conservative 10 req/s:
- 5m: ~4,210 requests → 7 min
- 1h: ~350 requests → 35 s
- 4h: ~90 requests → 9 s
- 1d: ~20 requests → 2 s
- **Total: ~4,670 requests, ~8 min**

Binance rate limit: 1,200 requests/min. Headroom factor: >500x for steady state.

### Design principle recap

- **Cache what's expensive (fetching), not what's cheap (computing).**
- **Narrow public API, deep internals.**
- **Idempotency over coordination.**
- **Single source of truth.**
- **Explicit over automatic** for destructive operations (repair, not TTL sweep).
- **Observable from day 1** (metrics, not logs-only).
- **Extension axes precise** (providers, timeframes, metrics) — resist abstraction elsewhere.
