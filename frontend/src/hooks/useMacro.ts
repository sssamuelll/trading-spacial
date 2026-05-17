// ============================================================
// useMacro — polls /macro every `intervalMs` (default 30s).
//
// Macro signals move slowly: regime cache refreshes daily, F&G daily,
// funding 8h. 30s frontend polling is comfortably finer than that and
// the server caches another 30s, so upstream load stays negligible.
// ============================================================

import { useEffect, useState } from 'react';
import { getMacro, type MacroResponse } from '../api';

export function useMacro(intervalMs: number = 30000): MacroResponse | null {
  const [data, setData] = useState<MacroResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      try {
        const resp = await getMacro();
        if (!cancelled) setData(resp);
      } catch {
        // Swallow — keep the last known snapshot through transient blips.
      }
    };

    tick();
    const id = setInterval(tick, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [intervalMs]);

  return data;
}
