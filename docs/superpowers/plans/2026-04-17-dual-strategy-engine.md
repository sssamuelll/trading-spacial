# Dual Strategy Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trend-following strategy (EMA crossover + ATR trailing stop) alongside the existing mean-reversion strategy, with an ADX-based router that selects the correct strategy per symbol per scan cycle.

**Architecture:** Hybrid Safe -- mean-reversion stays untouched in `btc_scanner.py`. New `strategies/` module contains trend-following engine and router. Scanner gets a surgical 15-line early return. Backtest gets ADX routing in its simulation loop.

**Tech Stack:** Python 3, pandas, numpy. Existing `btc_scanner.py` indicator functions. pytest for testing.

**Spec:** `docs/superpowers/specs/en/2026-04-17-dual-strategy-engine-design.md`

---

## File Structure

```
NEW FILES:
  strategies/__init__.py              -- module exports
  strategies/router.py                -- route(adx, symbol, config) -> strategy name
  strategies/trend_following.py       -- assess_signal() + calc_di_components() + scoring
  strategies/trend_following_sim.py   -- assess_tf_bar() for backtest simulation
  tests/test_router.py                -- router unit tests
  tests/test_trend_following.py       -- trend-following engine unit tests
  tests/test_backtest_dual.py         -- integration tests for dual backtest

MODIFIED FILES:
  btc_scanner.py:831-832              -- insert ADX routing early return (+15 lines)
  btc_scanner.py:1025                 -- add "strategy": "mean_reversion" to rep.update()
  backtest.py:354-360                 -- insert ADX routing before LRC check (+25 lines)
  backtest.py:240-248                 -- add tf_state param and init to simulate_strategy()
  backtest.py:530-553                 -- handle tf open position at end of sim
  backtest.py:724                     -- add per-strategy breakdown to generate_report()
```

---

## Task 1: Router Module

**Files:**
- Create: `strategies/__init__.py`
- Create: `strategies/router.py`
- Create: `tests/test_router.py`

- [ ] **Step 1: Create strategies package**

```python
# strategies/__init__.py
from strategies.router import route
```

- [ ] **Step 2: Write failing tests for router**

```python
# tests/test_router.py
import pytest
from strategies.router import route, ADX_THRESHOLD


class TestRouteDefaults:
    def test_adx_below_threshold_returns_mean_reversion(self):
        result = route(adx=20.0, symbol="BTCUSDT", config={})
        assert result == "mean_reversion"

    def test_adx_above_threshold_returns_trend_following(self):
        result = route(adx=30.0, symbol="BTCUSDT", config={})
        assert result == "trend_following"

    def test_adx_exact_threshold_returns_trend_following(self):
        result = route(adx=25.0, symbol="BTCUSDT", config={})
        assert result == "trend_following"

    def test_adx_zero_returns_mean_reversion(self):
        result = route(adx=0.0, symbol="BTCUSDT", config={})
        assert result == "mean_reversion"


class TestRouteOverrides:
    def test_forced_trend_following_ignores_adx(self):
        config = {"symbol_overrides": {"SOLUSDT": {"strategy": "trend_following"}}}
        result = route(adx=10.0, symbol="SOLUSDT", config=config)
        assert result == "trend_following"

    def test_forced_mean_reversion_ignores_adx(self):
        config = {"symbol_overrides": {"SOLUSDT": {"strategy": "mean_reversion"}}}
        result = route(adx=40.0, symbol="SOLUSDT", config=config)
        assert result == "mean_reversion"

    def test_auto_strategy_uses_adx(self):
        config = {"symbol_overrides": {"SOLUSDT": {"strategy": "auto"}}}
        result = route(adx=30.0, symbol="SOLUSDT", config=config)
        assert result == "trend_following"

    def test_custom_adx_threshold(self):
        config = {"symbol_overrides": {"SOLUSDT": {"adx_threshold": 30}}}
        result = route(adx=27.0, symbol="SOLUSDT", config=config)
        assert result == "mean_reversion"

    def test_custom_adx_threshold_above(self):
        config = {"symbol_overrides": {"SOLUSDT": {"adx_threshold": 30}}}
        result = route(adx=30.0, symbol="SOLUSDT", config=config)
        assert result == "trend_following"

    def test_unknown_symbol_uses_defaults(self):
        config = {"symbol_overrides": {"BTCUSDT": {"strategy": "trend_following"}}}
        result = route(adx=20.0, symbol="ETHUSDT", config=config)
        assert result == "mean_reversion"

    def test_empty_symbol_overrides(self):
        config = {"symbol_overrides": {}}
        result = route(adx=30.0, symbol="BTCUSDT", config=config)
        assert result == "trend_following"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/test_router.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'strategies'`

- [ ] **Step 4: Implement router**

```python
# strategies/router.py
"""
ADX-based strategy router.

Routes each symbol to the correct strategy based on ADX value
and optional per-symbol overrides in config.
"""

ADX_THRESHOLD = 25  # default, overridable per-symbol


def route(adx: float, symbol: str, config: dict) -> str:
    """Decide which strategy to apply.

    Args:
        adx: Current ADX value for the symbol.
        symbol: Trading pair (e.g. "BTCUSDT").
        config: Full config dict (may contain symbol_overrides).

    Returns:
        "mean_reversion" or "trend_following"
    """
    overrides = config.get("symbol_overrides", {})
    sym_cfg = overrides.get(symbol, {})
    if not isinstance(sym_cfg, dict):
        sym_cfg = {}

    # Force strategy if configured
    forced = sym_cfg.get("strategy")
    if forced and forced != "auto":
        return forced

    # Per-symbol ADX threshold
    threshold = sym_cfg.get("adx_threshold", ADX_THRESHOLD)

    return "mean_reversion" if adx < threshold else "trend_following"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_router.py -v`
Expected: 11 passed

- [ ] **Step 6: Commit**

```bash
git add strategies/__init__.py strategies/router.py tests/test_router.py
git commit -m "feat(strategies): add ADX-based strategy router (#133)

Routes symbols to mean_reversion or trend_following based on ADX value.
Supports per-symbol overrides (forced strategy, custom threshold)."
```

---

## Task 2: DI+/DI- Calculation + Core Indicators

**Files:**
- Create: `strategies/trend_following.py`
- Create: `tests/test_trend_following.py`

- [ ] **Step 1: Write failing tests for calc_di_components**

```python
# tests/test_trend_following.py
import pytest
import pandas as pd
import numpy as np


def _make_ohlcv(n=100, base_price=100.0, trend=0.0):
    """Generate synthetic OHLCV data for testing."""
    np.random.seed(42)
    dates = pd.date_range("2024-01-01", periods=n, freq="1h")
    closes = [base_price]
    for i in range(1, n):
        closes.append(closes[-1] * (1 + trend + np.random.normal(0, 0.005)))
    closes = np.array(closes)
    highs = closes * (1 + np.abs(np.random.normal(0, 0.003, n)))
    lows = closes * (1 - np.abs(np.random.normal(0, 0.003, n)))
    opens = closes * (1 + np.random.normal(0, 0.001, n))
    volumes = np.random.uniform(100, 1000, n)
    return pd.DataFrame({
        "open": opens, "high": highs, "low": lows, "close": closes,
        "volume": volumes,
    }, index=dates)


class TestCalcDiComponents:
    def test_returns_two_series(self):
        from strategies.trend_following import calc_di_components
        df = _make_ohlcv(100)
        di_plus, di_minus = calc_di_components(df, period=14)
        assert isinstance(di_plus, pd.Series)
        assert isinstance(di_minus, pd.Series)
        assert len(di_plus) == len(df)
        assert len(di_minus) == len(df)

    def test_values_between_0_and_100(self):
        from strategies.trend_following import calc_di_components
        df = _make_ohlcv(100)
        di_plus, di_minus = calc_di_components(df, period=14)
        valid_plus = di_plus.dropna()
        valid_minus = di_minus.dropna()
        assert (valid_plus >= 0).all()
        assert (valid_plus <= 100).all()
        assert (valid_minus >= 0).all()
        assert (valid_minus <= 100).all()

    def test_uptrend_di_plus_greater(self):
        from strategies.trend_following import calc_di_components
        df = _make_ohlcv(200, trend=0.003)
        di_plus, di_minus = calc_di_components(df, period=14)
        assert di_plus.iloc[-1] > di_minus.iloc[-1]

    def test_downtrend_di_minus_greater(self):
        from strategies.trend_following import calc_di_components
        df = _make_ohlcv(200, trend=-0.003)
        di_plus, di_minus = calc_di_components(df, period=14)
        assert di_minus.iloc[-1] > di_plus.iloc[-1]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_trend_following.py::TestCalcDiComponents -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement calc_di_components and module skeleton**

Create `strategies/trend_following.py` with the full `calc_di_components()` function, default parameters, and `_get_tf_params()` helper. The `assess_signal()` function will be added in Task 3.

See spec Section 6.7 for the exact DI+/DI- calculation (same math as `btc_scanner.calc_adx()` lines 410-463 but returning intermediate DI series).

The implementation must include:
- Constants: `TF_EMA_FAST=9`, `TF_EMA_SLOW=21`, `TF_EMA_FILTER=50`, `TF_ATR_TRAIL=2.5`, `TF_RSI_ENTRY_LONG=55`, `TF_RSI_ENTRY_SHORT=45`
- `calc_di_components(df, period=14)` returning `(di_plus, di_minus)` as pd.Series
- `_get_tf_params(symbol, config)` returning dict of params with defaults

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_trend_following.py::TestCalcDiComponents -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add strategies/trend_following.py tests/test_trend_following.py
git commit -m "feat(strategies): add calc_di_components for trend direction (#132)"
```

---

## Task 3: Trend-Following Signal Assessment

**Files:**
- Modify: `strategies/trend_following.py` (add `assess_signal()`)
- Modify: `tests/test_trend_following.py` (add entry logic tests)

- [ ] **Step 1: Write failing tests for signal assessment**

Add to `tests/test_trend_following.py`:

```python
from btc_scanner import calc_rsi, calc_atr, calc_sma, calc_adx


def _make_trending_up(n=200):
    return _make_ohlcv(n, base_price=100.0, trend=0.003)

def _make_trending_down(n=200):
    return _make_ohlcv(n, base_price=100.0, trend=-0.003)

def _make_ranging(n=200):
    return _make_ohlcv(n, base_price=100.0, trend=0.0)


class TestAssessSignal:
    def _run(self, df1h, regime="LONG", config=None):
        from strategies.trend_following import assess_signal, calc_di_components
        df4h = df1h.resample("4h").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum"
        }).dropna()
        price = float(df1h["close"].iloc[-1])
        adx_s = calc_adx(df1h, 14)
        adx = float(adx_s.iloc[-1]) if not pd.isna(adx_s.iloc[-1]) else 0
        di_plus, di_minus = calc_di_components(df1h, 14)
        regime_data = {"regime": regime, "score": 70, "details": {}}
        return assess_signal(
            df1h=df1h, df4h=df4h, df5m=df1h,
            price=price, symbol="TESTUSDT",
            regime=regime, regime_data=regime_data,
            adx=adx,
            di_plus=float(di_plus.iloc[-1]),
            di_minus=float(di_minus.iloc[-1]),
            config=config or {},
        )

    def test_uptrend_direction_not_short(self):
        result = self._run(_make_trending_up(200), regime="LONG")
        assert result.get("direction") in ("LONG", None)

    def test_downtrend_direction_not_long(self):
        result = self._run(_make_trending_down(200), regime="SHORT")
        assert result.get("direction") in ("SHORT", None)

    def test_regime_blocks_short_in_bull(self):
        result = self._run(_make_trending_down(200), regime="LONG")
        assert result.get("direction") != "SHORT"

    def test_output_has_strategy_field(self):
        result = self._run(_make_trending_up(200))
        assert result["strategy"] == "trend_following"

    def test_output_has_required_fields(self):
        result = self._run(_make_trending_up(200))
        required = ["strategy", "estado", "direction", "price",
                     "score", "score_label", "adx_1h", "sizing_1h", "tf_indicators"]
        for field in required:
            assert field in result, f"Missing field: {field}"

    def test_output_has_tf_indicators(self):
        result = self._run(_make_trending_up(200))
        tf = result["tf_indicators"]
        for key in ["ema_fast", "ema_slow", "ema_filter", "di_plus", "di_minus"]:
            assert key in tf, f"Missing tf_indicator: {key}"

    def test_sizing_has_trailing_mode(self):
        result = self._run(_make_trending_up(200))
        assert result["sizing_1h"]["sl_mode"] == "trailing"
        assert result["sizing_1h"]["tp_precio"] is None

    def test_short_blocked_when_allow_short_false(self):
        config = {"symbol_overrides": {"TESTUSDT": {"allow_short": False}}}
        result = self._run(_make_trending_down(200), regime="SHORT", config=config)
        assert result.get("direction") != "SHORT"

    def test_custom_ema_params_used(self):
        config = {"symbol_overrides": {"TESTUSDT": {
            "tf_ema_fast": 12, "tf_ema_slow": 26, "tf_ema_filter": 55,
        }}}
        result = self._run(_make_trending_up(200), config=config)
        assert result["strategy"] == "trend_following"

    def test_score_max_is_9(self):
        result = self._run(_make_trending_up(200))
        assert result["score"] <= 9

    def test_score_label_is_valid(self):
        result = self._run(_make_trending_up(200))
        valid_labels = ["PREMIUM", "ESTANDAR", "MINIMA", "INSUFICIENTE"]
        assert any(label in result["score_label"] for label in valid_labels)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_trend_following.py::TestAssessSignal -v`
Expected: FAIL with `cannot import name 'assess_signal'`

- [ ] **Step 3: Implement assess_signal()**

Add to `strategies/trend_following.py` the full `assess_signal()` function implementing:
- EMA crossover detection (fast/slow/filter)
- Direction determination gated by regime and DI+/DI-
- T1-T7 scoring system (see spec Section 6.5)
- Optional 5M trigger (see spec Section 6.3)
- ATR-based trailing stop sizing (no fixed TP)
- Output dict matching `btc_scanner.scan()` schema plus `strategy` and `tf_indicators` fields

The function signature:
```python
def assess_signal(df1h, df4h, df5m, price, symbol, regime, regime_data,
                  adx, di_plus, di_minus, config) -> dict:
```

See spec Section 6.2 for entry logic, Section 6.4 for exit logic, Section 6.5 for scoring, Section 6.6 for output schema.

- [ ] **Step 4: Run all trend-following tests**

Run: `python -m pytest tests/test_trend_following.py -v`
Expected: All passed (TestCalcDiComponents + TestAssessSignal)

- [ ] **Step 5: Commit**

```bash
git add strategies/trend_following.py tests/test_trend_following.py
git commit -m "feat(strategies): implement trend-following signal assessment with EMA crossover + scoring (#132)"
```

---

## Task 4: Scanner Integration -- ADX Routing Early Return

**Files:**
- Modify: `btc_scanner.py:831-832` (insert after ADX calc)
- Modify: `btc_scanner.py:1025` (add strategy field)

- [ ] **Step 1: Run existing scanner tests to establish baseline**

Run: `python -m pytest tests/test_scanner.py -v`
Expected: All current tests pass. Record the count.

- [ ] **Step 2: Add ADX routing early return after line 831**

In `btc_scanner.py`, after line 831 (`cur_adx = round(...)`) and before line 833 (`sma100_4h = ...`), insert:

```python
    # -- ADX Strategy Routing --
    from strategies.router import route as _route_strategy
    _cfg_path_rt = os.path.join(SCRIPT_DIR, "config.json")
    _cfg_rt = {}
    if os.path.exists(_cfg_path_rt):
        try:
            with open(_cfg_path_rt) as _f_rt:
                _cfg_rt = json.load(_f_rt)
        except Exception:
            pass

    _strategy = _route_strategy(cur_adx, symbol, _cfg_rt)
    rep["strategy"] = _strategy

    if _strategy == "trend_following":
        from strategies.trend_following import assess_signal as _tf_assess, calc_di_components as _calc_di
        _di_plus, _di_minus = _calc_di(df1h, 14)
        _tf_result = _tf_assess(
            df1h=df1h, df4h=df4h, df5m=df5m,
            price=price, symbol=symbol,
            regime=regime, regime_data=regime_data,
            adx=cur_adx,
            di_plus=float(_di_plus.iloc[-1]),
            di_minus=float(_di_minus.iloc[-1]),
            config=_cfg_rt,
        )
        rep.update(_tf_result)
        clean_dict(rep)
        return rep
```

- [ ] **Step 3: Add strategy field to mean-reversion output at line 1025**

In `btc_scanner.py`, in the `rep.update({` block at line 1025, add as the first field:

```python
        "strategy":       "mean_reversion",
```

- [ ] **Step 4: Run existing scanner tests -- must all pass**

Run: `python -m pytest tests/test_scanner.py -v`
Expected: Same count as Step 1, all pass. Zero regressions.

- [ ] **Step 5: Run all tests**

Run: `python -m pytest tests/ -v`
Expected: All pass (scanner + API + router + trend-following)

- [ ] **Step 6: Commit**

```bash
git add btc_scanner.py
git commit -m "feat(scanner): add ADX strategy routing -- delegates to trend-following when ADX >= 25 (#133)

Surgical 15-line change: early return after ADX calculation routes to
strategies/trend_following.assess_signal() when ADX >= threshold.
Mean-reversion logic untouched. Adds 'strategy' field to all reports."
```

---

## Task 5: Trend-Following Backtest Simulation

**Files:**
- Create: `strategies/trend_following_sim.py`
- Create: `tests/test_backtest_dual.py`

- [ ] **Step 1: Write failing tests for bar-by-bar simulation**

```python
# tests/test_backtest_dual.py
import pytest
import pandas as pd
import numpy as np
from datetime import timedelta


def _make_ohlcv(n=200, base_price=100.0, trend=0.0):
    np.random.seed(42)
    dates = pd.date_range("2024-01-01", periods=n, freq="1h")
    closes = [base_price]
    for i in range(1, n):
        closes.append(closes[-1] * (1 + trend + np.random.normal(0, 0.005)))
    closes = np.array(closes)
    highs = closes * (1 + np.abs(np.random.normal(0, 0.003, n)))
    lows = closes * (1 - np.abs(np.random.normal(0, 0.003, n)))
    opens = closes * (1 + np.random.normal(0, 0.001, n))
    volumes = np.random.uniform(100, 1000, n)
    return pd.DataFrame({
        "open": opens, "high": highs, "low": lows, "close": closes,
        "volume": volumes,
    }, index=dates)


class TestCreateTfState:
    def test_initial_state(self):
        from strategies.trend_following_sim import create_tf_state
        state = create_tf_state()
        assert state["position"] is None
        assert state["highest_high"] is None
        assert state["lowest_low"] is None
        assert state["trailing_stop"] is None


class TestAssessTfBar:
    def test_returns_valid_action(self):
        from strategies.trend_following_sim import assess_tf_bar, create_tf_state
        df = _make_ohlcv(200, trend=0.003)
        state = create_tf_state()
        df4h = df.resample("4h").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum"
        }).dropna()
        result = assess_tf_bar(
            window_1h=df, df4h=df4h, df5m=df,
            bar_time=df.index[-1],
            price=float(df["close"].iloc[-1]),
            symbol="TESTUSDT", regime="LONG", cur_adx=30.0,
            config={}, tf_state=state,
        )
        assert result in ("enter", "exit", "hold", "skip")

    def test_enter_creates_position(self):
        from strategies.trend_following_sim import assess_tf_bar, create_tf_state
        df = _make_ohlcv(300, trend=0.005)
        state = create_tf_state()
        df4h = df.resample("4h").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum"
        }).dropna()
        config = {"symbol_overrides": {"TESTUSDT": {"use_5m_trigger": False}}}
        entered = False
        for i in range(110, len(df)):
            window = df.iloc[max(0, i - 209):i + 1]
            result = assess_tf_bar(
                window_1h=window, df4h=df4h, df5m=window,
                bar_time=df.index[i],
                price=float(df["close"].iloc[i]),
                symbol="TESTUSDT", regime="LONG", cur_adx=30.0,
                config=config, tf_state=state,
            )
            if result == "enter":
                entered = True
                break
        if entered:
            assert state["position"] is not None
            assert state["position"]["direction"] == "LONG"
            assert state["trailing_stop"] is not None

    def test_trailing_stop_never_decreases_for_long(self):
        from strategies.trend_following_sim import _update_trailing_stop
        state = {
            "position": {"direction": "LONG", "entry_price": 100.0},
            "trailing_stop": 95.0,
            "highest_high": 100.0,
            "lowest_low": 100.0,
        }
        # Price goes up
        new_stop = _update_trailing_stop(state, high=110.0, low=108.0, atr_val=2.0, atr_trail=2.5)
        assert new_stop >= 95.0
        old_stop = new_stop
        # Price pulls back (but stop should not decrease)
        new_stop2 = _update_trailing_stop(state, high=107.0, low=105.0, atr_val=2.0, atr_trail=2.5)
        assert new_stop2 >= old_stop
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_backtest_dual.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement trend_following_sim.py**

Create `strategies/trend_following_sim.py` with:
- `create_tf_state()` returning initial state dict
- `_update_trailing_stop(state, high, low, atr_val, atr_trail)` -- only moves stop in favor of position
- `assess_tf_bar(window_1h, df4h, df5m, bar_time, price, symbol, regime, cur_adx, config, tf_state)` returning "enter"|"exit"|"hold"|"skip"

The function handles:
- If position open: update trailing stop, check EMA reversal exit, check trailing stop hit
- If no position: cooldown check, indicator calculation, direction assessment, macro 4H filter, optional 5M trigger, T1-T7 scoring, open position

See spec Sections 6.2-6.5 for logic, Section 8.1 for state structure.

Trade dict on exit must include: `entry_time, exit_time, entry_price, exit_price, exit_reason ("TRAILING_STOP"|"EMA_REVERSAL"), direction, pnl_pct, pnl_usd, score, size_mult, duration_hours, strategy, adx_at_entry, trailing_stop_final`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_backtest_dual.py -v`
Expected: All passed

- [ ] **Step 5: Commit**

```bash
git add strategies/trend_following_sim.py tests/test_backtest_dual.py
git commit -m "feat(strategies): add trend-following backtest simulation (#134)

Bar-by-bar simulator with trailing stop, EMA reversal exit,
and state management for backtest integration."
```

---

## Task 6: Backtest Integration -- ADX Routing in simulate_strategy()

**Files:**
- Modify: `backtest.py`

- [ ] **Step 1: Run existing backtest to capture mean-reversion baseline**

Run: `python backtest.py --symbol BTCUSDT --start 2023-01-01 --end 2024-01-01 2>&1 | tail -20`

Record: total trades, net P&L, win rate. These are the regression baselines.

- [ ] **Step 2: Modify simulate_strategy() signature and init**

In `backtest.py` at line 240, add `backtest_config: dict = None` parameter:

```python
def simulate_strategy(df1h, df4h, df5m, symbol, sl_mode="atr",
                      atr_sl_mult=None, atr_tp_mult=None, atr_be_mult=None,
                      df1d=None, sim_start=None, sim_end=None,
                      df_fng=None, df_funding=None,
                      backtest_config: dict = None) -> tuple[list[dict], list[dict]]:
```

After line 258 (`_be_m = ...`), add:

```python
    from strategies.trend_following_sim import create_tf_state, assess_tf_bar
    from strategies.router import route as route_strategy
    tf_state = create_tf_state()
    _bt_cfg = backtest_config or {}
```

- [ ] **Step 3: Add ADX routing inside the bar loop**

In `backtest.py`, after `price = float(close_1h.iloc[-1])` (line 360) and before the LRC calculation (line 363), insert the regime calculation block (moved up from lines 369-412) followed by ADX routing.

The routing block: calculate ADX on the window, call `route_strategy()`, and if trend-following, call `assess_tf_bar()`, handle "enter"/"exit"/"hold" results, append equity curve, and `continue` to skip mean-reversion logic.

- [ ] **Step 4: Add strategy field to mean-reversion position dict**

At line 519 in the position dict, add `"strategy": "mean_reversion"`.

- [ ] **Step 5: Update end-of-sim position close to be direction-aware**

At line 531, update the close block to use `position.get("direction", "LONG")` for PnL calc and include `"strategy"` in the trade dict.

- [ ] **Step 6: Add per-strategy breakdown to generate_report()**

After the score tiers section (~line 804), add a "Per-Strategy Breakdown" section that groups trades by `strategy` field and shows trades, win rate, P&L, avg trade per strategy. See spec Section 8.2 for the table format.

- [ ] **Step 7: Run regression test**

Run: `python backtest.py --symbol BTCUSDT --start 2023-01-01 --end 2024-01-01 2>&1 | tail -20`

Compare with Step 1 baseline. Trade count, net P&L, and win rate must match.

- [ ] **Step 8: Commit**

```bash
git add backtest.py
git commit -m "feat(backtest): integrate ADX routing for dual strategy simulation (#134)

Backtest now routes each bar to mean-reversion or trend-following
based on ADX value. Adds per-strategy breakdown to reports.
Mean-reversion results unchanged (regression verified)."
```

---

## Task 7: Integration Tests -- Dual Strategy Backtest

**Files:**
- Modify: `tests/test_backtest_dual.py`

- [ ] **Step 1: Add integration tests**

Add to `tests/test_backtest_dual.py`:

```python
class TestDualStrategyBacktest:
    def test_trades_tagged_by_strategy(self):
        df = _make_ohlcv(500, trend=0.001)
        df4h = df.resample("4h").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum"
        }).dropna()
        from backtest import simulate_strategy
        from datetime import datetime, timezone
        trades, eq = simulate_strategy(
            df1h=df, df4h=df4h, df5m=df,
            symbol="TESTUSDT",
            sim_start=datetime(2024, 1, 5, tzinfo=timezone.utc),
            sim_end=datetime(2024, 1, 20, tzinfo=timezone.utc),
            backtest_config={"symbol_overrides": {"TESTUSDT": {"use_5m_trigger": False}}},
        )
        for trade in trades:
            assert "strategy" in trade
            assert trade["strategy"] in ("mean_reversion", "trend_following")

    def test_no_orphan_positions(self):
        df = _make_ohlcv(500, trend=0.001)
        df4h = df.resample("4h").agg({
            "open": "first", "high": "max", "low": "min",
            "close": "last", "volume": "sum"
        }).dropna()
        from backtest import simulate_strategy
        from datetime import datetime, timezone
        trades, eq = simulate_strategy(
            df1h=df, df4h=df4h, df5m=df,
            symbol="TESTUSDT",
            sim_start=datetime(2024, 1, 5, tzinfo=timezone.utc),
            sim_end=datetime(2024, 1, 20, tzinfo=timezone.utc),
            backtest_config={},
        )
        for trade in trades:
            assert trade["exit_price"] is not None
            assert trade["exit_reason"] is not None
```

- [ ] **Step 2: Run all tests**

Run: `python -m pytest tests/ -v`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add tests/test_backtest_dual.py
git commit -m "test(backtest): add dual strategy integration tests (#134)"
```

---

## Task 8: API Trailing Stop Update Helper

**Files:**
- Modify: `btc_api.py`

- [ ] **Step 1: Add update_position_trailing_sl helper**

In `btc_api.py`, after the `check_position_stops()` function (~line 622), add:

```python
def update_position_trailing_sl(symbol: str, new_sl: float):
    """Update trailing stop for open trend-following positions.
    Only moves SL in favorable direction (up for LONG)."""
    con = get_db()
    con.execute(
        "UPDATE positions SET sl_price = ? WHERE symbol = ? AND status = 'open' AND sl_price < ?",
        (round(new_sl, 2), symbol.upper(), round(new_sl, 2))
    )
    con.commit()
    con.close()
```

- [ ] **Step 2: Wire it into the scan loop**

In `btc_api.py`, find where `check_position_stops()` is called in the scanner loop. After that call, add:

```python
            if rep.get("strategy") == "trend_following" and rep.get("tf_indicators", {}).get("trailing_stop"):
                trailing_sl = rep["tf_indicators"]["trailing_stop"]
                if trailing_sl and trailing_sl > 0:
                    update_position_trailing_sl(symbol, trailing_sl)
```

- [ ] **Step 3: Run API tests**

Run: `python -m pytest tests/test_api.py -v`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add btc_api.py
git commit -m "feat(api): add trailing stop update for trend-following positions (#132)"
```

---

## Task 9: Validation -- Run Dual Strategy Backtest on All 20 Symbols

**Files:** No code changes. Validation run.

- [ ] **Step 1: Backtest 13 paused symbols with dual strategy**

Run for each: SOLUSDT, BNBUSDT, DOTUSDT, LINKUSDT, NEARUSDT, APTUSDT, OPUSDT, ARBUSDT, ATOMUSDT, XRPUSDT, MATICUSDT, LTCUSDT, FILUSDT

```bash
python backtest.py --symbol SOLUSDT --start 2022-01-01 --end 2026-01-01
```

- [ ] **Step 2: Backtest 7 current symbols to verify no regression**

```bash
for sym in BTCUSDT DOGEUSDT ADAUSDT XLMUSDT AVAXUSDT UNIUSDT ETHUSDT; do
  python backtest.py --symbol $sym --start 2022-01-01 --end 2026-01-01
done
```

- [ ] **Step 3: Analyze results**

Create summary: Symbol | MR Trades | MR P&L | TF Trades | TF P&L | Total | Include?

- [ ] **Step 4: Gate G4 check**

Verify at least 3 of 13 paused symbols are profitable. If yes, continue. If no, document and stop.

---

## Task 10: Production Config + Final

**Files:**
- Modify: `config.json`

- [ ] **Step 1: Update symbol_overrides with validated config**

Based on Task 9 results, set `strategy: "auto"` for profitable symbols.

- [ ] **Step 2: Smoke test**

```bash
python -c "from btc_scanner import scan; import json; print(json.dumps(scan('SOLUSDT'), indent=2, default=str))"
```

Verify `"strategy"` field present in output.

- [ ] **Step 3: Run complete test suite**

Run: `python -m pytest tests/ -v`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add config.json
git commit -m "feat: activate dual strategy with optimized per-symbol config (#131)"
```
