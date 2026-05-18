// ============================================================
// useScanCountdown — derive scan progress (0..1) and seconds-left
// from a reference `lastRefreshTs`. Used for the heartbeat bar and
// the "next 12s" readout.
// ============================================================

import { useNow } from './useNow';

interface CountdownResult {
  progress: number;   // 0..1
  secsLeft: number;   // integer seconds until next scan
}

/**
 * If `lastRefreshTs` is null, we anchor to component-mount time
 * (the hook stays stable across renders).
 */
export function useScanCountdown(
  cycleMs: number = 30_000,
  lastRefreshTs: number | null = null,
): CountdownResult {
  const now = useNow(1000);
  const anchor = lastRefreshTs ?? now - cycleMs;  // assume "due now" if unknown
  const elapsed = Math.max(0, Math.min(cycleMs, now - anchor));
  const progress = elapsed / cycleMs;
  const secsLeft = Math.max(0, Math.ceil((cycleMs - elapsed) / 1000));
  return { progress, secsLeft };
}
