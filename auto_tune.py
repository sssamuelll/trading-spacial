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


def main():
    parser = argparse.ArgumentParser(description="Walk-forward parameter optimizer")
    parser.add_argument("--symbol", default=None, help="Optimize a single symbol (e.g. DOGEUSDT)")
    parser.add_argument("--apply", action="store_true", help="Apply config_proposed.json to config.json")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without writing")
    args = parser.parse_args()

    train_start, train_end, val_start, val_end = calculate_periods()
    log.info("Train  : %s → %s", train_start.date(), train_end.date())
    log.info("Validate: %s → %s", val_start.date(), val_end.date())


if __name__ == "__main__":
    main()
