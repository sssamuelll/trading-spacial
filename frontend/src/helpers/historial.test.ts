import { describe, it, expect } from 'vitest';
import { aggregate, groupByPair, type ClosedTrade } from './historial';

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

describe('aggregate', () => {
  it('n=0 → wr null, pnlTotal 0, profitFactor 0', () => {
    const a = aggregate([]);
    expect(a.n).toBe(0);
    expect(a.wr).toBeNull();
    expect(a.pnlTotal).toBe(0);
    expect(a.profitFactor).toBe(0);
  });

  it('all wins → profitFactor Infinity', () => {
    const a = aggregate([t({ id: 1, pnlAbs:  5 }), t({ id: 2, pnlAbs: 10 })]);
    expect(a.wins).toBe(2);
    expect(a.losses).toBe(0);
    expect(a.wr).toBe(100);
    expect(a.profitFactor).toBe(Infinity);
  });

  it('all losses → profitFactor 0, wr 0', () => {
    const a = aggregate([t({ id: 1, pnlAbs: -5 }), t({ id: 2, pnlAbs: -10 })]);
    expect(a.wins).toBe(0);
    expect(a.losses).toBe(2);
    expect(a.wr).toBe(0);
    expect(a.profitFactor).toBe(0);
  });

  it('mix → profitFactor = grossWin / grossLoss', () => {
    const a = aggregate([
      t({ id: 1, pnlAbs:  10 }),
      t({ id: 2, pnlAbs:  20 }),
      t({ id: 3, pnlAbs: -10 }),
    ]);
    expect(a.grossWin).toBe(30);
    expect(a.grossLoss).toBe(10);
    expect(a.profitFactor).toBe(3);
    expect(a.wr).toBeCloseTo((2 / 3) * 100, 5);
  });
});

describe('groupByPair', () => {
  it('orders groups by |pnlTotal| descending', () => {
    const groups = groupByPair([
      t({ id: 1, pair: 'A', pnlAbs:  10 }),
      t({ id: 2, pair: 'B', pnlAbs: -50 }),
      t({ id: 3, pair: 'C', pnlAbs:  30 }),
    ]);
    expect(groups.map((g) => g.pair)).toEqual(['B', 'C', 'A']);
  });

  it("orders each pair's trades by daysAgo ascending (newest first)", () => {
    const groups = groupByPair([
      t({ id: 1, pair: 'X', daysAgo: 5 }),
      t({ id: 2, pair: 'X', daysAgo: 1 }),
      t({ id: 3, pair: 'X', daysAgo: 3 }),
    ]);
    expect(groups[0].trades.map((tr) => tr.id)).toEqual([2, 3, 1]);
  });
});
