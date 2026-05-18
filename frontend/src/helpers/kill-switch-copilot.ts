// ============================================================
// kill-switch-copilot.ts — synchronous, deterministic prose +
// per-card verdicts for the KillSwitchView. ZERO LLM calls;
// the LLM only enters when the user clicks a chip or a verdict.
// ============================================================

import type {
  DashboardSymbolState,
  DashboardPortfolioState,
  KillSwitchPerSymbolTier,
} from '../types';

// ── Public types ─────────────────────────────────────────────

export type VerdictStance = 'hold' | 'optimistic' | 'consider' | 'chill' | 'neutral';

export interface CardVerdict {
  stance: VerdictStance;
  text:   string;
  action: string;
}

export interface ReadingChip {
  label:  string;
  prompt: string;
}

export interface KsReading {
  headline:          string;
  insight:           string;
  recommendation:    string;
  chips:             ReadingChip[];
  intervened:        number;
  protectedCapital:  number;
  tone:              'bull' | 'warn' | 'neutral';
}

export type SymbolsByTier = Record<KillSwitchPerSymbolTier, DashboardSymbolState[]>;

// ── Helpers ──────────────────────────────────────────────────

function basePair(symbol: string): string {
  return symbol.replace('USDT', '');
}

/** Group symbols by their current per-symbol tier. Always returns an entry
 *  for every tier (empty array when none) so callers can index without
 *  defensive checks. */
export function groupByTier(symbols: DashboardSymbolState[]): SymbolsByTier {
  const groups: SymbolsByTier = {
    NORMAL:    [],
    ALERT:     [],
    REDUCED:   [],
    PROBATION: [],
    PAUSED:    [],
  };
  for (const s of symbols) {
    if (groups[s.state]) groups[s.state].push(s);
  }
  return groups;
}

// ── computeKsReading ─────────────────────────────────────────

/** Plain-Spanish narrative for the top strip of the kill-switch view.
 *  Three paragraphs (headline / insight / recommendation) + 2-3 chips
 *  with live-state-baked prompts that open the AgentDock. */
export function computeKsReading(
  portfolio: DashboardPortfolioState,
  symbols:   DashboardSymbolState[],
  byTier:    SymbolsByTier,
): KsReading {
  // Backend reports dd_pct as a fraction (0.05 = 5%). The UI displays in %.
  const ddPct = portfolio.dd_pct * 100;

  // Sum of negative pnl_30d contributions across all intervened symbols —
  // the rough "capital protected" by the kill-switch.
  const protectedCapital = Math.abs(
    symbols
      .filter((s) => s.state !== 'NORMAL')
      .reduce((acc, s) => acc + Math.min(0, s.metrics.pnl_30d ?? 0), 0),
  );

  const worst =
       symbols.find((s) => s.state === 'PAUSED')
    ?? symbols.find((s) => s.state === 'REDUCED')
    ?? null;
  const intervened = symbols.length - byTier.NORMAL.length;

  // Headline
  let headline: string;
  let tone: 'bull' | 'warn' | 'neutral' = 'neutral';
  if (intervened === 0) {
    headline = 'El sistema está calmado — ningún par requiere intervención.';
    tone = 'bull';
  } else if (portfolio.tier === 'NORMAL') {
    headline = `${intervened} ${intervened === 1 ? 'par está' : 'pares están'} intervenidos pero el portafolio sigue en NORMAL.`;
    tone = 'neutral';
  } else {
    headline = `Estamos en ${portfolio.tier} (DD ${ddPct.toFixed(1)}%). El kill-switch ya frenó $${protectedCapital.toFixed(0)} de exposición.`;
    tone = 'warn';
  }

  // Insight paragraph
  let insight: string;
  if (worst && worst.state === 'PAUSED') {
    const reason = (worst.last_transition?.reason ?? worst.next_conditions ?? '').toLowerCase();
    insight = `${basePair(worst.symbol)} es el principal contribuidor — ${reason || 'pérdidas estructurales'}. La pausa lo aleja del riesgo durante 7d.`;
  } else if (worst) {
    const reason = (worst.last_transition?.reason ?? worst.next_conditions ?? '').toLowerCase();
    insight = `${basePair(worst.symbol)} está reducido al 50% — ${reason || 'win rate por debajo del umbral'}.`;
  } else if (intervened > 0) {
    insight = 'Los pares intervenidos están en alerta preventiva, no en pausa total. El sistema está siendo conservador antes de tiempo.';
  } else {
    const totalPnl30 = symbols.reduce((a, s) => a + (s.metrics.pnl_30d ?? 0), 0);
    insight = `Los ${byTier.NORMAL.length} pares operativos suman ${totalPnl30 >= 0 ? '+' : ''}$${totalPnl30.toFixed(0)} en los últimos 30d.`;
  }

  // Recommendation
  let recommendation: string;
  if (portfolio.tier === 'FROZEN' || portfolio.tier === 'REDUCED') {
    recommendation = 'Considera no abrir posiciones nuevas hasta que el portafolio salga de este tier.';
  } else if (intervened >= 3) {
    recommendation = 'Varios pares cayeron de tier al mismo tiempo. Puede ser señal de mercado adverso, no de los pares individuales.';
  } else if (intervened === 0) {
    recommendation = 'Aprovecha la calma — buen momento para revisar la estrategia o tomar setups nuevos.';
  } else {
    recommendation = 'No fuerces release antes del ciclo automático — el sistema suele acertar más que la intuición.';
  }

  // Chips — prompts bake in the live state.
  const chips: ReadingChip[] = [];
  if (intervened > 0) {
    chips.push({
      label:  '¿debo forzar algún release?',
      prompt: 'Mirando el estado del kill-switch, ¿hay algún par donde sí valga la pena liberar manualmente antes del ciclo?',
    });
  }
  if (portfolio.tier !== 'NORMAL') {
    chips.push({
      label:  `¿cómo salgo de ${portfolio.tier}?`,
      prompt: `El portafolio está en ${portfolio.tier} con DD ${ddPct.toFixed(1)}%. ¿Qué tendría que pasar para volver a NORMAL y qué puedo hacer yo?`,
    });
  }
  chips.push({
    label:  'explícame en simple',
    prompt: 'Resume el estado del kill-switch en lenguaje muy directo, como para alguien que recién empieza.',
  });

  return { headline, insight, recommendation, chips, intervened, protectedCapital, tone };
}

// ── computeCardVerdict ───────────────────────────────────────

/** Returns the agent's posture on a single intervened symbol, or null
 *  for NORMAL pairs (no card-level verdict needed). */
export function computeCardVerdict(sym: DashboardSymbolState): CardVerdict | null {
  const reason = sym.last_transition?.reason ?? '';

  // PAUSED — let the cycle run; structural runs deserve a different copy.
  if (sym.state === 'PAUSED') {
    const monthsNeg = sym.metrics.months_negative_consecutive ?? 0;
    return {
      stance: 'hold',
      text:   `No fuerces release · ${monthsNeg >= 2 ? 'la mala racha es estructural, no ruido' : 'el sistema te está protegiendo de drawdown'}.`,
      action: '¿Y si yo creo que ya está OK?',
    };
  }

  // PROBATION — cautiously optimistic if winning 3+ of the last 5.
  if (sym.state === 'PROBATION') {
    const last5  = sym.sparkline_20.slice(-5);
    const wins   = last5.filter((o) => o === 'W').length;
    const stance = wins >= 3 ? 'optimistic' : 'neutral';
    const text =
      wins >= 3
        ? `Deja correr la prueba · está ganando ${wins}/5 últimos, va camino a NORMAL.`
        : `Deja correr la prueba · todavía indeciso (${wins}/5), no decidas anticipadamente.`;
    return { stance, text, action: 'Discutir si conviene release manual' };
  }

  // REDUCED — nuanced; lean on the live WR vs the 40% threshold.
  if (sym.state === 'REDUCED') {
    const wr = (sym.metrics.win_rate_20_trades ?? 0) * 100;
    return {
      stance: 'consider',
      text:
        wr >= 40
          ? 'Considera liberar manualmente · el WR se acerca al umbral.'
          : 'Considera liberar manualmente · el WR está bajo pero las últimas operaciones se ven mejor.',
      action: 'Repasar las 5 últimas operaciones',
    };
  }

  // ALERT — chill; only 2 losses, too early for conclusions.
  if (sym.state === 'ALERT') {
    return {
      stance: 'chill',
      text:   `Vigila pero no actúes · ${reason.includes('2 pérdidas') ? '2' : 'pocas'} pérdidas — demasiado pronto para conclusiones.`,
      action: '¿Cuándo sí debería preocuparme?',
    };
  }

  return null;
}
