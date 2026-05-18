// ============================================================
// auto-tune.ts — types + aggregations for the Análisis →
// Auto-tune view. Pure functions, no React, no I/O.
// ============================================================

import { symbolVerdict } from './auto-tune-copilot';

// ── Types ────────────────────────────────────────────────────

/** ATR multipliers — the params auto-tune adjusts per symbol. */
export interface AtrParams {
  atr_sl_mult: number;
  atr_tp_mult: number;
  atr_be_mult: number;
}

export type Recommendation = 'CHANGE' | 'KEEP' | 'NO_DATA' | 'ERROR';

/** Backtest result for the proposed params on a symbol. */
export interface ProposalDetail {
  val_pnl:         number;
  val_pf:          number;
  improvement_pct: number;
  total_trades:    number;
  train_pnl:       number;
  val_trades:      number;
}

/** One row of `auto_tune_results` — per-symbol recommendation. */
export interface TuneResultRow {
  symbol:           string;
  recommendation:   Recommendation;
  current_params:   AtrParams;
  proposed_params:  AtrParams | null;
  current_val_pnl:  number | null;
  proposal_detail:  ProposalDetail | null;
}

export type TuneStatus = 'pending' | 'applied' | 'rejected';

/** The auto-tune run — what the backend returns from /tune/latest,
 *  plus a client-derived `hoursAgo`. */
export interface TuneRun {
  id:             number;
  ts:             string;          // ISO timestamp
  hoursAgo:       number;          // (now - ts) / 3600s, client-derived
  status:         TuneStatus;
  changes_count:  number;
  applied_ts:     string | null;
  report_md?:     string;
  results:        TuneResultRow[];
}

export interface TuneHistoryRow {
  id:            number;
  ts:            string;            // YYYY-MM-DD
  daysAgo:       number;
  status:        TuneStatus;
  changes_count: number;
  summary:       string;
}

export interface TuneAggregates {
  total:              number;
  toChange:           number;
  toKeep:             number;
  noData:             number;
  errors:             number;
  improvementUsd:     number;
  avgImprovementPct:  number;
  warningCount:       number;
}

// ── aggregateTune ────────────────────────────────────────────

/** Per-run aggregates: counts by recommendation, total improvement in
 *  USD (sum of proposal.val_pnl - current_val_pnl across CHANGEs),
 *  average improvement %, and the total number of warnings the
 *  per-symbol verdict heuristic raises. */
export function aggregateTune(t: TuneRun | null): TuneAggregates {
  const empty: TuneAggregates = {
    total: 0, toChange: 0, toKeep: 0, noData: 0, errors: 0,
    improvementUsd: 0, avgImprovementPct: 0, warningCount: 0,
  };
  if (!t || !t.results) return empty;
  const r = t.results;
  const toChange = r.filter((x) => x.recommendation === 'CHANGE');
  const toKeep   = r.filter((x) => x.recommendation === 'KEEP');
  const noData   = r.filter((x) => x.recommendation === 'NO_DATA');
  const errors   = r.filter((x) => x.recommendation === 'ERROR');

  const improvementUsd = toChange.reduce((acc, x) => {
    const cur = x.current_val_pnl ?? 0;
    const pr  = x.proposal_detail?.val_pnl ?? cur;
    return acc + (pr - cur);
  }, 0);

  const avgImprovementPct = toChange.length === 0
    ? 0
    : toChange.reduce((acc, x) => acc + (x.proposal_detail?.improvement_pct ?? 0), 0) / toChange.length;

  const warningCount = toChange.reduce((acc, x) => acc + symbolVerdict(x).warnings.length, 0);

  return {
    total:              r.length,
    toChange:           toChange.length,
    toKeep:             toKeep.length,
    noData:             noData.length,
    errors:             errors.length,
    improvementUsd,
    avgImprovementPct,
    warningCount,
  };
}
