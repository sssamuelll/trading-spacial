# Strategy Backtest & Benchmark Analysis

**Date:** 2026-04-15
**Status:** Approved

## Objective

Backtest the current trading strategy (Spot V6) against historical data (Jan 2023 — present), benchmark against top open-source strategies, and produce a comprehensive report with win rate, risk metrics, strengths, weaknesses, and improvement recommendations.

## Backtest Architecture

### Script: `backtest.py`

Self-contained script that reuses existing scanner functions. No new dependencies beyond what the project already uses (pandas, numpy, requests).

```
backtest.py
  ├── download_historical_data()  → Binance API, cache to CSV
  ├── simulate_strategy()         → bar-by-bar simulation using scanner functions
  ├── calculate_metrics()         → win rate, profit factor, Sharpe, drawdown
  └── generate_report()           → markdown output
```

### Data Requirements

- **1H candles:** Jan 1 2023 — present (~20,000 candles for BTCUSDT)
- **4H candles:** Jan 1 2023 — present (~5,000 candles)
- **5M candles:** Jan 1 2023 — present (~250,000 candles)
- Source: Binance API via existing `get_klines()` (with pagination for large requests)
- Cache: CSV files in `data/backtest/` to avoid re-downloading

### Simulation Logic

1. Iterate over each 1H candle from Jan 2023 to present
2. At each bar, compute indicators using the same functions from `btc_scanner.py`:
   - `calc_lrc()` on last 100 1H closes
   - `calc_rsi()` on 1H closes
   - `calc_bb()` on 1H closes
   - `calc_sma()` for SMA10, SMA20 on 1H
   - `calc_sma()` for SMA100 on aligned 4H data
   - `detect_rsi_divergence()` on 1H
   - `detect_bull_engulfing()` on 1H
   - `calc_cvd_delta()` on 1H
   - `check_trigger_5m()` on aligned 5M data
3. Entry: signal_activa == True (LRC <= 25%, macro OK, trigger 5M, no exclusions)
4. Exit: first of SL (-2%) or TP (+4%) hit, checked against high/low of subsequent candles
5. Constraints: one position at a time, 6h cooldown between trades
6. Sizing: score 0-1 = 50%, 2-3 = 100%, >= 4 = 150% of base risk (1% of capital)

### Metrics

| Category | Metrics |
|----------|---------|
| Core | Win rate, loss rate, total trades, profit factor |
| Returns | Total return %, CAGR, avg return per trade |
| Risk | Max drawdown %, Sharpe ratio (annualized), Sortino ratio |
| Duration | Avg trade duration, avg win duration, avg loss duration |
| Streaks | Max consecutive wins, max consecutive losses |
| Distribution | Best trade, worst trade, median trade |
| By score | Win rate and avg return for each score tier (0-1, 2-3, 4+) |
| By regime | Performance in bull / bear / sideways markets |

### Market Regime Classification

- **Bull:** BTC price above SMA100 daily AND 30-day return > +10%
- **Bear:** BTC price below SMA100 daily AND 30-day return < -10%
- **Sideways:** everything else

### Benchmark Comparison

Compare results against published metrics from:
- Freqtrade community top 10% strategies
- Jesse published strategies
- OctoBot evaluator-combiner model

Metrics compared: win rate, profit factor, Sharpe ratio, max drawdown, trades/month.

## Report Structure: `docs/strategy-backtest-report.md`

1. **Executive Summary** — key metrics in one table, overall verdict
2. **Methodology** — data source, period, simulation rules, assumptions
3. **Results** — detailed metrics tables, equity curve description
4. **Score Tier Analysis** — does higher score = better results?
5. **Market Regime Analysis** — bull vs bear vs sideways breakdown
6. **Benchmark Comparison** — vs Freqtrade/Jesse/OctoBot
7. **Strengths** — what the strategy does well, backed by data
8. **Weaknesses** — where it loses money, backed by data
9. **Recommendations** — prioritized improvements with expected impact

## What the Backtest Does NOT Do

- No parameter optimization (avoids overfitting without walk-forward)
- No slippage simulation (spot market, 5-min scan interval = negligible)
- No fee simulation in P&L (noted as 0.1% per trade for reference)
- No short signals (strategy is long-only by design)

## Files Created

- `backtest.py` — backtest script (root directory)
- `data/backtest/*.csv` — cached historical data (gitignored)
- `docs/strategy-backtest-report.md` — final report
