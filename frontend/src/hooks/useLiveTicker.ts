// ============================================================
// useLiveTicker — polls /ticker every `intervalMs`.
//
// Returns:
//   - prices:  latest spot price per symbol (Record<symbol, number>)
//   - history: rolling buffer of recent prices per symbol, capped at
//              MAX_HISTORY. Drives the sparkline in SymbolCard / SymbolRow.
//
// Independent of the 5-min scan cadence. Server caches ~2.5s so polling
// at 3s here lands one upstream hit per tab cycle. The buffer starts
// empty on mount and fills as polls arrive — ~MAX_HISTORY × intervalMs
// of real-time price history.
// ============================================================

import { useEffect, useState } from 'react';
import { getTicker } from '../api';

export interface LiveTickerData {
  prices:  Record<string, number>;
  changes: Record<string, number>;     // 24h percent change per symbol
  history: Record<string, number[]>;
}

const MAX_HISTORY = 60;

export function useLiveTicker(intervalMs: number = 3000): LiveTickerData {
  const [prices,  setPrices]  = useState<Record<string, number>>({});
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<Record<string, number[]>>({});

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const resp = await getTicker();
        if (cancelled || !resp.prices) return;
        setPrices(resp.prices);
        if (resp.changes) setChanges(resp.changes);
        setHistory((prev) => {
          const next: Record<string, number[]> = { ...prev };
          for (const [sym, p] of Object.entries(resp.prices)) {
            const buf = (prev[sym] ?? []).concat(p);
            next[sym] = buf.length > MAX_HISTORY ? buf.slice(-MAX_HISTORY) : buf;
          }
          return next;
        });
      } catch {
        // Swallow — keep the last known prices + history through transient blips.
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  return { prices, changes, history };
}
