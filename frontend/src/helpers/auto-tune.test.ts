import { describe, it, expect } from 'vitest';
import {
  aggregateTune,
  type TuneResultRow,
  type TuneRun,
  type ProposalDetail,
  type AtrParams,
} from './auto-tune';

function params(overrides: Partial<AtrParams> = {}): AtrParams {
  return { atr_sl_mult: 2.0, atr_tp_mult: 3.0, atr_be_mult: 1.5, ...overrides };
}

function detail(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    val_pnl:         200,
    val_pf:          2.5,
    improvement_pct: 25,
    total_trades:    100,
    train_pnl:       300,
    val_trades:      60,
    ...overrides,
  };
}

function row(overrides: Partial<TuneResultRow> = {}): TuneResultRow {
  return {
    symbol:           'BTCUSDT',
    recommendation:   'CHANGE',
    current_params:   params(),
    proposed_params:  params({ atr_sl_mult: 2.4, atr_tp_mult: 3.5 }),
    current_val_pnl:  150,
    proposal_detail:  detail(),
    ...overrides,
  };
}

function run(results: TuneResultRow[], overrides: Partial<TuneRun> = {}): TuneRun {
  return {
    id:            42,
    ts:            '2026-05-15T00:00:00Z',
    hoursAgo:      12,
    status:        'pending',
    changes_count: results.filter((r) => r.recommendation === 'CHANGE').length,
    applied_ts:    null,
    results,
    ...overrides,
  };
}

describe('aggregateTune', () => {
  it('null → empty agg', () => {
    const a = aggregateTune(null);
    expect(a.total).toBe(0);
    expect(a.toChange).toBe(0);
    expect(a.improvementUsd).toBe(0);
    expect(a.warningCount).toBe(0);
  });

  it('results vacío → empty agg', () => {
    const a = aggregateTune(run([]));
    expect(a.total).toBe(0);
    expect(a.toChange).toBe(0);
    expect(a.avgImprovementPct).toBe(0);
  });

  it('mix CHANGE/KEEP/NO_DATA/ERROR → counts correctos', () => {
    const a = aggregateTune(run([
      row({ symbol: 'BTCUSDT',  recommendation: 'CHANGE'  }),
      row({ symbol: 'ETHUSDT',  recommendation: 'CHANGE'  }),
      row({ symbol: 'AVAXUSDT', recommendation: 'KEEP',    proposed_params: null, proposal_detail: null }),
      row({ symbol: 'JUPUSDT',  recommendation: 'KEEP',    proposed_params: null, proposal_detail: null }),
      row({ symbol: 'DOGEUSDT', recommendation: 'NO_DATA', proposed_params: null, proposal_detail: null }),
      row({ symbol: 'XLMUSDT',  recommendation: 'ERROR',   proposed_params: null, proposal_detail: null }),
    ]));
    expect(a.total).toBe(6);
    expect(a.toChange).toBe(2);
    expect(a.toKeep).toBe(2);
    expect(a.noData).toBe(1);
    expect(a.errors).toBe(1);
  });

  it('improvementUsd = suma de (proposed.val_pnl - current_val_pnl) solo CHANGE', () => {
    const a = aggregateTune(run([
      // CHANGE: +50 (200 - 150)
      row({ symbol: 'BTCUSDT', current_val_pnl: 150, proposal_detail: detail({ val_pnl: 200 }) }),
      // CHANGE: +30 (130 - 100)
      row({ symbol: 'ETHUSDT', current_val_pnl: 100, proposal_detail: detail({ val_pnl: 130 }) }),
      // KEEP — debe ignorarse en la suma
      row({ symbol: 'AVAXUSDT', recommendation: 'KEEP', current_val_pnl: 500, proposed_params: null, proposal_detail: null }),
    ]));
    expect(a.improvementUsd).toBe(80);
  });

  it('avgImprovementPct = promedio solo de CHANGE', () => {
    const a = aggregateTune(run([
      row({ symbol: 'A', proposal_detail: detail({ improvement_pct: 10 }) }),
      row({ symbol: 'B', proposal_detail: detail({ improvement_pct: 30 }) }),
      row({ symbol: 'C', recommendation: 'KEEP', proposed_params: null, proposal_detail: null }),
    ]));
    expect(a.avgImprovementPct).toBe(20);
  });

  it('warningCount = suma de symbolVerdict(r).warnings.length', () => {
    const a = aggregateTune(run([
      // Hot: improvement 25%, 60 ops, SL 2.0→2.4 = 20% widening → no warnings
      row({ symbol: 'BTCUSDT' }),
      // CHANGE frágil: val_trades=14 → 1 warning
      row({ symbol: 'RUNEUSDT',
        proposal_detail:  detail({ val_trades: 14, improvement_pct: 25 }),
        proposed_params:  params({ atr_sl_mult: 2.8 }),  // SL +40% → +1 warning
      }),
    ]));
    expect(a.warningCount).toBe(2);
  });
});
