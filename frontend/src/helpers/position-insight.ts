// ============================================================
// position-insight.ts — synchronous one-liner generator for each
// open position card. The PositionCard renders the returned tone +
// glyph + text + action verbatim, and the CTA opens the AgentDock
// with the full position context as the first user prompt.
//
// Six branches, evaluated in priority order:
//   1. tpProgress >= 0.75  → bull  ◆  near TP, suggest trailing
//   2. tpProgress >= 0.50  → bull  ◉  past midpoint, suggest B/E
//   3. slProgress >= 0.60  → bear  ⚠  near SL, suggest review thesis
//   4. pnl_pct  < -0.5     → warn  ◐  drawdown but SL margin OK
//   5. pnl_pct  > 0 && tpProgress < 0.3  → neutral  ◯  let it run
//   6. default              → dim   ◌  flat near entry
// ============================================================

import type { Position } from '../types';

export type InsightTone = 'bull' | 'bear' | 'warn' | 'neutral' | 'dim';

export interface PositionInsight {
  tone:   InsightTone;
  glyph:  string;
  text:   string;
  action: string;
}

/** Returns null if the position lacks SL or TP — without them we can't
 *  compute proximity progress and the insight row should not render. */
export function getPositionInsight(p: Position, currentPrice: number): PositionInsight | null {
  if (p.sl_price == null || p.tp_price == null) return null;

  const isLong = p.direction === 'LONG';
  const entry  = p.entry_price;
  const sl     = p.sl_price;
  const tp     = p.tp_price;
  const pnlPct = p.pnl_pct ?? 0;

  const tpProgress = isLong
    ? (currentPrice - entry) / (tp - entry)
    : (entry - currentPrice) / (entry - tp);
  const slProgress = isLong
    ? (entry - currentPrice) / (entry - sl)
    : (currentPrice - entry) / (sl - entry);
  const distToSl = Math.abs(currentPrice - sl);

  // 1. Near TP — time to lock in
  if (tpProgress >= 0.75) {
    return {
      tone:   'bull',
      glyph:  '◆',
      text:   `Casi en TP (${(tpProgress * 100).toFixed(0)}% del recorrido). Considera cerrar parcial o activar trailing antes de que retroceda.`,
      action: 'Discutir trailing stop',
    };
  }
  // 2. Past midpoint toward TP
  if (tpProgress >= 0.5) {
    return {
      tone:   'bull',
      glyph:  '◉',
      text:   `Vas ${(tpProgress * 100).toFixed(0)}% al TP. Buen momento para subir el SL a break-even y proteger la ganancia.`,
      action: 'Mover SL a break-even',
    };
  }
  // 3. Near SL — warn early
  if (slProgress >= 0.6) {
    return {
      tone:   'bear',
      glyph:  '⚠',
      text:   `A ${((distToSl / currentPrice) * 100).toFixed(2)}% del stop. La tesis original quizá ya no aplica — revisa antes de aguantar.`,
      action: 'Repasar tesis',
    };
  }
  // 4. In drawdown but not near SL
  if (pnlPct < -0.5) {
    return {
      tone:   'warn',
      glyph:  '◐',
      text:   `En pérdida (${pnlPct.toFixed(2)}%) pero el stop aún tiene margen. Si tu plan permite, espera el rebote sin tocar el SL.`,
      action: 'Estresar el setup',
    };
  }
  // 5. Modest gain, lots of room
  if (pnlPct > 0 && tpProgress < 0.3) {
    return {
      tone:   'neutral',
      glyph:  '◯',
      text:   `Apenas ${pnlPct.toFixed(2)}% arriba — la tesis sigue jugando. No toques nada, deja que corra.`,
      action: '¿Cuándo movería SL?',
    };
  }
  // 6. Flat near entry — default
  return {
    tone:   'dim',
    glyph:  '◌',
    text:   `Posición flotando cerca de entrada. Sin urgencia — sigue al precio sin overtradear.`,
    action: '¿Y si tarda 2h más?',
  };
}
