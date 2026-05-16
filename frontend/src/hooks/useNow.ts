// ============================================================
// useNow — ticks every `intervalMs`. Drives "Xs ago" counters
// and the scan heartbeat.
// ============================================================

import { useEffect, useState } from 'react';

export function useNow(intervalMs: number = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
