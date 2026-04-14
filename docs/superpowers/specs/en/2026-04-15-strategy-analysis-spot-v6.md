# Spot V6 Strategy — Full Analysis & Benchmark

**Date:** 2026-04-15
**Symbol:** BTCUSDT
**Backtest Period:** January 2023 — Present (~2.3 years)
**Simulated Capital:** $10,000 USD

---

## 1. Executive Summary

A complete historical backtest and benchmark comparison against top open-source crypto strategies. The strategy is **profitable but conservative**, with excellent risk control and clear improvement opportunities.

### Key Results

| Metric | Value | Verdict |
|--------|-------|---------|
| Total Trades | 181 | ~4.6 trades/month (selective) |
| Win Rate | **38.7%** | Below benchmarks, but 2:1 R:R compensates |
| Profit Factor | **1.23** | For every $1 lost, earns $1.23 |
| Total Return | **+33.0%** | $10,000 → $13,305 |
| Max Drawdown | **-9.8%** | Excellent — better than all benchmarks |
| Sharpe Ratio | **0.82** | Acceptable, improvable |
| Max Consecutive Losses | 9 | Requires psychological discipline |

---

## 2. Strategy Overview

Multi-timeframe mean-reversion system:

- **4H (Macro):** SMA100 trend filter — only trade when price is above
- **1H (Signal):** LRC channel ≤ 25% — price in bottom quartile of regression channel
- **5M (Trigger):** Bullish candle + RSI recovering — reversal confirmation

### Scoring (0-9 points from 7 confirmations)

C1: RSI < 40 (2pts), C2: Bullish RSI divergence (2pts), C3: Near support ≤1.5% (1pt), C4: Below BB lower (1pt), C5: Volume above avg (1pt), C6: CVD delta positive (1pt), C7: SMA10 > SMA20 (1pt).

### Risk Management

SL: -2% fixed | TP: +4% fixed (2:1 R:R) | Risk per trade: 1% of capital | Cooldown: 6h

---

## 3. Benchmark Comparison

| Metric | Our V6 | Freqtrade Top 10% | Jesse | Verdict |
|--------|--------|-------------------|-------|---------|
| Win Rate | 38.7% | 55-65% | 45-55% | Below |
| Profit Factor | 1.23 | 1.5-2.5 | 1.3-2.0 | Below |
| Sharpe Ratio | 0.82 | 1.0-2.0 | 0.8-1.5 | Low range |
| Max Drawdown | **-9.8%** | -10% to -25% | -15% to -30% | **Best** |
| Trades/Month | 4.6 | 15-40 | 10-30 | Much lower |

Note: Published backtests from these projects are notoriously optimistic. Live results are typically 30-50% worse.

---

## 4. Strengths

1. **Multi-timeframe architecture (4H/1H/5M)** — most strategies use single timeframe
2. **Scoring system validated by data** — premium tier (4+) generates 4.4x more P&L than minimal
3. **LRC channel** — almost no open-source strategy uses this; better than BB for dynamic support
4. **Max drawdown -9.8%** — better than ALL benchmarked strategies
5. **Exclusion filters** (bull engulfing, bearish divergence) — more sophisticated than community strategies
6. **CVD delta** — order flow insight that price-only strategies lack

---

## 5. Weaknesses

1. **Long-only** — zero revenue in bear markets (correctly avoids bad entries but misses shorts)
2. **Fixed SL/TP loses in bull markets** — the most surprising finding: strategy LOSES money in bulls (-$389) because fixed 2% SL triggers prematurely in high volatility
3. **Low trade frequency** — 4.6/month, capital idle most of the time
4. **No trailing stop** — winners capped at +4% even in strong trends
5. **Static thresholds** — RSI < 40, LRC <= 25% don't adapt to volatility regimes

### Market Regime Analysis

| Regime | Trades | Win Rate | Total P&L |
|--------|--------|----------|-----------|
| Bull | 66 | 31.8% | **-$389** |
| Bear | 4 | 50.0% | +$305 |
| Sideways | 111 | 42.3% | **+$3,388** |

---

## 6. Recommendations (Prioritized)

### High Impact
1. **ATR-based dynamic SL/TP** — replace fixed 2%/4% with 1.5x/3x ATR(14)
2. **Trailing stop** — breakeven at +2%, trail at 1.5x ATR after +3%
3. **Add SHORT signals** — LRC >= 75%, price below SMA100 4H

### Medium Impact
4. **ADX trend strength filter** — only mean-revert when ADX < 25
5. **EMA 200 daily** as secondary trend confirmation
6. **Multi-symbol portfolio** — run across top 5-10 symbols

### Low Impact
7. VWAP integration for entry refinement
8. Fee-adjusted sizing (0.1% per trade)
9. Walk-forward parameter optimization

---

## 7. Conclusion

The Spot V6 strategy has a **solid core** — its multi-timeframe architecture, scoring system, and risk control are superior to most open-source strategies. The main bottleneck is **parameter rigidity** (fixed SL/TP) and the **long-only limitation**.

Top 3 improvements could potentially raise win rate to ~50-55%, profit factor to ~1.5-2.0, and double trade frequency — while maintaining the excellent <15% max drawdown.

**Verdict: Good foundation, good risk, needs adaptability.**

---

## Appendix: Methodology

- Bar-by-bar simulation on 1H candles with aligned 4H and 5M data
- 28,798 1H + 7,200 4H + 345,564 5M candles from Binance
- Same indicator functions as production scanner (`btc_scanner.py`)
- Script: `backtest.py` | Technical report: `docs/strategy-backtest-report.md`
