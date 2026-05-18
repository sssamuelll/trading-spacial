// ============================================================
// auto-tune-copilot.ts — synchronous prose + per-symbol verdicts
// for the Análisis → Auto-tune view. ZERO LLM calls; the LLM only
// enters when the user clicks the brief CTA or a per-symbol
// verdict CTA (freeform payload routed through AgentDock).
// ============================================================

import type {
  AtrParams,
  TuneResultRow,
  TuneRun,
  TuneAggregates,
} from './auto-tune';

export type Tone = 'bull' | 'bear' | 'warn' | 'neutral' | 'dim';

export interface SymbolVerdict {
  tone:     Tone;
  glyph:    string;
  text:     string;
  action:   string;
  warnings: string[];
}

export interface TuneBrief {
  headline: string;
  lines:    string[];
}

// ── symbolVerdict ────────────────────────────────────────────

/** Tonal verdict per `TuneResultRow`. Priority-ordered branches:
 *  ERROR / NO_DATA / KEEP (split by validation pnl sign) / CHANGE-hot
 *  (>20% + >50 ops) / CHANGE-solid (>=5% + >30 ops) / CHANGE-frágil
 *  (<20 val ops) / CHANGE-marginal (<5% improvement) / CHANGE-aggressive
 *  (SL widens >30%) / CHANGE-neutral. */
export function symbolVerdict(r: TuneResultRow): SymbolVerdict {
  if (r.recommendation === 'ERROR') {
    return {
      tone: 'warn', glyph: '⚠',
      text: 'El backtest falló en este símbolo — revisar logs antes del próximo ciclo.',
      action: 'Ver detalle del error',
      warnings: ['error en el backtest del símbolo'],
    };
  }

  if (r.recommendation === 'NO_DATA') {
    return {
      tone: 'dim', glyph: '◌',
      text: 'Sin datos suficientes para proponer un cambio — el símbolo es muy nuevo o tiene pocas operaciones.',
      action: '¿Cuándo tendría datos?',
      warnings: [],
    };
  }

  if (r.recommendation === 'KEEP') {
    const pnl = r.current_val_pnl;
    const text =
      pnl != null && pnl < 0
        ? `Validation negativa ($${pnl.toFixed(2)}) pero ninguna propuesta supera al actual — el sistema está al límite.`
        : 'Los parámetros actuales siguen siendo los mejores en validation — no hay mejora estadística.';
    return {
      tone: 'dim', glyph: '◌', text,
      action: `¿Por qué no cambia ${r.symbol.replace(/USDT$/, '')}?`,
      warnings: [],
    };
  }

  // CHANGE branch — proposal_detail and proposed_params guaranteed.
  const d = r.proposal_detail!;
  const proposed = r.proposed_params!;
  const warnings: string[] = [];

  const slDelta = (proposed.atr_sl_mult - r.current_params.atr_sl_mult) / r.current_params.atr_sl_mult;
  if (d.val_trades < 20)      warnings.push(`solo ${d.val_trades} operaciones en validation`);
  if (d.improvement_pct < 5)  warnings.push(`mejora dentro del ruido (+${d.improvement_pct.toFixed(1)}%)`);
  if (slDelta > 0.30)         warnings.push(`SL amplía ${(slDelta * 100).toFixed(0)}% — más capital en riesgo`);

  const pair = r.symbol.replace(/USDT$/, '');

  if (d.improvement_pct > 20 && d.val_trades > 50) {
    return {
      tone: 'bull', glyph: '◆',
      text: `Propuesta sólida: +${d.improvement_pct.toFixed(1)}% con ${d.val_trades} ops de validation. Confianza alta — el resultado tiene base estadística.`,
      action: `¿Aplicar ${pair}?`,
      warnings,
    };
  }
  if (d.improvement_pct >= 5 && d.val_trades > 30) {
    return {
      tone: 'bull', glyph: '◉',
      text: `Mejora razonable: +${d.improvement_pct.toFixed(1)}% con ${d.val_trades} ops. Muestra suficiente para considerar el cambio.`,
      action: `¿Aplicar ${pair}?`,
      warnings,
    };
  }
  if (d.val_trades < 20) {
    return {
      tone: 'warn', glyph: '◐',
      text: `Propuesta frágil: solo ${d.val_trades} ops en validation. El resultado puede ser ruido — espera más datos o aplica con cautela.`,
      action: `Cuestionar ${pair}`,
      warnings,
    };
  }
  if (d.improvement_pct < 5) {
    return {
      tone: 'warn', glyph: '◐',
      text: `Mejora marginal (+${d.improvement_pct.toFixed(1)}%) — está dentro del ruido estadístico. No vale el cambio.`,
      action: `¿Vale aplicar ${pair}?`,
      warnings,
    };
  }
  if (slDelta > 0.30) {
    return {
      tone: 'warn', glyph: '◐',
      text: `Cambio agresivo: el SL se amplía ${(slDelta * 100).toFixed(0)}%. Más holgura para el trade pero más capital en riesgo por operación.`,
      action: `Discutir SL de ${pair}`,
      warnings,
    };
  }
  return {
    tone: 'neutral', glyph: '◯',
    text: `Cambio modesto (+${d.improvement_pct.toFixed(1)}%) con ${d.val_trades} ops. Aceptable, sin warnings.`,
    action: `Detalles de ${pair}`,
    warnings,
  };
}

// ── buildTuneBrief ───────────────────────────────────────────

/** Synthesize a synchronous brief (headline + lines) from a TuneRun
 *  and its aggregates. The view renders this without an LLM call. */
export function buildTuneBrief(t: TuneRun | null, agg: TuneAggregates): TuneBrief {
  if (!t || !t.results || t.results.length === 0) {
    return {
      headline: 'Sin tune pendiente.',
      lines:    ['El sistema está al día con los parámetros actuales.'],
    };
  }

  const cr = t.results.filter((r) => r.recommendation === 'CHANGE');
  const sign = agg.improvementUsd >= 0 ? '+' : '';
  const headline =
    `${agg.toChange} cambios propuestos · ` +
    `mejora agregada ${sign}$${agg.improvementUsd.toFixed(2)} en validation · ` +
    `${agg.toKeep} KEEP`;

  const lines: string[] = [];

  if (cr.length > 0) {
    const best = cr.reduce((a, b) =>
      (b.proposal_detail?.improvement_pct ?? 0) > (a.proposal_detail?.improvement_pct ?? 0) ? b : a,
    );
    lines.push(
      `El cambio con más impacto es ${best.symbol.replace(/USDT$/, '')} ` +
      `(+${best.proposal_detail!.improvement_pct.toFixed(1)}% con ${best.proposal_detail!.val_trades} ops de validation).`,
    );

    if (cr.length > 1) {
      const conservative = cr.reduce((a, b) =>
        (b.proposal_detail?.improvement_pct ?? 0) < (a.proposal_detail?.improvement_pct ?? 0) ? b : a,
      );
      if (conservative.symbol !== best.symbol) {
        lines.push(
          `El más conservador es ${conservative.symbol.replace(/USDT$/, '')} ` +
          `(+${conservative.proposal_detail!.improvement_pct.toFixed(1)}%) — vale revisar si vale el ruido.`,
        );
      }
    }
  }

  if (agg.noData > 0 || agg.errors > 0) {
    const parts: string[] = [];
    if (agg.noData > 0) parts.push(`${agg.noData} sin datos suficientes`);
    if (agg.errors > 0) parts.push(`${agg.errors} con error en el backtest`);
    lines.push(`${parts.join(' · ')}.`);
  }

  if (agg.warningCount > 0) {
    lines.push(
      `${agg.warningCount} warning${agg.warningCount === 1 ? '' : 's'} ` +
      `detectado${agg.warningCount === 1 ? '' : 's'} — revisar antes de aplicar.`,
    );
  }

  return { headline, lines };
}

// ── paramTone ────────────────────────────────────────────────

/** Tone for a single param change. SL widening = warn (more capital
 *  at risk); TP widening = bull (bigger target); BE never changes
 *  capital exposure so it stays neutral. |delta| < 0.005 = dim. */
export function paramTone(key: 'sl' | 'tp' | 'be', current: number, proposed: number): Tone {
  const delta = proposed - current;
  if (Math.abs(delta) < 0.005) return 'dim';
  if (key === 'sl') return delta > 0 ? 'warn' : 'bull';
  if (key === 'tp') return delta > 0 ? 'bull' : 'warn';
  return 'neutral';
}

// Re-export AtrParams for callers that import only from this module.
export type { AtrParams };
