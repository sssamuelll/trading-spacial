"""Grid search over (SL, TP, BE) per (symbol, direction) on a train window.

Produces data/tune/tune_results.json + data/tune/tune_grid_full.csv.

Spec: docs/superpowers/specs/es/2026-04-20-per-direction-atr-params-design.md §7
"""
import argparse
import csv
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backtest import get_cached_data, simulate_strategy  # noqa: E402


FULL_GRID = {
    "sl": [0.5, 0.7, 1.0, 1.2, 1.5, 2.0, 2.5],
    "tp": [2.0, 3.0, 4.0, 5.0, 6.0],
    "be": [1.5, 2.0, 2.5],
}
TEST_GRID = {
    "sl": [0.5, 1.0],
    "tp": [2.0, 4.0],
    "be": [1.5],
}


def _git_sha() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(ROOT)).decode().strip()
    except Exception:
        return "unknown"


def _run_combo(df1h, df4h, df5m, df1d, symbol, sim_start, sim_end, sl, tp, be, direction):
    """Run one (sl, tp, be) combo and return per-direction stats."""
    trades, _equity = simulate_strategy(
        df1h, df4h, df5m, symbol,
        sl_mode="atr",
        atr_sl_mult=sl, atr_tp_mult=tp, atr_be_mult=be,
        df1d=df1d, sim_start=sim_start, sim_end=sim_end,
    )
    sub = [t for t in trades if t.get("direction") == direction]
    N = len(sub)
    pnl = sum(t["pnl_usd"] for t in sub)
    winners = sum(t["pnl_usd"] for t in sub if t["pnl_usd"] > 0)
    losers = -sum(t["pnl_usd"] for t in sub if t["pnl_usd"] < 0)
    if losers == 0:
        pf = math.inf if winners > 0 else None
    else:
        pf = winners / losers
    # per-direction running max drawdown
    running = 0.0
    peak = 0.0
    max_dd = 0.0
    for t in sub:
        running += t["pnl_usd"]
        peak = max(peak, running)
        dd = running - peak
        max_dd = min(max_dd, dd)
    return {
        "atr_sl_mult": sl, "atr_tp_mult": tp, "atr_be_mult": be,
        "N": N, "pnl": pnl, "pf": pf,
        "max_dd_abs": round(max_dd, 2),
    }


def _best(results):
    """Pick winner per spec §7: pnl desc, ties by pf, ties by |max_dd|."""
    rows = [r for r in results if r["N"] > 0]
    if not rows:
        return None
    rows.sort(key=lambda r: (
        -r["pnl"],
        -(r["pf"] if r["pf"] is not None and r["pf"] != math.inf else 1e9),
        abs(r["max_dd_abs"]),
    ))
    return rows[0]


def _tune_symbol(args):
    """Worker: tune one symbol for both directions. Returns (symbol, per_dir_dict, full_rows)."""
    symbol, train_start, train_end, grid = args
    data_start = datetime(train_start.year - 1, 1, 1, tzinfo=timezone.utc)
    try:
        df1h = get_cached_data(symbol, "1h", start_date=data_start)
        df4h = get_cached_data(symbol, "4h", start_date=data_start)
        df5m = get_cached_data(symbol, "5m", start_date=data_start)
        df1d = get_cached_data(symbol, "1d", start_date=data_start)
    except Exception as e:
        return symbol, {"long": {"skip_reason": str(e)}, "short": {"skip_reason": str(e)}}, []

    if df1h.empty or df4h.empty or df5m.empty:
        return symbol, {"long": {"skip_reason": "no data"}, "short": {"skip_reason": "no data"}}, []

    out = {"long": {}, "short": {}}
    full_rows = []
    for direction in ["LONG", "SHORT"]:
        direction_rows = []
        for sl in grid["sl"]:
            for tp in grid["tp"]:
                for be in grid["be"]:
                    row = _run_combo(df1h, df4h, df5m, df1d, symbol,
                                      train_start, train_end, sl, tp, be, direction)
                    direction_rows.append(row)
                    full_rows.append({"symbol": symbol, "direction": direction, **row})
        best = _best(direction_rows)
        out[direction.lower()] = {"best": best} if best else {"skip_reason": "no trades in grid"}
    return symbol, out, full_rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-start", required=True)
    ap.add_argument("--train-end", required=True)
    ap.add_argument("--symbols", default=None,
                    help="Comma-sep; defaults to btc_scanner.DEFAULT_SYMBOLS")
    ap.add_argument("--output", default="data/tune/tune_results.json")
    ap.add_argument("--parallel", type=int, default=4)
    ap.add_argument("--test-mode", action="store_true",
                    help="Use reduced grid (2×2×1 = 4 combos) for E2E tests")
    args = ap.parse_args()

    train_start = datetime.strptime(args.train_start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    train_end = datetime.strptime(args.train_end, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    if args.symbols:
        symbols = [s.strip().upper() for s in args.symbols.split(",")]
    else:
        from btc_scanner import DEFAULT_SYMBOLS
        symbols = list(DEFAULT_SYMBOLS)

    grid = TEST_GRID if args.test_mode else FULL_GRID

    print(f"=== tune_per_direction: {len(symbols)} symbols × 2 dirs × {len(grid['sl'])*len(grid['tp'])*len(grid['be'])} combos ===", flush=True)

    work = [(sym, train_start, train_end, grid) for sym in symbols]
    results = {}
    full_rows = []
    t0 = time.time()
    if args.parallel > 1 and len(symbols) > 1:
        with Pool(args.parallel) as pool:
            for sym, out, rows in pool.imap_unordered(_tune_symbol, work):
                results[sym] = out
                full_rows.extend(rows)
                print(f"  v {sym}", flush=True)
    else:
        for w in work:
            sym, out, rows = _tune_symbol(w)
            results[sym] = out
            full_rows.extend(rows)
            print(f"  v {sym}", flush=True)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps({
        "train_start": args.train_start,
        "train_end": args.train_end,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "git_sha": _git_sha(),
        "grid": grid,
        "results": results,
    }, indent=2, default=str))

    csv_path = out_path.with_name("tune_grid_full.csv")
    with csv_path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["symbol", "direction", "atr_sl_mult", "atr_tp_mult",
                                           "atr_be_mult", "N", "pnl", "pf", "max_dd_abs"])
        w.writeheader()
        for row in full_rows:
            w.writerow(row)

    print(f"=== done in {time.time() - t0:.1f}s ===")
    print(f"  wrote {out_path}")
    print(f"  wrote {csv_path}")


if __name__ == "__main__":
    main()
