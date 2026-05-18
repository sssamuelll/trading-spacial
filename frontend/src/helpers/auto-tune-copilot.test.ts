import { describe, it, expect } from 'vitest';
import { aggregateTune, type TuneResultRow, type TuneRun, type ProposalDetail, type AtrParams } from './auto-tune';
import { symbolVerdict, buildTuneBrief, paramTone } from './auto-tune-copilot';

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

function run(results: TuneResultRow[]): TuneRun {
  return {
    id:            42,
    ts:            '2026-05-15T00:00:00Z',
    hoursAgo:      12,
    status:        'pending',
    changes_count: results.filter((r) => r.recommendation === 'CHANGE').length,
    applied_ts:    null,
    results,
  };
}

describe('symbolVerdict', () => {
  it('ERROR → tone warn + glyph ⚠ + 1 warning', () => {
    const v = symbolVerdict(row({ recommendation: 'ERROR', proposed_params: null, proposal_detail: null }));
    expect(v.tone).toBe('warn');
    expect(v.glyph).toBe('⚠');
    expect(v.warnings).toHaveLength(1);
  });

  it('NO_DATA → tone dim + glyph ◌ + 0 warnings', () => {
    const v = symbolVerdict(row({ recommendation: 'NO_DATA', proposed_params: null, proposal_detail: null }));
    expect(v.tone).toBe('dim');
    expect(v.glyph).toBe('◌');
    expect(v.warnings).toHaveLength(0);
  });

  it('KEEP con pnl positivo → tone dim + texto "siguen siendo los mejores"', () => {
    const v = symbolVerdict(row({
      recommendation: 'KEEP', current_val_pnl: 120, proposed_params: null, proposal_detail: null,
    }));
    expect(v.tone).toBe('dim');
    expect(v.text).toContain('siguen siendo los mejores');
  });

  it('KEEP con pnl negativo → tone dim + texto "sistema al límite"', () => {
    const v = symbolVerdict(row({
      recommendation: 'KEEP', current_val_pnl: -25, proposed_params: null, proposal_detail: null,
    }));
    expect(v.tone).toBe('dim');
    expect(v.text).toContain('límite');
  });

  it('CHANGE >20% + >50 ops → tone bull + glyph ◆ (hot)', () => {
    const v = symbolVerdict(row({
      proposal_detail: detail({ improvement_pct: 39.5, val_trades: 58 }),
    }));
    expect(v.tone).toBe('bull');
    expect(v.glyph).toBe('◆');
  });

  it('CHANGE >=5% + >30 ops → tone bull + glyph ◉ (solid)', () => {
    const v = symbolVerdict(row({
      proposal_detail: detail({ improvement_pct: 12, val_trades: 40 }),
    }));
    expect(v.tone).toBe('bull');
    expect(v.glyph).toBe('◉');
  });

  it('CHANGE con <20 val_trades → tone warn + warning "solo N operaciones"', () => {
    const v = symbolVerdict(row({
      proposal_detail: detail({ improvement_pct: 25, val_trades: 14 }),
    }));
    expect(v.tone).toBe('warn');
    expect(v.warnings.some((w) => w.includes('14') && w.includes('operaciones'))).toBe(true);
  });

  it('CHANGE con <5% improvement → tone warn + warning "mejora dentro del ruido"', () => {
    const v = symbolVerdict(row({
      proposal_detail: detail({ improvement_pct: 3.1, val_trades: 40 }),
    }));
    expect(v.tone).toBe('warn');
    expect(v.warnings.some((w) => w.includes('ruido'))).toBe(true);
  });

  it('CHANGE con SL+30% → tone warn + warning "SL amplía X%"', () => {
    const v = symbolVerdict(row({
      current_params:  params({ atr_sl_mult: 2.0 }),
      proposed_params: params({ atr_sl_mult: 2.8 }),   // +40%
      proposal_detail: detail({ improvement_pct: 12, val_trades: 40 }),
    }));
    expect(v.warnings.some((w) => w.includes('SL amplía'))).toBe(true);
  });

  it('CHANGE acumula múltiples warnings (caso RUNE: <20 ops + SL+40%)', () => {
    const v = symbolVerdict(row({
      symbol:          'RUNEUSDT',
      current_params:  params({ atr_sl_mult: 2.0 }),
      proposed_params: params({ atr_sl_mult: 2.8 }),
      proposal_detail: detail({ improvement_pct: 25, val_trades: 14 }),
    }));
    expect(v.warnings.length).toBeGreaterThanOrEqual(2);
    expect(v.warnings.some((w) => w.includes('operaciones'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('SL amplía'))).toBe(true);
  });
});

describe('buildTuneBrief', () => {
  it('tune null → headline "Sin tune pendiente"', () => {
    const t = null;
    const b = buildTuneBrief(t, aggregateTune(t));
    expect(b.headline.toLowerCase()).toContain('sin tune');
  });

  it('results vacío → headline "Sin tune pendiente"', () => {
    const t = run([]);
    const b = buildTuneBrief(t, aggregateTune(t));
    expect(b.headline.toLowerCase()).toContain('sin tune');
  });

  it('best y worst distintos → ambas líneas', () => {
    const t = run([
      row({ symbol: 'BTCUSDT',  proposal_detail: detail({ improvement_pct: 39.5, val_trades: 58 }) }),
      row({ symbol: 'PENDLEUSDT', proposal_detail: detail({ improvement_pct: 3.1, val_trades: 40 }) }),
    ]);
    const b = buildTuneBrief(t, aggregateTune(t));
    expect(b.lines.some((l) => l.includes('BTC') && l.includes('impacto'))).toBe(true);
    expect(b.lines.some((l) => l.includes('PENDLE') && l.includes('conservador'))).toBe(true);
  });

  it('best == worst (un solo CHANGE) → solo línea de best, no conservador', () => {
    const t = run([
      row({ symbol: 'BTCUSDT', proposal_detail: detail({ improvement_pct: 30 }) }),
      row({ symbol: 'AVAXUSDT', recommendation: 'KEEP', proposed_params: null, proposal_detail: null }),
    ]);
    const b = buildTuneBrief(t, aggregateTune(t));
    expect(b.lines.some((l) => l.includes('BTC') && l.includes('impacto'))).toBe(true);
    expect(b.lines.some((l) => l.includes('conservador'))).toBe(false);
  });

  it('NO_DATA y ERROR ambos > 0 → concat correcto', () => {
    const t = run([
      row({ symbol: 'BTCUSDT' }),
      row({ symbol: 'DOGEUSDT', recommendation: 'NO_DATA', proposed_params: null, proposal_detail: null }),
      row({ symbol: 'XLMUSDT',  recommendation: 'ERROR',   proposed_params: null, proposal_detail: null }),
    ]);
    const b = buildTuneBrief(t, aggregateTune(t));
    const concat = b.lines.find((l) => l.includes('sin datos') && l.includes('error'));
    expect(concat).toBeDefined();
  });

  it('warningCount > 0 → agrega línea final', () => {
    const t = run([
      row({ symbol: 'RUNEUSDT',
        proposal_detail: detail({ improvement_pct: 25, val_trades: 14 }),
      }),
    ]);
    const agg = aggregateTune(t);
    const b = buildTuneBrief(t, agg);
    expect(agg.warningCount).toBeGreaterThan(0);
    expect(b.lines.some((l) => l.includes('warning'))).toBe(true);
  });
});

describe('paramTone', () => {
  it('sl widening → warn', () => {
    expect(paramTone('sl', 2.0, 2.4)).toBe('warn');
  });
  it('sl tightening → bull', () => {
    expect(paramTone('sl', 2.4, 2.0)).toBe('bull');
  });
  it('tp widening → bull', () => {
    expect(paramTone('tp', 3.0, 3.5)).toBe('bull');
  });
  it('tp tightening → warn', () => {
    expect(paramTone('tp', 3.5, 3.0)).toBe('warn');
  });
  it('be cualquier dirección → neutral', () => {
    expect(paramTone('be', 1.5, 1.7)).toBe('neutral');
    expect(paramTone('be', 1.7, 1.3)).toBe('neutral');
  });
  it('|delta| < 0.005 → dim (sin cambio)', () => {
    expect(paramTone('sl', 2.0, 2.001)).toBe('dim');
    expect(paramTone('tp', 3.0, 3.0)).toBe('dim');
  });
});
