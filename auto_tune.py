#!/usr/bin/env python3
"""
Auto-Tune — Walk-forward parameter optimization for the trading portfolio.

Usage:
    python auto_tune.py                        # full optimization
    python auto_tune.py --symbol DOGEUSDT      # single symbol
    python auto_tune.py --apply                # apply config_proposed.json
    python auto_tune.py --dry-run              # show what would change
"""

import os
import sys
import json
import time
import shutil
import argparse
import logging
import itertools
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta

import pandas as pd
import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger("auto_tune")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

GRID = {
    "atr_sl_mult": [0.5, 0.7, 1.0, 1.2, 1.5, 2.0, 2.5],
    "atr_tp_mult": [2.0, 3.0, 4.0, 5.0, 6.0],
    "atr_be_mult": [1.5, 2.0, 2.5],
}

MIN_IMPROVEMENT_PCT = 15.0
MIN_TRADES = 50
MIN_PF_VALIDATE = 1.1
TOP_N_TO_VALIDATE = 5


def calculate_periods(today=None):
    """Return (train_start, train_end, val_start, val_end) as UTC datetimes.

    Train window : today - 15 months  →  today - 3 months  (~12 months)
    Validate window: today - 3 months  →  today             (~3 months)
    """
    if today is None:
        today = datetime.now(tz=timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

    train_start = today - relativedelta(months=15)
    train_end = today - relativedelta(months=3)
    val_start = train_end
    val_end = today

    return train_start, train_end, val_start, val_end


def generate_combos() -> list:
    """Return all parameter combinations from GRID as a list of dicts.

    Total = 7 x 5 x 3 = 105 combinations.
    """
    keys = list(GRID.keys())
    values = [GRID[k] for k in keys]
    combos = [dict(zip(keys, combo)) for combo in itertools.product(*values)]
    return combos


def should_recommend(current_pnl: float, proposed_pnl: float, total_trades: int, pf_validate: float) -> bool:
    """Return True only when ALL acceptance criteria are met.

    Criteria:
      1. pf_validate >= MIN_PF_VALIDATE (1.1)
      2. total_trades >= MIN_TRADES (50)
      3. If current_pnl <= 0: proposed_pnl must be > 0
         If current_pnl > 0:  improvement must be >= MIN_IMPROVEMENT_PCT (15%)
    """
    if pf_validate < MIN_PF_VALIDATE:
        return False

    if total_trades < MIN_TRADES:
        return False

    if current_pnl <= 0:
        return proposed_pnl > 0

    improvement_pct = (proposed_pnl - current_pnl) / current_pnl * 100.0
    return improvement_pct >= MIN_IMPROVEMENT_PCT


def main():
    parser = argparse.ArgumentParser(description="Walk-forward parameter optimizer")
    parser.add_argument("--symbol", default=None, help="Optimize a single symbol (e.g. DOGEUSDT)")
    parser.add_argument("--apply", action="store_true", help="Apply config_proposed.json to config.json")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing")
    args = parser.parse_args()

    if args.apply:
        proposed_path = os.path.join(SCRIPT_DIR, "config_proposed.json")
        config_path = os.path.join(SCRIPT_DIR, "config.json")
        if not os.path.exists(proposed_path):
            log.error("config_proposed.json not found — run optimization first")
            sys.exit(1)
        if args.dry_run:
            with open(proposed_path) as f:
                log.info("Would apply:\n%s", json.dumps(json.load(f), indent=2))
        else:
            shutil.copy(config_path, config_path + ".bak")
            shutil.copy(proposed_path, config_path)
            log.info("Applied config_proposed.json → config.json (backup saved as config.json.bak)")
        return

    train_start, train_end, val_start, val_end = calculate_periods()
    log.info("Train  : %s → %s", train_start.date(), train_end.date())
    log.info("Validate: %s → %s", val_start.date(), val_end.date())

    combos = generate_combos()
    log.info("Grid combos: %d", len(combos))
    log.info("(Full optimization logic will be implemented in subsequent tasks)")


if __name__ == "__main__":
    main()
