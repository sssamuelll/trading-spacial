# Auto-Tune System — Design Spec

**Date:** 2026-04-18
**Issue:** #137
**Author:** Samuel Ballesteros + Claude Opus

---

## 1. Problem

Parameter optimization is manual. The operator runs `optimize_new_tokens.py`, waits ~30 min, reads results, and manually updates `config.json`. This should be automated with safety guardrails.

## 2. Solution

Standalone script `auto_tune.py` that runs walk-forward optimization on all portfolio symbols, generates a report with recommendations, sends a Telegram summary, and optionally applies changes with interactive confirmation.

## 3. Architecture Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Execution | Hybrid — cron generates report, human applies | Prevents silent overfitting |
| Period | Walk-forward: 12 months train + 3 months validate | Industry standard for robustness |
| Output | Report + config_proposed.json + Telegram + --apply | Minimum friction to apply, maximum safety |
| Threshold | >15% improvement + 50 trades min + PF > 1.1 in validate | Conservative enough to avoid noise |
| Architecture | Standalone script, not in API | Batch process, not a service |

## 4. CLI Interface

```bash
python auto_tune.py                        # full optimization, all symbols
python auto_tune.py --symbol DOGEUSDT      # single symbol
python auto_tune.py --apply                # apply config_proposed.json
python auto_tune.py --dry-run              # show what would change, no output files
python auto_tune.py --help                 # usage
```

## 5. Walk-Forward Optimization

### Period Calculation

Computed dynamically from the current date:

```
today = 2026-04-18

train_start = today - 15 months  = 2025-01-18
train_end   = today - 3 months   = 2026-01-18
validate_start = train_end       = 2026-01-18
validate_end   = today           = 2026-04-18
```

### Parameter Grid

Same grid as existing optimization (105 combinations):

```
atr_sl_mult: [0.5, 0.7, 1.0, 1.2, 1.5, 2.0, 2.5]   (7 values)
atr_tp_mult: [2.0, 3.0, 4.0, 5.0, 6.0]               (5 values)
atr_be_mult: [1.5, 2.0, 2.5]                           (3 values)
```

### Process Per Symbol

1. Read current params from `config.json` symbol_overrides
2. Run 105 combos on TRAIN period
3. Take top 5 by P&L
4. Run each on VALIDATE period (no re-optimization)
5. Also run current params on VALIDATE period (baseline)
6. Apply acceptance criteria:
   - Improvement > 15% vs current params in VALIDATE
   - Total trades (train + validate) >= 50
   - Profit Factor > 1.1 in VALIDATE
7. If any combo passes all 3: recommend the best one
8. If none pass: "current params remain optimal"

## 6. Outputs

### Output 1: Report Markdown

File: `data/backtest/tune_report_YYYYMMDD.md`

Contains:
- Summary (symbols analyzed, changes recommended, execution time)
- Per-symbol detail for recommended changes (current vs proposed, P&L train/validate, PF)
- Table of symbols without changes (and why: below threshold, actual is better, etc.)

### Output 2: Config Proposed

File: `config_proposed.json`

Only generated when there are recommended changes. Contains the full `config.json` with updated symbol_overrides for recommended symbols. Ready to copy.

### Output 3: Telegram Notification

Summary message with:
- Number of changes recommended
- Per-symbol: old params -> new params, improvement percentage
- Command to apply: `python auto_tune.py --apply`

### Output 4: Apply Command

`python auto_tune.py --apply`:
1. Reads `config_proposed.json`
2. Shows diff (old vs new params per symbol)
3. Asks for confirmation: "Apply changes? [y/N]"
4. If confirmed: backs up current config to `config_backup_YYYYMMDD.json`, writes new config
5. Sends Telegram confirmation: "Config updated. X symbols changed."

## 7. Data Flow

```
auto_tune.py
  |
  +-- Reads: config.json (current params)
  +-- Reads: data/backtest/*.csv (cached OHLCV, reuses existing cache)
  +-- Calls: backtest.simulate_strategy() (reuses existing backtest engine)
  +-- Calls: backtest.calculate_metrics() (reuses existing metrics)
  |
  +-- Writes: data/backtest/tune_report_YYYYMMDD.md
  +-- Writes: config_proposed.json (if changes found)
  +-- Sends: Telegram notification
  |
  +-- (--apply): Reads config_proposed.json
  +--            Writes: config_backup_YYYYMMDD.json
  +--            Writes: config.json
```

## 8. Cron Setup

Not configured by the script. Operator sets up manually:

```bash
# Monthly on the 1st at 3:00 AM
crontab -e
0 3 1 * * cd /path/to/trading-spacial && python auto_tune.py >> data/backtest/auto_tune.log 2>&1
```

Documented in `--help` output.

## 9. Testing

File: `tests/test_auto_tune.py`

| Test | Validates |
|------|-----------|
| `test_walk_forward_periods` | Train/validate periods calculated correctly from current date |
| `test_grid_combos_count` | 105 combinations generated (7 x 5 x 3) |
| `test_improvement_threshold_rejects_below` | Combo with +14% improvement rejected |
| `test_improvement_threshold_accepts_above` | Combo with +16% improvement accepted |
| `test_min_trades_filter` | Combo with 30 trades rejected, 55 accepted |
| `test_pf_filter` | PF 1.05 in validate rejected, PF 1.15 accepted |
| `test_no_changes_keeps_current` | All combos worse -> report says "no changes" |
| `test_config_proposed_only_when_changes` | No changes -> no config_proposed.json generated |
| `test_apply_creates_backup` | --apply saves backup before overwriting |

## 10. Files

```
NEW:
  auto_tune.py                    # main script (~300 lines)
  tests/test_auto_tune.py         # tests (~200 lines)

MODIFIED:
  (none — standalone script, no changes to existing code)
```

## 11. What This Spec Does NOT Cover

- Kill switch / auto-demotion (#138) — separate feature
- Paper trading pipeline (#139) — separate feature
- Dashboard integration — not needed for monthly batch process
- Multi-strategy optimization — only optimizes MR params (SL/TP/BE)
