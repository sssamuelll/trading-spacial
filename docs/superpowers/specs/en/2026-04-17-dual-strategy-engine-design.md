# Dual Strategy Engine — Design Spec

**Date:** 2026-04-17
**Epic:** #131
**Issues:** #132 (trend-following engine), #133 (ADX routing), #134 (backtest dual strategy)
**Author:** Samuel Ballesteros + Claude Opus

---

## 1. Problem Statement

The current system runs a single strategy (mean-reversion via LRC channel) across all symbols. Backtest results show:

- **7 of 20 symbols are profitable** with mean-reversion (+$54,706 / +78.2%)
- **13 symbols are paused** because mean-reversion loses money on them
- Root cause: mean-reversion fails in trending markets (SOL, BNB, etc. trend strongly)
- ADX is already implemented (`calc_adx()`, btc_scanner.py:410-463) but only informational (E7)

The 13 paused symbols represent untapped capital. Many of them exhibit strong trends that a trend-following strategy could capture.

## 2. Solution

Add a second strategy (trend-following via EMA crossover + ATR trailing stop) and an ADX-based router that automatically selects the correct strategy per symbol per scan cycle.

### Success Criteria

**Data-driven:** No fixed target. Run backtest with dual strategy across all 20 symbols (2022-2026). Any symbol with positive P&L enters the portfolio. The numbers decide.

## 3. Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Engine only (#131-#134) | Security fixes (#127-#129) are independent. Token curation (#135-#136) depends on having dual engine first. |
| Architecture | Hybrid Safe | Mean-reversion stays in `btc_scanner.py` (proven +78.2%). New module for trend-following. Minimal scanner change. |
| Timeframes | Adaptive | 5M trigger configurable per-symbol (`use_5m_trigger`). Backtest decides. |
| Regime transition | Lock-in | Strategy that opens position manages the exit regardless of ADX changes. |
| SHORT | Enabled globally | Regime detector gates both strategies. `allow_short` per-symbol as safety override. |
| Exit mechanism | Trailing stop + EMA reversal | No fixed TP for trend-following. Winners run. |

## 4. File Structure

### New Files

```
strategies/
  __init__.py                # exports
  router.py                  # route(adx, symbol, config) -> strategy name
  trend_following.py         # assess_signal() -> dict (same schema as scan())
  trend_following_sim.py     # assess_tf_bar() for backtest simulation
```

### Modified Files (surgical changes)

```
btc_scanner.py    # +15 lines: ADX routing early return after line 831
                  # +1 line: "strategy" field in mean-reversion output
backtest.py       # +20 lines: ADX routing in simulate_strategy loop
config.json       # schema extension: strategy params in symbol_overrides
```

### No Changes

```
btc_api.py        # +5 lines: update_position_trailing_sl() helper for live trailing
signals.db        # zero schema changes — payload stores full JSON
frontend/         # zero changes — reads same JSON
trading_webhook.py
watchdog.py
```

## 5. Router (`strategies/router.py`)

```python
ADX_THRESHOLD = 25  # default, overridable per-symbol

def route(adx: float, symbol: str, config: dict) -> str:
    """Decide which strategy to apply.

    Returns: "mean_reversion" | "trend_following"
    """
    overrides = config.get("symbol_overrides", {})
    sym_cfg = overrides.get(symbol, {})

    # Force strategy if configured
    forced = sym_cfg.get("strategy")
    if forced and forced != "auto":
        return forced

    # Per-symbol ADX threshold
    threshold = sym_cfg.get("adx_threshold", ADX_THRESHOLD)

    return "mean_reversion" if adx < threshold else "trend_following"
```

## 6. Trend-Following Engine (`strategies/trend_following.py`)

### 6.1 Indicators

| Indicator | Default | Config Key | Purpose |
|-----------|---------|-----------|---------|
| EMA fast | 9 | `tf_ema_fast` | Crossover signal |
| EMA slow | 21 | `tf_ema_slow` | Crossover signal |
| EMA filter | 50 | `tf_ema_filter` | Trend confirmation |
| ATR(14) | — | Reuses `calc_atr` | Trailing stop distance |
| ATR trail mult | 2.5x | `tf_atr_trail` | Trailing stop multiplier |
| RSI(14) | — | Reuses `calc_rsi` | Momentum filter |
| ADX/DI+/DI- | — | Already calculated | Trend direction |

### 6.2 Entry Logic

**LONG:**
```
EMA(9) > EMA(21)           # bullish crossover
AND price > EMA(50)         # trend confirmed
AND RSI > 55                # positive momentum (configurable: tf_rsi_entry_long)
AND DI+ > DI-               # ADX directional confirms
AND regime != "SHORT"       # regime detector allows
```

**SHORT:**
```
EMA(9) < EMA(21)           # bearish crossover
AND price < EMA(50)         # trend confirmed
AND RSI < 45                # negative momentum (configurable: tf_rsi_entry_short)
AND DI- > DI+               # ADX directional confirms
AND regime != "LONG"        # regime detector allows
```

### 6.3 5M Trigger (Optional)

- `use_5m_trigger: true` (default) — requires 5M candle in trade direction + RSI 5M confirming
- `use_5m_trigger: false` — EMA 1H crossover IS the trigger, no wait
- Configurable per-symbol in `symbol_overrides`

### 6.4 Exit Logic — Trailing Stop

**No fixed TP. Winners run.**

```
Initial stop:
  LONG:  entry_price - ATR(14) * tf_atr_trail
  SHORT: entry_price + ATR(14) * tf_atr_trail

Each 1H bar:
  LONG:
    new_trail = highest_high_since_entry - ATR * tf_atr_trail
    stop = max(stop, new_trail)        # only rises, never falls
  SHORT:
    new_trail = lowest_low_since_entry + ATR * tf_atr_trail
    stop = min(stop, new_trail)        # only falls, never rises

Exit when:
  price crosses trailing stop
  OR EMA(9) crosses EMA(21) against position  # signal reversal
```

Two possible exits: trailing stop (protects profit) or EMA reversal (trend ended). Whichever comes first.

### 6.5 Scoring System

| Criterion | Points | Condition |
|-----------|--------|-----------|
| T1_EMA_Cross | 2 | EMA(9) crossed EMA(21) in last 3 bars (fresh cross) |
| T2_ADX_Strong | 2 | ADX > 30 (strong trend, not just > 25) |
| T3_Price_Above_Filter | 1 | Price > EMA(50) for LONG, < for SHORT |
| T4_RSI_Momentum | 1 | RSI > 60 (LONG) or < 40 (SHORT) |
| T5_Volume | 1 | Volume > 20-bar average |
| T6_DI_Spread | 1 | |DI+ - DI-| > 10 — clear directional separation |
| T7_Macro_Aligned | 1 | Price vs SMA100 4H aligned with direction |

**Max: 9 points** (same scale as mean-reversion). Sizing uses same table:
- 0-1 = 50% size
- 2-3 = 100% size
- 4+ = 150% size

### 6.6 Output Schema

`assess_signal()` returns a dict with the **exact same fields** as `scan()`, plus:

```python
{
    # ... all standard scan() fields ...
    "strategy": "trend_following",
    "tf_indicators": {
        "ema_fast": value,
        "ema_slow": value,
        "ema_filter": value,
        "trailing_stop": stop_price,
        "di_plus": value,
        "di_minus": value,
    },
}
```

Mean-reversion adds `"strategy": "mean_reversion"` to its existing output.

### 6.7 DI+/DI- Calculation

The existing `calc_adx()` returns only ADX (not DI+/DI-). Instead of modifying its signature (which would break existing callers), a `calc_di_components()` function in `strategies/trend_following.py` performs the same calculation and returns `(di_plus_series, di_minus_series)`.

## 7. Scanner Integration (`btc_scanner.py`)

Surgical change after line 831 (ADX calculated) and before line 833 (LRC evaluation):

```python
# line 831 (existing)
cur_adx = round(float(adx_1h.iloc[-1]), 2) if not pd.isna(adx_1h.iloc[-1]) else 0

# NEW: ADX Strategy Routing
from strategies.router import route
_cfg_path = os.path.join(SCRIPT_DIR, "config.json")
_cfg = {}
if os.path.exists(_cfg_path):
    try:
        with open(_cfg_path) as _f:
            _cfg = json.load(_f)
    except Exception:
        pass

strategy = route(cur_adx, symbol, _cfg)
rep["strategy"] = strategy

if strategy == "trend_following":
    from strategies.trend_following import assess_signal, calc_di_components
    di_plus, di_minus = calc_di_components(df1h, 14)

    tf_result = assess_signal(
        df1h=df1h, df4h=df4h, df5m=df5m,
        price=price, symbol=symbol,
        regime=regime, regime_data=regime_data,
        adx=cur_adx, di_plus=di_plus, di_minus=di_minus,
        config=_cfg,
    )
    rep.update(tf_result)
    clean_dict(rep)
    return rep

# line 833 (existing, continues mean-reversion unchanged)
sma100_4h = calc_sma(df4h["close"], 100).iloc[-1]
```

At line 1025, mean-reversion adds `"strategy": "mean_reversion"` to its output.

## 8. Backtest Integration (`backtest.py`)

In `simulate_strategy()` loop, after calculating ADX and before LRC evaluation:

```python
# ADX for routing
adx_series = calc_adx(window_1h, 14)
cur_adx = float(adx_series.iloc[-1]) if not pd.isna(adx_series.iloc[-1]) else 0

# Strategy routing
from strategies.router import route
strategy = route(cur_adx, symbol, backtest_config)

if strategy == "trend_following":
    result = assess_tf_bar(
        window_1h=window_1h, df4h=df4h, df5m=df5m,
        bar_time=bar_time, price=price, symbol=symbol,
        regime=regime, cur_adx=cur_adx,
        config=backtest_config,
        tf_state=tf_state,
    )
    if result == "enter":
        position = tf_state["position"]
    elif result == "exit":
        trades.append(tf_state["last_trade"])
        capital += tf_state["last_trade"]["pnl_usd"]
        position = None
    continue

# (continues mean-reversion as today)
```

### 8.1 Trend-Following Simulation State

```python
tf_state = {
    "position": None,
    "highest_high": None,
    "lowest_low": None,
    "trailing_stop": None,
    "entry_ema_fast": None,
    "entry_ema_slow": None,
}
```

### 8.2 Per-Strategy Breakdown in Report

```
Per-Strategy Breakdown
Strategy          | Trades | Win Rate | P&L      | Avg Trade
mean_reversion    |    45  |  22.2%   | +$12,400 | +$275
trend_following   |    32  |  34.4%   | +$8,900  | +$278
TOTAL             |    77  |  27.3%   | +$21,300 | +$276
```

### 8.3 Additional Trade Fields

```python
trade = {
    # ... existing fields ...
    "strategy": "trend_following",
    "adx_at_entry": cur_adx,
    "trailing_stop_final": tf_state["trailing_stop"],
    "max_favorable_excursion": highest_high - entry_price,
}
```

## 9. Production Integration

### 9.1 Trailing Stop in Live Trading

Trend-following recalculates the trailing stop each scan cycle. The flow:

1. `btc_scanner.scan()` routes to `evaluate()` which returns `sizing_1h.sl_precio` with the updated trailing stop value
2. `btc_api.py`'s `execute_scan_for_symbol()` receives this report
3. If a position is open for this symbol, `check_position_stops()` compares current price against the position's `sl_price`
4. To update the trailing stop: `evaluate()` also returns `"trailing_stop_update": new_sl_price` when there's an open position. The scanner loop in `btc_api.py` checks this field and updates the position's `sl_price` in the DB via a new helper `update_position_trailing_sl(symbol, new_sl)` (~5 lines of SQL UPDATE)

This is the **one addition to btc_api.py**: a small function that updates `sl_price` for open trend-following positions when the trailing stop moves. It's called from the existing scan loop, not a new endpoint.

### 9.2 Telegram Message Format

```
TREND-FOLLOWING signal:
  SEÑAL TREND-FOLLOWING LONG — SOLUSDT
  Score: 6/9 (T1+T2+T3+T4+T5+T7)
  EMA(9) > EMA(21), ADX=32, DI+ > DI-
  Trailing Stop: $142.30 (2.5x ATR)
  Strategy: trend_following

MEAN-REVERSION signal (unchanged):
  SEÑAL LONG — BTCUSDT
  Score: 5/9 (C1+C2+C4+C5+C7)
  LRC%=18, RSI=38
  SL: $62,400 | TP: $67,200
  Strategy: mean_reversion
```

## 10. Config Schema Extension

All new params live inside `symbol_overrides`. Global defaults in the module.

```json
{
  "symbol_overrides": {
    "SOLUSDT": {
      "atr_sl_mult": 1.0,
      "atr_tp_mult": 4.0,
      "atr_be_mult": 1.5,
      "strategy": "auto",
      "adx_threshold": 25,
      "allow_short": true,
      "use_5m_trigger": true,
      "tf_ema_fast": 9,
      "tf_ema_slow": 21,
      "tf_ema_filter": 50,
      "tf_atr_trail": 2.5,
      "tf_rsi_entry_long": 55,
      "tf_rsi_entry_short": 45
    }
  }
}
```

## 11. Testing Strategy

### 11.1 New Test Files

```
tests/
  test_router.py             # router logic (7 tests)
  test_trend_following.py    # engine unit tests (18 tests)
  test_backtest_dual.py      # integration tests (5 tests)
```

### 11.2 Router Tests (`test_router.py`)

| Test | Validates |
|------|-----------|
| `test_route_adx_below_threshold` | ADX=20 -> "mean_reversion" |
| `test_route_adx_above_threshold` | ADX=30 -> "trend_following" |
| `test_route_adx_exact_threshold` | ADX=25 -> "trend_following" (>= 25) |
| `test_route_forced_strategy` | Override strategy="trend_following" with ADX=15 -> respects override |
| `test_route_auto_strategy` | strategy="auto" -> uses ADX |
| `test_route_custom_threshold` | adx_threshold=30 per-symbol -> respects custom |
| `test_route_unknown_symbol` | No override -> uses defaults |

### 11.3 Trend-Following Tests (`test_trend_following.py`)

| Test | Validates |
|------|-----------|
| `test_ema_crossover_long` | EMA(9) > EMA(21) + price > EMA(50) -> LONG |
| `test_ema_crossover_short` | EMA(9) < EMA(21) + price < EMA(50) -> SHORT |
| `test_no_signal_no_cross` | Parallel EMAs -> None |
| `test_rsi_filter_blocks_entry` | RSI=52 (< 55) -> no LONG |
| `test_di_direction_mismatch` | Cross LONG but DI- > DI+ -> no entry |
| `test_regime_blocks_short` | SHORT signal + regime=LONG -> blocked |
| `test_scoring_all_criteria` | All T1-T7 active -> score=9 |
| `test_scoring_minimal` | Only T1+T3 -> score=3 |
| `test_trailing_stop_long_rises` | Trailing rises with new highs |
| `test_trailing_stop_long_never_falls` | Trailing holds on pullback |
| `test_trailing_stop_short_falls` | Trailing falls with new lows |
| `test_exit_on_trailing_hit` | Price crosses trailing -> exit |
| `test_exit_on_ema_reversal` | EMA(9) < EMA(21) in LONG -> exit |
| `test_exit_first_condition_wins` | Both exit conditions same bar |
| `test_5m_trigger_enabled` | use_5m_trigger=true -> requires 5M confirmation |
| `test_5m_trigger_disabled` | use_5m_trigger=false -> EMA cross is trigger |
| `test_output_schema_matches_scan` | Output has all scan() fields |
| `test_configurable_params` | Custom EMA params -> used correctly |

### 11.4 Integration Tests (`test_backtest_dual.py`)

| Test | Validates |
|------|-----------|
| `test_dual_strategy_routes_correctly` | Trades tagged by correct strategy |
| `test_mean_reversion_unchanged` | MR-only backtest identical to current results |
| `test_trend_following_only` | TF-only generates trailing stop trades |
| `test_strategy_transition` | ADX oscillation -> no orphan positions, lock-in works |
| `test_report_per_strategy_breakdown` | Report shows per-strategy metrics table |

### 11.5 Regression Test (Critical)

```python
def test_mean_reversion_regression():
    """CRITICAL: mean-reversion results MUST be identical before and after.

    Runs backtest on 7 profitable symbols with ADX forced < 25.
    Compares trade count, total P&L, win rate against known baselines.
    """
    # NOTE: Exact baseline values to be captured by running current backtest
    # on each symbol BEFORE any code changes. This is Phase 2 step 2.2.
    BASELINE = {
        "DOGEUSDT": {"trades": "TBD", "pnl": "TBD"},
        "BTCUSDT":  {"trades": "TBD", "pnl": "TBD"},
        "ADAUSDT":  {"trades": "TBD", "pnl": "TBD"},
        "XLMUSDT":  {"trades": "TBD", "pnl": "TBD"},
        "AVAXUSDT": {"trades": "TBD", "pnl": "TBD"},
        "UNIUSDT":  {"trades": "TBD", "pnl": "TBD"},
        "ETHUSDT":  {"trades": "TBD", "pnl": "TBD"},
    }
```

## 12. Implementation Phases

```
Phase 1: Foundation (zero risk)
  1.1 strategies/__init__.py + router.py + tests
  1.2 strategies/trend_following.py (evaluate) + tests
  1.3 calc_di_components() + tests

Phase 2: Scanner integration (minimal change)
  2.1 btc_scanner.py — early return + "strategy" field
  2.2 Mean-reversion regression test (MUST PASS before continuing)
  2.3 Config schema extension in symbol_overrides

Phase 3: Backtest engine
  3.1 strategies/trend_following_sim.py (bar-by-bar simulation)
  3.2 backtest.py — ADX routing in loop
  3.3 Per-strategy breakdown in report
  3.4 Backtest regression test (identical MR results)

Phase 4: Validation (data-driven)
  4.1 Backtest trend-following on 13 paused symbols
  4.2 Backtest dual strategy on all 20 symbols (2022-2026)
  4.3 Analysis: which symbols profitable with which strategy
  4.4 Generate optimized symbol_overrides from results

Phase 5: Production
  5.1 Update config.json with validated overrides
  5.2 Telegram message format for trend-following
  5.3 Smoke test: manual scan of 2-3 symbols with ADX > 25
  5.4 Deploy: activate in production
```

## 13. Gates

| Gate | Between | Criterion |
|------|---------|-----------|
| G1 | Phase 1 -> 2 | All trend_following.py and router.py tests pass |
| G2 | Phase 2 -> 3 | Regression: `scan()` mean-reversion output identical to current |
| G3 | Phase 3 -> 4 | Regression: backtest mean-reversion produces same trades/P&L |
| G4 | Phase 4 -> 5 | At least 3 of 13 paused symbols profitable with dual strategy |

**If G4 fails:** System stays with mean-reversion for the 7 current symbols. Trend-following code remains available but inactive. Architecture is extensible for future strategies.

## 14. What This Spec Does NOT Cover

- Security fixes (#127-#129) — separate PRs, independent scope
- Token curation (#135) — depends on Phase 4 results
- Parameter grid search (#136) — after dual engine is validated
- Frontend UI changes — cosmetic, post-v1
- Volume breakout or other strategies — future extension using same architecture
