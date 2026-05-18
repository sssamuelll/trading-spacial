// ============================================================
// position-insight.test.ts — one test per rule in getPositionInsight.
// Uses minimal Position stubs that exercise each branch.
// ============================================================

import { describe, it, expect } from 'vitest';
import type { Position } from '../types';
import { getPositionInsight } from './position-insight';

// Helper: build a long position with entry 100, SL 90 (so range = 20).
// TP is set per test; pnl_pct is informational only (the helper does not
// derive currentPrice from pnl_pct).
function longPos(overrides: Partial<Position> = {}): Position {
  return {
    id:          1,
    scan_id:     null,
    symbol:      'BTCUSDT',
    direction:   'LONG',
    status:      'open',
    entry_price: 100,
    entry_ts:    '2026-05-18T10:00:00Z',
    sl_price:    90,
    tp_price:    120,
    size_usd:    1000,
    qty:         10,
    exit_price:  null,
    exit_ts:     null,
    exit_reason: null,
    pnl_usd:     0,
    pnl_pct:     0,
    notes:       null,
    atr_entry:   null,
    ...overrides,
  };
}

describe('getPositionInsight', () => {
  it('returns null when sl_price is missing', () => {
    const p = longPos({ sl_price: null });
    expect(getPositionInsight(p, 100)).toBeNull();
  });

  it('returns null when tp_price is missing', () => {
    const p = longPos({ tp_price: null });
    expect(getPositionInsight(p, 100)).toBeNull();
  });

  it('rule 1: tpProgress >= 0.75 → bull / ◆ / trailing', () => {
    // entry=100, tp=120 → at 115, progress = 15/20 = 0.75
    const insight = getPositionInsight(longPos(), 115);
    expect(insight).not.toBeNull();
    expect(insight!.tone).toBe('bull');
    expect(insight!.glyph).toBe('◆');
    expect(insight!.action).toBe('Discutir trailing stop');
  });

  it('rule 2: tpProgress in [0.50, 0.75) → bull / ◉ / break-even', () => {
    // entry=100, tp=120 → at 110, progress = 10/20 = 0.50
    const insight = getPositionInsight(longPos(), 110);
    expect(insight).not.toBeNull();
    expect(insight!.tone).toBe('bull');
    expect(insight!.glyph).toBe('◉');
    expect(insight!.action).toBe('Mover SL a break-even');
  });

  it('rule 3: slProgress >= 0.6 → bear / ⚠ / repasar tesis', () => {
    // entry=100, sl=90 → at 94, slProgress = 6/10 = 0.6
    // pnl_pct passed so rule 4 isn't accidentally fired
    const insight = getPositionInsight(longPos({ pnl_pct: -6 }), 94);
    expect(insight).not.toBeNull();
    expect(insight!.tone).toBe('bear');
    expect(insight!.glyph).toBe('⚠');
    expect(insight!.action).toBe('Repasar tesis');
  });

  it('rule 4: pnl_pct < -0.5 and not near SL → warn / ◐ / estresar setup', () => {
    // entry=100, sl=90 → at 99, slProgress = 1/10 = 0.10 (below 0.60)
    const insight = getPositionInsight(longPos({ pnl_pct: -1 }), 99);
    expect(insight).not.toBeNull();
    expect(insight!.tone).toBe('warn');
    expect(insight!.glyph).toBe('◐');
    expect(insight!.action).toBe('Estresar el setup');
  });

  it('rule 5: positive pnl, tpProgress < 0.3 → neutral / ◯ / dejar correr', () => {
    // entry=100, tp=120 → at 105, progress = 5/20 = 0.25 (< 0.30)
    const insight = getPositionInsight(longPos({ pnl_pct: 5 }), 105);
    expect(insight).not.toBeNull();
    expect(insight!.tone).toBe('neutral');
    expect(insight!.glyph).toBe('◯');
    expect(insight!.action).toBe('¿Cuándo movería SL?');
  });

  it('default rule: flat near entry → dim / ◌ / sin urgencia', () => {
    // entry=100 → at 100, all progressions ≈ 0, pnl_pct = 0
    const insight = getPositionInsight(longPos(), 100);
    expect(insight).not.toBeNull();
    expect(insight!.tone).toBe('dim');
    expect(insight!.glyph).toBe('◌');
    expect(insight!.action).toBe('¿Y si tarda 2h más?');
  });

  it('SHORT direction reverses tpProgress sign', () => {
    // short: entry=100, sl=110, tp=80 → at 85, tpProgress = (100-85)/(100-80) = 15/20 = 0.75
    const p: Position = {
      ...longPos(),
      direction: 'SHORT',
      sl_price:  110,
      tp_price:  80,
    };
    const insight = getPositionInsight(p, 85);
    expect(insight).not.toBeNull();
    expect(insight!.tone).toBe('bull');
    expect(insight!.glyph).toBe('◆');
  });
});
