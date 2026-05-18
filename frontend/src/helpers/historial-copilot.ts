// ============================================================
// historial-copilot.ts — synchronous prose + per-pair verdicts for
// the Análisis → Historial view. ZERO LLM calls; the LLM only
// enters when the user clicks the brief CTA or a per-pair verdict.
// ============================================================

import type { Aggregates, ClosedTrade, PairGroup } from './historial';

export type Tone = 'bull' | 'bear' | 'warn' | 'neutral' | 'dim';

export interface PairVerdict {
  tone:   Tone;
  glyph:  string;
  text:   string;
  action: string;
}

export interface Brief {
  headline: string;
  lines:    string[];
}

// ── pairVerdict ──────────────────────────────────────────────

/** Tonal verdict per pair group. Seven priority-ordered branches:
 *  hot streak → solid winner → drain → SL-heavy → mixed+ → mixed- → dim. */
export function pairVerdict(group: PairGroup): PairVerdict {
  const { pair, trades, agg } = group;
  const { n, wins, losses, pnlTotal, wr, profitFactor, avgHold } = agg;

  if (n === 0) {
    return { tone: 'dim', glyph: '◌', text: 'Sin operaciones.', action: '—' };
  }

  // 1. Hot streak winner
  if (wr !== null && wr >= 75 && pnlTotal > 0 && n >= 3) {
    return {
      tone:   'bull',
      glyph:  '◆',
      text:   `${wins}/${n} wins · ratio ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}x. Tu mejor par del periodo — el setup está sintonizado, sigue dejándolo correr.`,
      action: `¿Qué hace bien en ${pair}?`,
    };
  }
  // 2. Solid winner
  if (wr !== null && wr >= 55 && pnlTotal > 0) {
    return {
      tone:   'bull',
      glyph:  '◉',
      text:   `${wins}W/${losses}L · +$${pnlTotal.toFixed(2)} en ${n} ops. Está produciendo sin sobresaltos — no toques los parámetros.`,
      action: `¿Subir tamaño en ${pair}?`,
    };
  }
  // 3. Drain
  if (pnlTotal < 0 && wr !== null && wr < 40 && n >= 3) {
    return {
      tone:   'bear',
      glyph:  '⚠',
      text:   `${losses}/${n} pérdidas · -$${Math.abs(pnlTotal).toFixed(2)}. Está drenando capital — el kill-switch probablemente ya lo tenga marcado.`,
      action: `¿Pausar ${pair} manualmente?`,
    };
  }
  // 4. Stops too tight (≥50% of exits are SL_HIT)
  const slCount = trades.filter((t) => t.reason === 'SL_HIT').length;
  if (slCount >= 2 && slCount / n >= 0.5) {
    return {
      tone:   'warn',
      glyph:  '◐',
      text:   `${slCount}/${n} salidas por SL · holds promedio ${avgHold.toFixed(1)}h. Los stops están demasiado cerca para tu timeframe — considera ampliar.`,
      action: `Revisar SL en ${pair}`,
    };
  }
  // 5. Mixed but net positive
  if (pnlTotal > 0) {
    return {
      tone:   'neutral',
      glyph:  '◯',
      text:   `${wins}W/${losses}L · neto +$${pnlTotal.toFixed(2)}. Mixto pero rentable — vale la pena mantener observación.`,
      action: `¿Qué patrón ves en ${pair}?`,
    };
  }
  // 6. Mixed net negative (small N)
  if (pnlTotal <= 0 && n >= 2) {
    return {
      tone:   'warn',
      glyph:  '◐',
      text:   `${wins}W/${losses}L · -$${Math.abs(pnlTotal).toFixed(2)}. Sin tendencia clara — pocas ops para concluir.`,
      action: `¿Vale seguir operando ${pair}?`,
    };
  }
  // 7. Default — one operation, no pattern
  return {
    tone:   'dim',
    glyph:  '◌',
    text:   `${n} operación${n === 1 ? '' : 'es'} · sin patrón establecido.`,
    action: `Más contexto de ${pair}`,
  };
}

// ── buildBrief ───────────────────────────────────────────────

export function buildBrief(args: {
  rows:        ClosedTrade[];
  agg:         Aggregates;
  windowLabel: string;
  pairs:       PairGroup[];
}): Brief {
  const { rows, agg, windowLabel, pairs } = args;

  if (rows.length === 0) {
    return {
      headline: `Sin operaciones en los últimos ${windowLabel.toLowerCase()}.`,
      lines:    ['El periodo elegido no tiene cierres. Cambia la ventana arriba o ve al historial completo.'],
    };
  }

  const best  = pairs[0] ? pairs.reduce((a, b) => (b.agg.pnlTotal > a.agg.pnlTotal ? b : a)) : null;
  const worst = pairs[0] ? pairs.reduce((a, b) => (b.agg.pnlTotal < a.agg.pnlTotal ? b : a)) : null;

  const wr = agg.wr ?? 0;
  const headline = agg.pnlTotal >= 0
    ? `${windowLabel}: ${agg.wins}W/${agg.losses}L · +$${agg.pnlTotal.toFixed(2)} · WR ${wr.toFixed(0)}%`
    : `${windowLabel}: ${agg.wins}W/${agg.losses}L · -$${Math.abs(agg.pnlTotal).toFixed(2)} · WR ${wr.toFixed(0)}%`;

  const lines: string[] = [];

  if (best && best.agg.pnlTotal > 0) {
    lines.push(`Tu mejor par fue ${best.pair} (+$${best.agg.pnlTotal.toFixed(2)} en ${best.agg.n} ops, WR ${(best.agg.wr ?? 0).toFixed(0)}%).`);
  }
  if (worst && worst.agg.pnlTotal < 0 && worst.pair !== (best && best.pair)) {
    lines.push(`${worst.pair} te restó $${Math.abs(worst.agg.pnlTotal).toFixed(2)} con ${worst.agg.losses}/${worst.agg.n} pérdidas — el kill-switch probablemente lo tenga vigilado.`);
  }

  const slRows = rows.filter((r) => r.reason === 'SL_HIT');
  const tpRows = rows.filter((r) => r.reason === 'TP_HIT');
  if (slRows.length && tpRows.length) {
    const slAvg = slRows.reduce((a, r) => a + r.heldHours, 0) / slRows.length;
    const tpAvg = tpRows.reduce((a, r) => a + r.heldHours, 0) / tpRows.length;
    if (tpAvg > slAvg * 2.5) {
      lines.push(`Los SL_HIT duran en promedio ${slAvg.toFixed(1)}h vs los TP_HIT ${tpAvg.toFixed(1)}h — confirma que los stops respiran lo suficiente para tu timeframe.`);
    }
  }

  if (agg.profitFactor !== Infinity && agg.profitFactor > 0) {
    const pf = agg.profitFactor;
    const tone =
      pf >= 2   ? '— sano, el sistema gana más de lo que pierde.' :
      pf >= 1.3 ? '— rentable pero con poco colchón.' :
                  '— frágil, una racha mala lo voltea.';
    lines.push(`Profit factor ${pf.toFixed(2)}x ${tone}`);
  }

  return { headline, lines };
}
