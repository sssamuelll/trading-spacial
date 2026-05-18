// ============================================================
// brief.ts — synchronous prose composer for AgentBrief.
//
// Reads the live portfolio state (symbols + positions + macro) and
// returns paragraphs + clickable highlights. ZERO LLM calls: the
// morning briefing must render instantly. The LLM only enters when
// the user opens the dock or clicks a chip that pre-fills a prompt.
// ============================================================

import type { SymbolStatus, Position, MacroState } from '../types';

export type HighlightTone = 'bull' | 'bear' | 'warn';
export type HighlightKind = 'fresh-signal' | 'near-tp' | 'risk-position';

export interface BriefHighlight {
  kind:  HighlightKind;
  tone:  HighlightTone;
  pair:  string;       // full symbol id, e.g. "BTCUSDT" — caller normalizes
  title: string;
  sub:   string;
}

export interface Brief {
  paragraphs:      string[];
  highlights:      BriefHighlight[];
  firingHighScore: SymbolStatus[];
  winningPos:      Position[];
  losingPos:       Position[];
}

function greetingFor(hour: number): string {
  if (hour < 6)  return 'Madrugada complicada';
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function pairDisplay(s: SymbolStatus): string {
  return s.symbol.replace('USDT', '');
}

export function computeBrief(
  symbols:   SymbolStatus[],
  positions: Position[],
  macro:     MacroState,
): Brief {
  // 1. Symbol buckets
  const firingHighScore = symbols
    .filter((s) => (s.score ?? 0) >= 5 && s.señal === true)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const watching = symbols.filter((s) => (s.score ?? 0) >= 2 && (s.score ?? 0) < 5);

  // 2. Position buckets — only open positions count for the briefing.
  const openPositions = positions.filter((p) => p.status === 'open');
  const winningPos = openPositions.filter((p) => (p.pnl_pct ?? 0) > 0);
  const losingPos  = openPositions.filter((p) => (p.pnl_pct ?? 0) < 0);
  const totalPnl   = openPositions.reduce((a, p) => a + (p.pnl_usd ?? 0), 0);

  // 3. Compose paragraphs
  const paragraphs:  string[]          = [];
  const highlights:  BriefHighlight[]  = [];

  // Opener — scanner state + portfolio P&L
  const greeting = greetingFor(new Date().getHours());
  let opener = `${greeting}. El escáner lleva ${macro.scansToday} ciclos con ${macro.signalsToday} señales y ${macro.errors} errores.`;
  if (openPositions.length === 0) {
    opener += ' No tienes posiciones abiertas — el capital está disponible.';
  } else {
    const sign = totalPnl >= 0 ? '+' : '';
    opener += ` Tus ${openPositions.length} posición${openPositions.length === 1 ? '' : 'es'} suma${openPositions.length === 1 ? '' : 'n'} ${sign}$${totalPnl.toFixed(2)}.`;
  }
  paragraphs.push(opener);

  // Setups firmes / watching
  if (firingHighScore.length > 0) {
    const top = firingHighScore.slice(0, 3).map(pairDisplay).join(', ');
    paragraphs.push(`Hay ${firingHighScore.length} setup${firingHighScore.length === 1 ? '' : 's'} firme${firingHighScore.length === 1 ? '' : 's'}: ${top}. Score ≥ 5 con gatillo activo.`);
    firingHighScore.slice(0, 2).forEach((s) => {
      highlights.push({
        kind:  'fresh-signal',
        tone:  'bull',
        pair:  s.symbol,
        title: `${pairDisplay(s)} disparó setup`,
        sub:   `score ${s.score ?? 0}/9 · LRC ${(s.lrc_pct ?? 0).toFixed(1)}%`,
      });
    });
  } else if (watching.length > 0) {
    paragraphs.push(`Sin setups firmes en este momento. ${watching.length} par${watching.length === 1 ? '' : 'es'} en seguimiento esperando confirmación.`);
  } else {
    paragraphs.push('Mercado tranquilo. Ningún par cerca de disparar setup.');
  }

  // Positions context — only when both winners and losers present
  if (winningPos.length > 0 && losingPos.length > 0) {
    const w = winningPos[0];
    const l = losingPos[0];
    paragraphs.push(`${w.symbol.replace('USDT', '')} va a +${(w.pnl_pct ?? 0).toFixed(2)}%, ${l.symbol.replace('USDT', '')} a ${(l.pnl_pct ?? 0).toFixed(2)}%. Revisa si toca asegurar o ajustar SL.`);
    highlights.push({
      kind:  'near-tp',
      tone:  'bull',
      pair:  w.symbol,
      title: `${w.symbol.replace('USDT', '')} en ganancia`,
      sub:   `+${(w.pnl_pct ?? 0).toFixed(2)}% · considera asegurar`,
    });
    highlights.push({
      kind:  'risk-position',
      tone:  'bear',
      pair:  l.symbol,
      title: `${l.symbol.replace('USDT', '')} en pérdida`,
      sub:   `${(l.pnl_pct ?? 0).toFixed(2)}% · ${(l.pnl_usd ?? 0) >= 0 ? '+' : ''}$${(l.pnl_usd ?? 0).toFixed(2)}`,
    });
  }

  // Macro caveat — only if we actually have the data
  if (macro.regime === 'BEAR' || (macro.fng != null && macro.fng < 30)) {
    const fngStr = macro.fng != null ? `${macro.fng}` : '—';
    const rgStr  = macro.regime ?? '—';
    paragraphs.push(`Cuidado: régimen ${rgStr} y F&G ${fngStr}. Reduce tamaño y evita operar en contra.`);
  } else if (macro.killSwitchActive > 0) {
    paragraphs.push(`${macro.killSwitchActive} par(es) pausados por kill-switch. Revisa antes de habilitarlos manualmente.`);
  }

  return { paragraphs, highlights, firingHighScore, winningPos, losingPos };
}
