import { describe, it, expect } from 'vitest';
import { aggregate, groupByPair, type ClosedTrade } from './historial';
import { pairVerdict, buildBrief } from './historial-copilot';

function t(overrides: Partial<ClosedTrade> = {}): ClosedTrade {
  return {
    id:        1,
    symbol:    'BTCUSDT',
    pair:      'BTC',
    side:      'L',
    entry:     100,
    exit:      110,
    qty:       1,
    pnlAbs:    10,
    pnlPct:    10,
    reason:    'TP_HIT',
    daysAgo:   1,
    heldHours: 8,
    ...overrides,
  };
}

function group(rows: ClosedTrade[]) {
  return { pair: rows[0]?.pair ?? 'X', trades: rows, agg: aggregate(rows) };
}

describe('pairVerdict', () => {
  it('hot streak: WR ≥75 + pnl>0 + n≥3 → bull / ◆', () => {
    const v = pairVerdict(group([
      t({ id: 1, pnlAbs:  10 }),
      t({ id: 2, pnlAbs:  20 }),
      t({ id: 3, pnlAbs:  30 }),
      t({ id: 4, pnlAbs: -10 }),  // 3/4 = 75%
    ]));
    expect(v.tone).toBe('bull');
    expect(v.glyph).toBe('◆');
  });

  it('solid winner: 55 ≤ WR < 75 + pnl>0 → bull / ◉', () => {
    const v = pairVerdict(group([
      t({ id: 1, pnlAbs:  10 }),
      t({ id: 2, pnlAbs:  20 }),
      t({ id: 3, pnlAbs: -10 }),  // 2/3 ≈ 66%
    ]));
    expect(v.tone).toBe('bull');
    expect(v.glyph).toBe('◉');
  });

  it('drain: WR <40 + pnl<0 + n≥3 → bear / ⚠', () => {
    const v = pairVerdict(group([
      t({ id: 1, pnlAbs:  10, reason: 'TP_HIT' }),
      t({ id: 2, pnlAbs: -20, reason: 'MANUAL' }),
      t({ id: 3, pnlAbs: -30, reason: 'MANUAL' }),
      // 1/3 ≈ 33% wr, pnl -40
    ]));
    expect(v.tone).toBe('bear');
    expect(v.glyph).toBe('⚠');
  });

  it('SL-heavy: ≥50% of exits are SL_HIT (not already drain) → warn / ◐', () => {
    // 2/4 wins for WR=50, so neither hot, nor solid (WR<55), nor drain.
    // SL count = 2 of 4 = 50% → SL-heavy branch.
    const v = pairVerdict(group([
      t({ id: 1, pnlAbs:  10, reason: 'TP_HIT' }),
      t({ id: 2, pnlAbs:  10, reason: 'TP_HIT' }),
      t({ id: 3, pnlAbs:  -5, reason: 'SL_HIT' }),
      t({ id: 4, pnlAbs:  -3, reason: 'SL_HIT' }),
    ]));
    expect(v.tone).toBe('warn');
    expect(v.glyph).toBe('◐');
  });

  it('mixed+ (pnl>0, doesn\'t qualify for solid/hot) → neutral / ◯', () => {
    // 1/2 wins → WR=50 (below solid 55), pnl +5
    const v = pairVerdict(group([
      t({ id: 1, pnlAbs: 10, reason: 'TP_HIT' }),
      t({ id: 2, pnlAbs: -5, reason: 'MANUAL' }),  // not SL_HIT, doesn't trigger SL-heavy
    ]));
    expect(v.tone).toBe('neutral');
    expect(v.glyph).toBe('◯');
  });

  it('mixed- (pnl≤0, n≥2, doesn\'t qualify for drain) → warn / ◐', () => {
    // 1/2 wins → WR=50 (above drain 40), pnl -5
    const v = pairVerdict(group([
      t({ id: 1, pnlAbs:  5, reason: 'TP_HIT' }),
      t({ id: 2, pnlAbs: -10, reason: 'MANUAL' }),
    ]));
    expect(v.tone).toBe('warn');
    expect(v.glyph).toBe('◐');
  });

  it('dim default: n=1 (no pattern) → dim / ◌', () => {
    // 1 op only — falls through all rules. WR=100 (no solid because pnl>0
    // but solid needs wr>=55 which it has BUT solid also wins).
    // Actually 1 win → wr 100, pnl 5, solid triggers. Use a loss instead.
    const v = pairVerdict(group([t({ id: 1, pnlAbs: -3 })]));
    expect(v.tone).toBe('dim');
    expect(v.glyph).toBe('◌');
  });
});

describe('buildBrief', () => {
  it('empty rows → "Sin operaciones..." headline', () => {
    const b = buildBrief({ rows: [], agg: aggregate([]), windowLabel: '7 días', pairs: [] });
    expect(b.headline.toLowerCase()).toContain('sin operaciones');
  });

  it('best and worst distinct → both lines present', () => {
    const rows: ClosedTrade[] = [
      t({ id: 1, pair: 'BTC', pnlAbs: 30 }),
      t({ id: 2, pair: 'ETH', pnlAbs: -20 }),
    ];
    const b = buildBrief({
      rows,
      agg:         aggregate(rows),
      windowLabel: '7 días',
      pairs:       groupByPair(rows),
    });
    expect(b.lines.some((l) => l.includes('BTC') && l.includes('mejor'))).toBe(true);
    expect(b.lines.some((l) => l.includes('ETH') && l.includes('restó'))).toBe(true);
  });

  it('best equals worst (single pair) → only the best line, not worst', () => {
    const rows: ClosedTrade[] = [t({ id: 1, pair: 'BTC', pnlAbs: 30 })];
    const b = buildBrief({
      rows,
      agg:         aggregate(rows),
      windowLabel: '7 días',
      pairs:       groupByPair(rows),
    });
    expect(b.lines.some((l) => l.includes('mejor'))).toBe(true);
    expect(b.lines.some((l) => l.includes('restó'))).toBe(false);
  });

  it('SL_HIT avg << TP_HIT avg / 2.5 → stops-respiran warning', () => {
    const rows: ClosedTrade[] = [
      t({ id: 1, reason: 'TP_HIT', heldHours: 30 }),
      t({ id: 2, reason: 'SL_HIT', heldHours: 4 }),
    ];
    const b = buildBrief({
      rows,
      agg:         aggregate(rows),
      windowLabel: '7 días',
      pairs:       groupByPair(rows),
    });
    expect(b.lines.some((l) => l.includes('SL_HIT') || l.includes('respiran'))).toBe(true);
  });

  it('PF ≥ 2 → "sano"; 1.3 ≤ PF < 2 → "colchón"; PF < 1.3 → "frágil"', () => {
    // PF = 2 exactly
    const rowsSano: ClosedTrade[] = [
      t({ id: 1, pnlAbs:  20 }),
      t({ id: 2, pnlAbs: -10 }),
    ];
    const bSano = buildBrief({
      rows: rowsSano, agg: aggregate(rowsSano), windowLabel: '7d', pairs: groupByPair(rowsSano),
    });
    expect(bSano.lines.some((l) => l.includes('sano'))).toBe(true);

    // PF = 1.5
    const rowsColchon: ClosedTrade[] = [
      t({ id: 1, pnlAbs:  15 }),
      t({ id: 2, pnlAbs: -10 }),
    ];
    const bColchon = buildBrief({
      rows: rowsColchon, agg: aggregate(rowsColchon), windowLabel: '7d', pairs: groupByPair(rowsColchon),
    });
    expect(bColchon.lines.some((l) => l.includes('colchón'))).toBe(true);

    // PF = 1.0
    const rowsFragil: ClosedTrade[] = [
      t({ id: 1, pnlAbs:  10 }),
      t({ id: 2, pnlAbs: -10 }),
    ];
    const bFragil = buildBrief({
      rows: rowsFragil, agg: aggregate(rowsFragil), windowLabel: '7d', pairs: groupByPair(rowsFragil),
    });
    expect(bFragil.lines.some((l) => l.includes('frágil'))).toBe(true);
  });
});
