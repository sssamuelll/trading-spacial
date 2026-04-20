"""Gate that validates a tuned config vs baseline on test + full windows.

Spec: docs/superpowers/specs/es/2026-04-20-per-direction-atr-params-design.md §9
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def run_portfolio(config, start, end, symbols, df_fng, df_funding):
    """Run the portfolio with the given config over the window.
    Returns {total_pnl, max_dd_pct, per_symbol: {sym: {pnl, pf, max_dd_pct}}}."""
    from backtest import get_cached_data, simulate_strategy, calculate_metrics
    overrides = config.get("symbol_overrides", {})
    data_start = datetime(start.year - 1, 1, 1, tzinfo=timezone.utc)

    per_sym = {}
    total_pnl = 0.0
    max_dd_agg = 0.0
    for sym in symbols:
        try:
            df1h = get_cached_data(sym, "1h", start_date=data_start)
            df4h = get_cached_data(sym, "4h", start_date=data_start)
            df5m = get_cached_data(sym, "5m", start_date=data_start)
            df1d = get_cached_data(sym, "1d", start_date=data_start)
        except Exception as e:
            per_sym[sym] = {"pnl": 0, "pf": 0, "max_dd_pct": 0,
                             "error": f"data load failed: {e}"}
            continue
        if df1h.empty or df4h.empty or df5m.empty:
            per_sym[sym] = {"pnl": 0, "pf": 0, "max_dd_pct": 0, "error": "no data"}
            continue
        trades, equity = simulate_strategy(
            df1h, df4h, df5m, sym,
            df1d=df1d, sim_start=start, sim_end=end,
            df_fng=df_fng, df_funding=df_funding,
            symbol_overrides=overrides,
        )
        m = calculate_metrics(trades, equity)
        per_sym[sym] = {
            "pnl": m["net_pnl"],
            "pf": m["profit_factor"],
            "max_dd_pct": m["max_drawdown_pct"],
        }
        total_pnl += m["net_pnl"]
        max_dd_agg = min(max_dd_agg, m["max_drawdown_pct"])

    return {"total_pnl": total_pnl, "max_dd_pct": max_dd_agg, "per_symbol": per_sym}


def evaluate_gate(baseline, tuned):
    """Return (verdict, [reasons]) per spec §9 — 4 criteria."""
    reasons = []
    fail = False

    # 1. Aggregate P&L
    bl_pnl = baseline["total_pnl"]
    tn_pnl = tuned["total_pnl"]
    if bl_pnl > 0:
        req = bl_pnl * 1.10
        ok1 = tn_pnl >= req
        pct = (tn_pnl - bl_pnl) / bl_pnl * 100
        reasons.append(
            f"[1] aggregate P&L: baseline ${bl_pnl:+,.0f} → tuned ${tn_pnl:+,.0f} "
            f"(delta {pct:+.1f}%, required +10%). {'OK' if ok1 else 'FAIL'}"
        )
    else:
        ok1 = tn_pnl >= bl_pnl + 1000
        reasons.append(
            f"[1] aggregate P&L: baseline ≤ 0 ({bl_pnl:+,.0f}); required ≥ baseline + $1000. "
            f"Tuned ${tn_pnl:+,.0f}. {'OK' if ok1 else 'FAIL'}"
        )
    fail = fail or not ok1

    # 2. Max DD
    dd_delta = tuned["max_dd_pct"] - baseline["max_dd_pct"]
    ok2 = dd_delta >= -2.0
    reasons.append(
        f"[2] aggregate Max DD: baseline {baseline['max_dd_pct']:.1f}% → "
        f"tuned {tuned['max_dd_pct']:.1f}% (delta {dd_delta:+.1f}pp, tolerance -2pp). "
        f"{'OK' if ok2 else 'FAIL'}"
    )
    fail = fail or not ok2

    # 3. Per-symbol
    fails_sym = []
    for sym, bl in baseline["per_symbol"].items():
        tn = tuned["per_symbol"].get(sym, {"pnl": 0, "pf": 0})
        if bl["pnl"] > 0:
            pct = (tn["pnl"] - bl["pnl"]) / bl["pnl"] * 100
            if pct < -10.0:
                fails_sym.append(f"{sym}: {bl['pnl']:+,.0f} → {tn['pnl']:+,.0f} ({pct:+.1f}%)")
        elif bl["pnl"] < 0:
            if tn["pnl"] < bl["pnl"] - 1000:
                fails_sym.append(f"{sym}: loss deepened by >$1000")
    ok3 = len(fails_sym) == 0
    reasons.append(f"[3] per-symbol regressions: {'OK' if ok3 else 'FAIL — ' + '; '.join(fails_sym)}")
    fail = fail or not ok3

    # 4. DOGE PF
    doge_pf = tuned["per_symbol"].get("DOGEUSDT", {}).get("pf", 0)
    ok4 = doge_pf >= 4.0
    reasons.append(f"[4] DOGE PF: {doge_pf:.2f} (required ≥ 4.0). {'OK' if ok4 else 'FAIL'}")
    fail = fail or not ok4

    return ("FAIL" if fail else "PASS", reasons)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline-config", required=True)
    ap.add_argument("--tuned-config", required=True)
    ap.add_argument("--test-start", required=True)
    ap.add_argument("--test-end", required=True)
    ap.add_argument("--full-start", required=True)
    ap.add_argument("--full-end", required=True)
    ap.add_argument("--output", default="/tmp/gate_report.json")
    args = ap.parse_args()

    import backtest as _backtest
    baseline_cfg = json.loads(Path(args.baseline_config).read_text())
    tuned_cfg = json.loads(Path(args.tuned_config).read_text())

    from btc_scanner import DEFAULT_SYMBOLS
    symbols = list(DEFAULT_SYMBOLS)

    df_fng = _backtest.get_historical_fear_greed()
    df_funding = _backtest.get_historical_funding_rate()

    test_start = datetime.strptime(args.test_start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    test_end = datetime.strptime(args.test_end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    full_start = datetime.strptime(args.full_start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    full_end = datetime.strptime(args.full_end, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    print(f"=== Running baseline on test window ({args.test_start} → {args.test_end})... ===", flush=True)
    bl_test = run_portfolio(baseline_cfg, test_start, test_end, symbols, df_fng, df_funding)
    print(f"=== Running tuned on test window... ===", flush=True)
    tn_test = run_portfolio(tuned_cfg, test_start, test_end, symbols, df_fng, df_funding)
    print(f"=== Running baseline on full window (informative)... ===", flush=True)
    bl_full = run_portfolio(baseline_cfg, full_start, full_end, symbols, df_fng, df_funding)
    print(f"=== Running tuned on full window (informative)... ===", flush=True)
    tn_full = run_portfolio(tuned_cfg, full_start, full_end, symbols, df_fng, df_funding)

    verdict, reasons = evaluate_gate(bl_test, tn_test)

    print("")
    print("=" * 60)
    print(f"  GATE: Per-direction ATR tuning")
    print(f"  Test window: {args.test_start} → {args.test_end}")
    print("=" * 60)
    print(f"  Aggregate P&L:   baseline=${bl_test['total_pnl']:+,.0f}  tuned=${tn_test['total_pnl']:+,.0f}")
    print(f"  Aggregate DD:    baseline={bl_test['max_dd_pct']:.1f}%  tuned={tn_test['max_dd_pct']:.1f}%")
    print("")
    print(f"  DOGE PF (tuned): {tn_test['per_symbol'].get('DOGEUSDT', {}).get('pf', 0):.2f}")
    print("")
    for r in reasons:
        print(f"  {r}")
    print("")
    print(f"  VERDICT: {verdict}")
    print("")
    print(f"  Full-window context (NOT for verdict):")
    print(f"    baseline ${bl_full['total_pnl']:+,.0f}  tuned ${tn_full['total_pnl']:+,.0f}")
    print("=" * 60)

    Path(args.output).write_text(json.dumps({
        "verdict": verdict,
        "reasons": reasons,
        "test": {"baseline": bl_test, "tuned": tn_test},
        "full": {"baseline": bl_full, "tuned": tn_full},
    }, indent=2, default=str))
    print(f"  Wrote {args.output}")

    sys.exit(0 if verdict == "PASS" else 1)


if __name__ == "__main__":
    main()
