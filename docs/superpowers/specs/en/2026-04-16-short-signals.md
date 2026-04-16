# SHORT Signals — Bidirectional Trading

**Date:** 2026-04-16
**Issue:** #58
**Status:** Approved

## Problem

Strategy is LONG-only. Backtest showed only 4 trades in bear markets — capital sits idle. Adding SHORT doubles trading opportunities. User trades both spot and futures.

## Solution

SHORT signal is the exact mirror of LONG. Single `scan()` evaluates both directions.

### Entry Conditions

| Condition | LONG | SHORT |
|-----------|------|-------|
| LRC zone 1H | LRC% <= 25 | LRC% >= 75 |
| Macro 4H | Price > SMA100 | Price < SMA100 |
| 5M Trigger | Bullish candle + RSI recovering | Bearish candle + RSI falling |
| E1 Exclusion | Bull engulfing | Bear engulfing |
| E6 Exclusion | Bearish RSI divergence | Bullish RSI divergence |

LRC between 25-75% = no signal in either direction.

### Score SHORT (C1-C7 inverted)

C1: RSI > 60 (2pts), C2: Bearish divergence (2pts), C3: Near resistance ≤1.5% (1pt), C4: Above BB upper (1pt), C5: Volume above avg (1pt), C6: CVD negative (1pt), C7: SMA10 < SMA20 (1pt).

### Risk Management

SL = entry + 1.0x ATR, TP = entry - 4.0x ATR. Breakeven when price drops >= 1.5x ATR.

## Changes

### Scanner (`btc_scanner.py`)
- New: `LRC_SHORT_MIN = 75.0`, `detect_bear_engulfing()`, `check_trigger_5m_short()`
- Modified: `scan()` evaluates both directions, report includes `"direction"`

### API (`btc_api.py`)
- Telegram message: dynamic direction header
- Already supports SHORT in positions, trailing, P&L

### Frontend
- SymbolCard: green LONG / red SHORT badge
- SignalsTable: "Dir" column with L/S pill
- ChartModal: direction chip
- types.ts: direction field on SymbolStatus/Signal

### Backtest (`backtest.py`)
- Evaluate both directions per bar
- SHORT: inverted SL/TP/trailing
- Breakdown LONG vs SHORT in report

### Tests
- Short signal generation, midzone no-signal, inverted SL/TP, bearish trigger, bear engulfing
