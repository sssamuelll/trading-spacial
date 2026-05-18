// ============================================================
// historial.ts — pure aggregations for the Análisis → Historial
// view. No React, no I/O. The whole window-filter / metrics
// pipeline is recomputed on every relevant change via useMemo
// in the component; these helpers are the work.
// ============================================================

export interface ClosedTrade {
  id:        number;
  symbol:    string;           // e.g. "ETHUSDT"
  pair:      string;            // display form, e.g. "ETH" — derived in the caller
  side:      'L' | 'S';
  entry:     number;
  exit:      number;
  qty:       number;
  pnlAbs:    number;
  pnlPct:    number;
  reason:    'TP_HIT' | 'SL_HIT' | 'MANUAL';
  daysAgo:   number;            // (now - closed_ts) / 1 day
  heldHours: number;            // (closed_ts - opened_ts) / 3600s
}

export interface Aggregates {
  n:            number;
  wins:         number;
  losses:       number;
  pnlTotal:     number;
  wr:           number | null;
  profitFactor: number;          // Infinity when only winners; 0 when only losers
  avgHold:      number;
  avgWin:       number;
  avgLoss:      number;
  grossWin:     number;
  grossLoss:    number;
}

export interface PairGroup {
  pair:   string;
  trades: ClosedTrade[];
  agg:    Aggregates;
}

export function aggregate(rows: ClosedTrade[]): Aggregates {
  const n         = rows.length;
  const wins      = rows.filter((r) => r.pnlAbs > 0);
  const losses    = rows.filter((r) => r.pnlAbs <= 0);
  const pnlTotal  = rows.reduce((a, r) => a + r.pnlAbs, 0);
  const wr        = n === 0 ? null : (wins.length / n) * 100;
  const grossWin  = wins.reduce((a, r) => a + r.pnlAbs, 0);
  const grossLoss = Math.abs(losses.reduce((a, r) => a + r.pnlAbs, 0));
  const profitFactor = grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss;
  const avgHold = n === 0 ? 0 : rows.reduce((a, r) => a + r.heldHours, 0) / n;
  const avgWin  = wins.length   ? wins.reduce((a, r) => a + r.pnlPct, 0) / wins.length     : 0;
  const avgLoss = losses.length ? losses.reduce((a, r) => a + r.pnlPct, 0) / losses.length : 0;
  return {
    n,
    wins:    wins.length,
    losses:  losses.length,
    pnlTotal,
    wr,
    profitFactor,
    avgHold,
    avgWin,
    avgLoss,
    grossWin,
    grossLoss,
  };
}

/** Group rows by symbol pair. Each group's trades are sorted oldest→newest
 *  (daysAgo desc) so the inline TradesTable reads top→bottom in time order.
 *  The groups themselves are sorted by absolute P&L impact — the pairs that
 *  moved the needle most (in either direction) come first. */
export function groupByPair(rows: ClosedTrade[]): PairGroup[] {
  const byPair: Record<string, ClosedTrade[]> = {};
  for (const r of rows) {
    if (!byPair[r.pair]) byPair[r.pair] = [];
    byPair[r.pair].push(r);
  }
  // Sort each pair's trades ascending by daysAgo — newest first.
  for (const arr of Object.values(byPair)) arr.sort((a, b) => a.daysAgo - b.daysAgo);
  return Object.entries(byPair)
    .map(([pair, trades]) => ({ pair, trades, agg: aggregate(trades) }))
    .sort((a, b) => Math.abs(b.agg.pnlTotal) - Math.abs(a.agg.pnlTotal));
}
