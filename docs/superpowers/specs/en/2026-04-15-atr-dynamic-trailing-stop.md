# Dynamic ATR SL/TP + Trailing Ratchet Stop

**Date:** 2026-04-15
**Issue:** #113 (dynamic SL/TP) + #114 (trailing stop)
**Status:** Approved

## Problem

Backtest showed the strategy **loses money in bull markets** (-$389) because the fixed 2% SL triggers prematurely during high volatility. The fixed 4% TP also caps gains during trend continuation.

## Solution

Replace fixed SL/TP with ATR(14)-based dynamic levels + trailing ratchet, following the proven pattern from Freqtrade and Jesse communities.

### Parameters (community consensus)

| Parameter | Value | Description |
|-----------|-------|-------------|
| `ATR_PERIOD` | 14 | ATR lookback (standard) |
| `ATR_SL_MULT` | 1.5 | SL = entry - 1.5x ATR |
| `ATR_TP_MULT` | 3.0 | TP = entry + 3.0x ATR |
| `ATR_BE_MULT` | 1.5 | Move SL to breakeven when profit >= 1.5x ATR |
| Timeframe | 1H | ATR from signal timeframe (not 5M — too noisy) |

R:R ratio maintained at 2:1 but now adapts to real volatility.

## Changes by Component

### 1. Scanner (`btc_scanner.py`)
- New `calc_atr()` function
- New constants: `ATR_PERIOD`, `ATR_SL_MULT`, `ATR_TP_MULT`, `ATR_BE_MULT`
- `scan()` sizing block uses ATR instead of fixed percentage
- Report includes `atr_1h`, `sl_mode`, multipliers
- Config `"sl_mode": "fixed"` for backward compatibility

### 2. API (`btc_api.py`)
- `positions` table: new `atr_entry REAL` column
- `check_position_stops()`: trailing ratchet logic (SL to breakeven at +1.5x ATR, only tightens)
- Config: `atr_sl_mult`, `atr_tp_mult`, `atr_be_mult`, `sl_mode`

### 3. Frontend
- `types.ts`: add `atr_entry` to Position type
- `PositionsPanel.tsx`: "BE" badge when SL >= entry (breakeven active)
- `SignalsTable.tsx` / `SymbolCard.tsx`: show dynamic SL/TP % with "(ATR)" indicator
- `ChartModal.tsx`: ATR/SL/TP chips alongside score

### 4. Backtest (`backtest.py`)
- Dual mode: `--sl-mode atr` (default) vs `--sl-mode fixed`
- ATR calculation per bar, trailing ratchet, comparative report

### 5. Tests
- `calc_atr()` correctness
- ATR-based SL/TP calculation
- Trailing ratchet: SL moves to breakeven, never widens
- `sl_mode: fixed` fallback works
- Config multiplier loading

## Benchmark Source

Pattern based on Freqtrade `custom_stoploss` + `stoploss_from_absolute`, Jesse `update_position()`, and NostalgiaForInfinity (NFIX). Community consensus: ATR(14), 1.5x SL, 3x TP, lock at entry, ratchet only.
