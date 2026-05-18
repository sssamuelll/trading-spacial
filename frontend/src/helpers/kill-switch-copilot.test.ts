// ============================================================
// kill-switch-copilot.test.ts — one test per branch of
// computeCardVerdict + a handful for computeKsReading shapes.
// ============================================================

import { describe, it, expect } from 'vitest';
import type {
  DashboardSymbolState,
  DashboardPortfolioState,
} from '../types';
import {
  computeKsReading,
  computeCardVerdict,
  groupByTier,
} from './kill-switch-copilot';

function makeSymbol(overrides: Partial<DashboardSymbolState> = {}): DashboardSymbolState {
  return {
    symbol: 'BTCUSDT',
    state:  'NORMAL',
    state_since: '2026-05-18T10:00:00Z',
    manual_override: false,
    metrics: {
      trades_count_total:           20,
      win_rate_20_trades:           0.50,
      win_rate_10_trades:           0.50,
      pnl_30d:                      0,
      months_negative_consecutive:  0,
      probation_trades_remaining:   null,
      paused_days_at_entry:         null,
    },
    last_transition: null,
    sparkline_20:    Array(20).fill('W'),
    next_conditions: 'mantener WR > 40%',
    ...overrides,
  };
}

function makePortfolio(overrides: Partial<DashboardPortfolioState> = {}): DashboardPortfolioState {
  return {
    tier:                'NORMAL',
    dd_pct:              0,
    peak_equity:         10000,
    current_equity:      10000,
    concurrent_failures: 0,
    recent_transitions:  [],
    ...overrides,
  };
}

// ── computeCardVerdict ──────────────────────────────────────

describe('computeCardVerdict', () => {
  it('PAUSED with monthsNeg >= 2 → stance hold, text mentions estructural', () => {
    const s = makeSymbol({
      state: 'PAUSED',
      metrics: { ...makeSymbol().metrics, months_negative_consecutive: 2 },
    });
    const v = computeCardVerdict(s);
    expect(v).not.toBeNull();
    expect(v!.stance).toBe('hold');
    expect(v!.text.toLowerCase()).toContain('estructural');
  });

  it('PROBATION with 4/5 wins → stance optimistic', () => {
    const s = makeSymbol({
      state: 'PROBATION',
      sparkline_20: ['W', 'L', 'W', 'W', 'L', 'W', 'W', 'W', 'W', 'L', 'W', 'L', 'W', 'L', 'W', 'L', 'W', 'W', 'W', 'W'],
    });
    // The last 5 here are W, W, W, W, W → 5 wins, well above 3
    const v = computeCardVerdict(s);
    expect(v).not.toBeNull();
    expect(v!.stance).toBe('optimistic');
  });

  it('PROBATION with 2/5 wins → stance neutral', () => {
    const s = makeSymbol({
      state: 'PROBATION',
      sparkline_20: ['W', 'L', 'W', 'W', 'L', 'W', 'W', 'W', 'W', 'L', 'W', 'L', 'W', 'L', 'L', 'L', 'W', 'L', 'L', 'W'],
    });
    // Last 5: W, L, L, L, W → 2 wins
    const v = computeCardVerdict(s);
    expect(v).not.toBeNull();
    expect(v!.stance).toBe('neutral');
  });

  it('REDUCED → stance consider', () => {
    const s = makeSymbol({ state: 'REDUCED' });
    const v = computeCardVerdict(s);
    expect(v).not.toBeNull();
    expect(v!.stance).toBe('consider');
  });

  it('ALERT → stance chill', () => {
    const s = makeSymbol({
      state: 'ALERT',
      last_transition: { from_state: 'NORMAL', to_state: 'ALERT', reason: '2 pérdidas consecutivas', ts: '2026-05-18T09:00:00Z' },
    });
    const v = computeCardVerdict(s);
    expect(v).not.toBeNull();
    expect(v!.stance).toBe('chill');
  });

  it('NORMAL → null', () => {
    const s = makeSymbol({ state: 'NORMAL' });
    expect(computeCardVerdict(s)).toBeNull();
  });
});

// ── computeKsReading ────────────────────────────────────────

describe('computeKsReading', () => {
  it('portfolio NORMAL + 0 intervenciones → headline contains "calmado"', () => {
    const symbols = [
      makeSymbol({ symbol: 'BTCUSDT' }),
      makeSymbol({ symbol: 'ETHUSDT' }),
    ];
    const r = computeKsReading(makePortfolio(), symbols, groupByTier(symbols));
    expect(r.headline.toLowerCase()).toContain('calmado');
    expect(r.intervened).toBe(0);
    expect(r.tone).toBe('bull');
  });

  it('portfolio WARNED + 1 PAUSED → headline mentions WARNED and "frenó"', () => {
    const symbols = [
      makeSymbol({
        symbol: 'AVAXUSDT',
        state:  'PAUSED',
        metrics: { ...makeSymbol().metrics, pnl_30d: -120 },
      }),
      makeSymbol({ symbol: 'BTCUSDT' }),
    ];
    const r = computeKsReading(
      makePortfolio({ tier: 'WARNED', dd_pct: 0.06 }),
      symbols,
      groupByTier(symbols),
    );
    expect(r.headline).toContain('WARNED');
    expect(r.headline.toLowerCase()).toContain('fren');
    expect(r.tone).toBe('warn');
  });

  it('chips include "¿cómo salgo de X?" when portfolio is not NORMAL', () => {
    const symbols = [makeSymbol({ symbol: 'AVAXUSDT', state: 'PAUSED' })];
    const r = computeKsReading(
      makePortfolio({ tier: 'WARNED', dd_pct: 0.06 }),
      symbols,
      groupByTier(symbols),
    );
    const labels = r.chips.map((c) => c.label);
    expect(labels.some((l) => l.includes('cómo salgo de WARNED'))).toBe(true);
  });

  it('chips always include "explícame en simple"', () => {
    const symbols = [makeSymbol()];
    const r = computeKsReading(makePortfolio(), symbols, groupByTier(symbols));
    expect(r.chips.map((c) => c.label)).toContain('explícame en simple');
  });
});
