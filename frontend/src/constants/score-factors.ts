// ============================================================
// score-factors.ts — the 9 score components evaluated by the v6
// backend (btc_scanner.py), with plain-language explanations.
//
// Used by SymbolDetail's Setup tab to render the checklist.
// When the backend ships `score_components: boolean[]` on
// SymbolStatus, swap the synthetic builder in SymbolDetail for the
// real array — the FACTORS metadata here doesn't change.
// ============================================================

export interface ScoreFactor {
  key:   string;   // short code shown in the chip
  label: string;   // friendly title
  plain: string;   // plain-Spanish explanation
}

export const SCORE_FACTORS: ScoreFactor[] = [
  { key: 'LRC',    label: 'LRC% en zona',          plain: 'El precio está cerca del borde inferior del canal de regresión (zona de compra).' },
  { key: 'RSI',    label: 'RSI en sobreventa',     plain: 'El oscilador RSI 1H está por debajo de 30, indicando precio sobrevendido.' },
  { key: 'BB',     label: 'Bollinger inferior',    plain: 'El precio tocó o cruzó la banda inferior de Bollinger.' },
  { key: 'SMA100', label: 'Precio > SMA 100',      plain: 'El precio cotiza por encima de la media móvil 100 (sesgo alcista local).' },
  { key: 'MACRO',  label: 'Macro 4H alcista',      plain: 'En el chart 4H, el precio está por encima de la SMA100 — la tendencia macro acompaña.' },
  { key: 'REG',    label: 'Régimen favorable',     plain: 'El mercado global (BTC dominance, F&G) no está en pánico extremo ni euforia.' },
  { key: 'VOL',    label: 'Volumen creciente',     plain: 'El volumen del último ciclo supera al promedio reciente.' },
  { key: 'TREND',  label: 'Estructura alcista',    plain: 'Higher-lows confirmados en el chart 1H.' },
  { key: 'TRIG',   label: 'Gatillo 5M confirmado', plain: 'Vela de 5M cerró por encima del nivel de disparo.' },
];
