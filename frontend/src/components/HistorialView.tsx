// ============================================================
// HistorialView — Análisis → Historial.
//
// Per-period closed-trade analytics with synchronous copilot
// prose (no LLM call) + opt-in conversation prompts that surface
// in the AgentDock via the freeform payload shape.
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import type { ReactNode } from 'react';
import styles from './HistorialView.module.css';
import { formatPrice } from '../utils';
import {
  aggregate,
  groupByPair,
  type ClosedTrade,
  type PairGroup,
} from '../helpers/historial';
import { pairVerdict, buildBrief, type Tone } from '../helpers/historial-copilot';

// ────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────

export type WindowKey = '7d' | '30d' | '90d' | 'all';
export type Mode      = 'por-par' | 'cronologico';

/** Freeform copilot prompt — same shape the rest of the app uses to
 *  pre-load AgentDock from any view. */
export interface AgentFreeformPrompt {
  __freeform: string;
}

export interface HistorialViewProps {
  trades:          ClosedTrade[];
  defaultWindow?:  WindowKey;
  defaultMode?:    Mode;
  onOpenSymbol:    (pair: string) => void;
  onAskAgent:      (payload: AgentFreeformPrompt) => void;
  onExport?:       (rows: ClosedTrade[], windowKey: WindowKey) => void;
  mobile?:         boolean;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const WINDOWS: { key: WindowKey; days: number; label: string }[] = [
  { key: '7d',  days:    7, label: '7 días'  },
  { key: '30d', days:   30, label: '30 días' },
  { key: '90d', days:   90, label: '90 días' },
  { key: 'all', days: 9999, label: 'Todo'    },
];

// ────────────────────────────────────────────────────────────
// CSV export
// ────────────────────────────────────────────────────────────

function defaultExportCsv(rows: ClosedTrade[], windowKey: WindowKey): void {
  const header = ['id', 'symbol', 'pair', 'side', 'entry', 'exit', 'qty', 'pnl_abs', 'pnl_pct', 'reason', 'days_ago', 'held_hours'];
  const lines  = [header.join(',')].concat(
    rows.map((r) => [r.id, r.symbol, r.pair, r.side, r.entry, r.exit, r.qty, r.pnlAbs, r.pnlPct, r.reason, r.daysAgo, r.heldHours].join(',')),
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `historial-${windowKey}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ────────────────────────────────────────────────────────────
// Main view
// ────────────────────────────────────────────────────────────

export function HistorialView({
  trades,
  defaultWindow = '30d',
  defaultMode   = 'por-par',
  onOpenSymbol,
  onAskAgent,
  onExport,
  mobile = false,
}: HistorialViewProps) {
  const [windowKey, setWindowKey] = useState<WindowKey>(defaultWindow);
  const [mode,      setMode]      = useState<Mode>(defaultMode);

  const win   = useMemo(() => WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[1], [windowKey]);
  const rows  = useMemo(() => trades.filter((r) => r.daysAgo <= win.days), [trades, win]);
  const agg   = useMemo(() => aggregate(rows), [rows]);
  const pairs = useMemo(() => groupByPair(rows), [rows]);
  const brief = useMemo(() => buildBrief({ rows, agg, windowLabel: win.label, pairs }), [rows, agg, win, pairs]);

  const handleExport = useCallback(() => {
    if (onExport) onExport(rows, windowKey);
    else          defaultExportCsv(rows, windowKey);
  }, [rows, windowKey, onExport]);

  const askAboutPeriod = useCallback(() => {
    onAskAgent({
      __freeform:
        `Repasemos mis últimos ${win.label.toLowerCase()}. ` +
        `${agg.wins}W/${agg.losses}L, P&L ${agg.pnlTotal >= 0 ? '+' : ''}$${agg.pnlTotal.toFixed(2)}, ` +
        `WR ${(agg.wr ?? 0).toFixed(0)}%, PF ${agg.profitFactor.toFixed(2)}x. ` +
        `¿Qué patrones ves? ¿Qué deberíamos ajustar para el próximo ciclo?`,
    });
  }, [win, agg, onAskAgent]);

  return (
    <main className={styles.hv}>
      {/* Page bar */}
      <div className={styles.pageBar}>
        <div className={styles.pageBarTitle}>
          <span className={styles.pageBarIndex}>A1</span>
          <span className={styles.pageBarName}>Historial</span>
          <span className={styles.pageBarSep}>/</span>
          <span className={`${styles.pageBarHint} prose`}>
            análisis · {rows.length === 0
              ? `sin operaciones en ${win.label.toLowerCase()}`
              : `${rows.length} operaciones cerradas en ${win.label.toLowerCase()}`}
          </span>
        </div>
        <button
          className={`btn btn--ghost btn--sm ${styles.export} ${styles.pageBarCta}`}
          title="Exportar CSV"
          onClick={handleExport}
        >
          <span className={styles.exportIcon}>↓</span> Exportar
        </button>
      </div>

      {/* Window selector */}
      <div className={styles.window}>
        <span className={`label ${styles.windowLabel}`}>Ventana</span>
        <div className={styles.windowPills}>
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              className={`${styles.windowPill} ${w.key === windowKey ? styles.windowPillActive : ''}`}
              onClick={() => setWindowKey(w.key)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className={styles.windowSep}>·</span>
        <span className={`prose ${styles.windowHint}`}>
          {win.key === 'all'
            ? 'desde el primer trade registrado'
            : `desde hace ${win.days} día${win.days === 1 ? '' : 's'} hasta ahora`}
        </span>
      </div>

      {/* Hero: equity curve + metric cells */}
      <div className={styles.hero}>
        <div className={styles.heroCurve}>
          <div className={styles.heroCurveHead}>
            <div>
              <div className={`label ${styles.heroCurveLbl}`}>P&amp;L acumulado</div>
              <div className={`${styles.heroCurveVal} num ${agg.pnlTotal >= 0 ? styles.heroCurveValBull : styles.heroCurveValBear}`}>
                {agg.pnlTotal >= 0 ? '+' : ''}${agg.pnlTotal.toFixed(2)}
              </div>
              <div className={`prose ${styles.heroCurveSub}`}>
                {rows.length === 0 ? 'sin operaciones' : `${win.label} · ${rows.length} operación${rows.length === 1 ? '' : 'es'}`}
              </div>
            </div>
            <ResultStrip rows={rows} />
          </div>
          <div className={styles.curve}>
            <EquityCurve rows={rows} />
          </div>
        </div>

        <div className={styles.heroMetrics}>
          <MC
            label="Win rate"
            value={agg.wr === null ? '—' : `${agg.wr.toFixed(0)}%`}
            tone={agg.wr === null ? 'dim' : agg.wr >= 60 ? 'bull' : agg.wr >= 40 ? 'warn' : 'bear'}
            sub={agg.wr === null ? 'sin operaciones' : `${agg.wins} wins · ${agg.losses} losses`}
          />
          <MC
            label="Profit factor"
            value={agg.profitFactor === Infinity ? '∞' : `${agg.profitFactor.toFixed(2)}x`}
            tone={agg.profitFactor >= 2 ? 'bull' : agg.profitFactor >= 1.3 ? 'warn' : 'bear'}
            sub={`+$${agg.grossWin.toFixed(0)} / -$${agg.grossLoss.toFixed(0)}`}
          />
          <MC
            label="Hold promedio"
            value={`${agg.avgHold.toFixed(1)}h`}
            tone="neutral"
            sub={`win ${agg.avgWin.toFixed(2)}% · loss ${agg.avgLoss.toFixed(2)}%`}
          />
          <MC
            label="Pares operados"
            value={pairs.length.toString()}
            tone="neutral"
            sub={pairs[0] ? `${pairs[0].pair} líder en volumen` : '—'}
          />
        </div>
      </div>

      {/* Agent brief */}
      <div className={styles.brief}>
        <div className={styles.briefAvatar}>
          <span className={styles.briefGlyph}>◆</span>
        </div>
        <div className={styles.briefBody}>
          <div className={styles.briefTagRow}>
            <span className={styles.briefTag}>lectura del periodo</span>
            <span className={`${styles.briefLatency} prose`}>síncrono · local</span>
          </div>
          <div className={styles.briefHeadline}>{brief.headline}</div>
          {brief.lines.map((l, i) => (
            <p key={i} className={`${styles.briefLine} prose`}>{l}</p>
          ))}
          {rows.length > 0 && (
            <button className={styles.briefCta} onClick={askAboutPeriod}>
              Conversar sobre el periodo <span className={styles.briefCtaArrow}>→</span>
            </button>
          )}
        </div>
      </div>

      {/* Mode toggle */}
      <div className={styles.mode}>
        <button
          className={`${styles.modeTab} ${mode === 'por-par' ? styles.modeTabActive : ''}`}
          onClick={() => setMode('por-par')}
        >
          <span className={styles.modeTabGlyph}>▦</span> Por par
          <span className={styles.modeTabCount}>{pairs.length}</span>
        </button>
        <button
          className={`${styles.modeTab} ${mode === 'cronologico' ? styles.modeTabActive : ''}`}
          onClick={() => setMode('cronologico')}
        >
          <span className={styles.modeTabGlyph}>≡</span> Cronológico
          <span className={styles.modeTabCount}>{rows.length}</span>
        </button>
        <span className={`prose ${styles.modeHint}`}>
          {mode === 'por-par'
            ? 'agrupado por impacto · expande una tarjeta para ver los trades'
            : 'todas las operaciones en orden temporal · click en un par para abrirlo'}
        </span>
      </div>

      {/* Body */}
      {rows.length === 0
        ? <EmptyHist windowLabel={win.label} onChangeWindow={setWindowKey} />
        : mode === 'por-par'
          ? <PairsList pairs={pairs} totalPnL={agg.pnlTotal} mobile={mobile} onOpenSymbol={onOpenSymbol} onAskAgent={onAskAgent} />
          : <Chronological rows={rows} mobile={mobile} onOpenSymbol={onOpenSymbol} />
      }
    </main>
  );
}

// ────────────────────────────────────────────────────────────
// Equity curve (SVG)
// ────────────────────────────────────────────────────────────

interface EquityCurveProps {
  rows:    ClosedTrade[];
  width?:  number;
  height?: number;
}

function EquityCurve({ rows, width = 720, height = 110 }: EquityCurveProps) {
  if (rows.length === 0) return null;

  const sorted = [...rows].sort((a, b) => b.daysAgo - a.daysAgo); // oldest → newest
  let acc = 0;
  const points = [{ v: 0 }, ...sorted.map((r) => ({ v: (acc += r.pnlAbs) }))];
  const min   = Math.min(...points.map((p) => p.v));
  const max   = Math.max(...points.map((p) => p.v));
  const range = Math.max(max - min, 1);
  const padY  = 8;
  const innerH = height - padY * 2;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;

  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = padY + (1 - (p.v - min) / range) * innerH;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const zeroY = min <= 0 && max >= 0 ? padY + (1 - (0 - min) / range) * innerH : null;
  const lastY = padY + (1 - (points[points.length - 1].v - min) / range) * innerH;
  const stroke = acc >= 0 ? 'var(--bull)' : 'var(--bear)';

  return (
    <svg className={styles.curveSvg} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="hv-curve-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {zeroY !== null && (
        <line x1="0" x2={width} y1={zeroY} y2={zeroY} stroke="var(--nbc-border-dim)" strokeDasharray="2 3" />
      )}
      <path d={`${path} L ${width} ${height} L 0 ${height} Z`} fill="url(#hv-curve-grad)" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.2" />
      <circle cx={width} cy={lastY} r="2.4" fill={stroke} />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────
// Result strip (win/loss visual ledger)
// ────────────────────────────────────────────────────────────

function ResultStrip({ rows, compact = false }: { rows: ClosedTrade[]; compact?: boolean }) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.daysAgo - a.daysAgo);
  return (
    <div className={`${styles.strip} ${compact ? styles.stripCompact : ''}`}>
      {sorted.map((r) => {
        const sqClass = stripSqClass(r);
        return (
          <span
            key={r.id}
            className={`${styles.stripSq} ${sqClass}`}
            title={`${r.pair} · ${r.reason} · ${r.pnlPct >= 0 ? '+' : ''}${r.pnlPct.toFixed(2)}% · hace ${r.daysAgo}d`}
          />
        );
      })}
    </div>
  );
}

function stripSqClass(r: ClosedTrade): string {
  const bull = r.pnlAbs >= 0;
  if (r.reason === 'MANUAL') return bull ? styles.stripSqBullMan : styles.stripSqBearMan;
  if (r.reason === 'SL_HIT') return bull ? styles.stripSqBullSl  : styles.stripSqBearSl;
  // TP_HIT
  return bull ? styles.stripSqBullTp : styles.stripSqBearTp;
}

// ────────────────────────────────────────────────────────────
// Metric cell
// ────────────────────────────────────────────────────────────

function MC({ label, value, tone, sub }: { label: string; value: string; tone: Tone; sub?: string }) {
  const toneClass =
    tone === 'bull'    ? styles.mcValBull    :
    tone === 'bear'    ? styles.mcValBear    :
    tone === 'warn'    ? styles.mcValWarn    :
    tone === 'neutral' ? styles.mcValNeutral :
                         styles.mcValDim;
  return (
    <div className={styles.mc}>
      <div className={`${styles.mcLabel} label`}>{label}</div>
      <div className={`${styles.mcVal} ${toneClass} num`}>{value}</div>
      {sub && <div className={`${styles.mcSub} prose`}>{sub}</div>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Pairs list (collapsible cards)
// ────────────────────────────────────────────────────────────

interface PairsListProps {
  pairs:        PairGroup[];
  totalPnL:     number;
  mobile?:      boolean;
  onOpenSymbol: (pair: string) => void;
  onAskAgent:   (payload: AgentFreeformPrompt) => void;
}

function PairsList({ pairs, totalPnL, mobile, onOpenSymbol, onAskAgent }: PairsListProps) {
  // First two pairs (highest impact) expanded by default so the layout
  // communicates the pattern even on first load.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(pairs.slice(0, 2).map((p) => p.pair)));

  const toggle = useCallback((pair: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pair)) next.delete(pair); else next.add(pair);
      return next;
    });
  }, []);

  return (
    <section className={styles.pairs}>
      {pairs.map((p) => (
        <PairCard
          key={p.pair}
          group={p}
          expanded={expanded.has(p.pair)}
          onToggle={() => toggle(p.pair)}
          totalPnL={totalPnL}
          mobile={mobile}
          onOpenSymbol={onOpenSymbol}
          onAskAgent={onAskAgent}
        />
      ))}
    </section>
  );
}

interface PairCardProps {
  group:        PairGroup;
  expanded:     boolean;
  onToggle:     () => void;
  totalPnL:     number;
  mobile?:      boolean;
  onOpenSymbol: (pair: string) => void;
  onAskAgent:   (payload: AgentFreeformPrompt) => void;
}

function PairCard({ group, expanded, onToggle, totalPnL, mobile, onOpenSymbol, onAskAgent }: PairCardProps) {
  const { pair, trades, agg } = group;
  const tone     = agg.pnlTotal >= 0 ? 'bull' : 'bear';
  const verdict  = useMemo(() => pairVerdict(group), [group]);
  const sharePct = totalPnL === 0 ? 0 : (agg.pnlTotal / totalPnL) * 100;
  const wr       = agg.wr ?? 0;

  const askVerdict = useCallback(() => {
    onAskAgent({
      __freeform:
        `Hablemos de ${pair} en este periodo. ${agg.n} operaciones, ${agg.wins}W/${agg.losses}L, ` +
        `P&L ${agg.pnlTotal >= 0 ? '+' : ''}$${agg.pnlTotal.toFixed(2)}, WR ${wr.toFixed(0)}%, ` +
        `profit factor ${agg.profitFactor === Infinity ? '∞' : agg.profitFactor.toFixed(2) + 'x'}. ` +
        `Tu lectura inicial: "${verdict.text}". ${verdict.action}.`,
    });
  }, [pair, agg, wr, verdict, onAskAgent]);

  const wrTone = wr >= 60 ? styles.pcMetricValBull : wr >= 40 ? styles.pcMetricValWarn : styles.pcMetricValBear;
  const pnlClass = tone === 'bull' ? styles.pcPnlBull : styles.pcPnlBear;

  return (
    <article
      className={`${styles.pc} ${tone === 'bull' ? styles.pcBull : styles.pcBear} ${expanded ? styles.pcOpen : ''}`}
    >
      <button className={styles.pcHead} onClick={onToggle} aria-expanded={expanded}>
        <span className={`${styles.pcChev} ${expanded ? styles.pcChevOpen : ''}`}>▸</span>
        <span className={styles.pcPair}>
          <span className={styles.pcPairBase}>{pair}</span>
          <span className={styles.pcPairQuote}>/USDT</span>
        </span>

        <span className={styles.pcCount}>{agg.n} <span className="prose">ops</span></span>

        <span className={styles.pcWr}>
          <span className={`label ${styles.pcMetricLbl}`}>WR</span>
          <span className={`num ${styles.pcMetricVal} ${wrTone}`}>
            {wr.toFixed(0)}%
          </span>
        </span>

        <span className={styles.pcPf}>
          <span className={`label ${styles.pcMetricLbl}`}>PF</span>
          <span className={`num ${styles.pcMetricVal}`}>
            {agg.profitFactor === Infinity ? '∞' : `${agg.profitFactor.toFixed(2)}x`}
          </span>
        </span>

        <span className={styles.pcStrip}>
          <ResultStrip rows={trades} compact />
        </span>

        <span className={`${styles.pcPnl} ${pnlClass}`}>
          <span className={`num ${styles.pcPnlAbs}`}>
            {agg.pnlTotal >= 0 ? '+' : ''}${agg.pnlTotal.toFixed(2)}
          </span>
          <span className={`prose ${styles.pcPnlShare}`}>
            {sharePct >= 0 ? '+' : ''}{sharePct.toFixed(0)}% del total
          </span>
        </span>
      </button>

      {expanded && (
        <div className={styles.pcBody}>
          {/* Verdict del copiloto */}
          <div
            className={`${styles.pcVerdict} ${verdictToneClass(verdict.tone)}`}
            onClick={askVerdict}
          >
            <div className={`${styles.pcVerdictAvatar} ${verdictAvatarToneClass(verdict.tone)}`}>
              <span>{verdict.glyph}</span>
            </div>
            <div className={styles.pcVerdictBody}>
              <span className={styles.pcVerdictTag}>copiloto</span>
              <span className={`${styles.pcVerdictText} prose`}>{verdict.text}</span>
            </div>
            <button
              className={`${styles.pcVerdictCta} ${verdictCtaToneClass(verdict.tone)}`}
              onClick={(e) => { e.stopPropagation(); askVerdict(); }}
            >
              {verdict.action} →
            </button>
          </div>

          {/* Mini stats grid */}
          <div className={styles.pcStats}>
            <Stat label="P&L bruto +"   value={`+$${agg.grossWin.toFixed(2)}`}                                 tone="bull"    />
            <Stat label="P&L bruto –"   value={`-$${agg.grossLoss.toFixed(2)}`}                                tone="bear"    />
            <Stat label="Win promedio"  value={`${agg.avgWin >= 0 ? '+' : ''}${agg.avgWin.toFixed(2)}%`}       tone="bull"    />
            <Stat label="Loss promedio" value={`${agg.avgLoss.toFixed(2)}%`}                                   tone="bear"    />
            <Stat label="Hold promedio" value={`${agg.avgHold.toFixed(1)}h`}                                   tone="neutral" />
            <Stat
              label="Salidas"
              value={
                <span className={styles.pcExits}>
                  <span className={`${styles.pcExit} ${styles.pcExitBull}`}>{trades.filter((t) => t.reason === 'TP_HIT').length} TP</span>
                  <span className={`${styles.pcExit} ${styles.pcExitBear}`}>{trades.filter((t) => t.reason === 'SL_HIT').length} SL</span>
                  <span className={`${styles.pcExit} ${styles.pcExitWarn}`}>{trades.filter((t) => t.reason === 'MANUAL').length} MAN</span>
                </span>
              }
              tone="neutral"
            />
          </div>

          {/* Trades */}
          {mobile
            ? <div className={styles.pcCards}>{trades.map((t) => <MobileTradeCard key={t.id} t={t} />)}</div>
            : <TradesTable trades={trades} />
          }

          <div className={styles.pcFooter}>
            <button className="btn btn--ghost btn--sm" onClick={() => onOpenSymbol(pair)}>
              Ver {pair} en Mercado →
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function verdictToneClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.pcVerdictBull;
    case 'bear':    return styles.pcVerdictBear;
    case 'warn':    return styles.pcVerdictWarn;
    case 'neutral': return styles.pcVerdictNeutral;
    default:        return styles.pcVerdictDim;
  }
}
function verdictAvatarToneClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.pcVerdictAvatarBull;
    case 'bear':    return styles.pcVerdictAvatarBear;
    case 'warn':    return styles.pcVerdictAvatarWarn;
    case 'neutral': return styles.pcVerdictAvatarNeutral;
    default:        return styles.pcVerdictAvatarDim;
  }
}
function verdictCtaToneClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.pcVerdictCtaBull;
    case 'bear':    return styles.pcVerdictCtaBear;
    case 'warn':    return styles.pcVerdictCtaWarn;
    case 'neutral': return styles.pcVerdictCtaNeutral;
    default:        return styles.pcVerdictCtaDim;
  }
}

function statValToneClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.statValBull;
    case 'bear':    return styles.statValBear;
    case 'warn':    return styles.statValWarn;
    default:        return styles.statValNeutral;
  }
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone: Tone }) {
  return (
    <div className={styles.stat}>
      <div className={`label ${styles.statLbl}`}>{label}</div>
      <div className={`num ${styles.statVal} ${statValToneClass(tone)}`}>{value}</div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Trades table (desktop, inside expanded pair card)
// ────────────────────────────────────────────────────────────

function reasonChipFor(r: ClosedTrade['reason']): { toneClass: string; label: string } {
  if (r === 'TP_HIT') return { toneClass: styles.ttReasonBull, label: 'TP'  };
  if (r === 'SL_HIT') return { toneClass: styles.ttReasonBear, label: 'SL'  };
  return                       { toneClass: styles.ttReasonWarn, label: 'MAN' };
}

function TradesTable({ trades }: { trades: ClosedTrade[] }) {
  return (
    <div className={styles.tt}>
      <div className={`${styles.ttHead} label`}>
        <div>Hace</div>
        <div>Dir</div>
        <div>Entrada</div>
        <div>Salida</div>
        <div>Cant.</div>
        <div>Hold</div>
        <div>Tipo</div>
        <div>P&amp;L</div>
        <div>%</div>
      </div>
      {trades.map((t) => {
        const tone = t.pnlAbs >= 0 ? styles.ttPnlBull : styles.ttPnlBear;
        const reason = reasonChipFor(t.reason);
        const sideClass = t.side === 'S' ? `${styles.ttSide} ${styles.ttSideShort}` : styles.ttSide;
        const sideGlyph = t.side === 'S' ? '▼ S' : '▲ L';
        return (
          <div key={t.id} className={styles.ttRow}>
            <div className={`prose ${styles.ttWhen}`}>hace {t.daysAgo}d</div>
            <div><span className={sideClass}>{sideGlyph}</span></div>
            <div className="num">${formatPrice(t.entry)}</div>
            <div className="num">${formatPrice(t.exit)}</div>
            <div className={`num ${styles.ttQty}`}>{t.qty}</div>
            <div className="num">{t.heldHours.toFixed(1)}h</div>
            <div><span className={`${styles.ttReason} ${reason.toneClass}`}>{reason.label}</span></div>
            <div className={`num ${tone}`}>{t.pnlAbs >= 0 ? '+' : ''}${t.pnlAbs.toFixed(2)}</div>
            <div className={`num ${tone}`}>{t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%</div>
          </div>
        );
      })}
    </div>
  );
}

function MobileTradeCard({ t }: { t: ClosedTrade }) {
  const bull = t.pnlAbs >= 0;
  const reason = reasonChipFor(t.reason);
  const sideClass = t.side === 'S' ? `${styles.ttSide} ${styles.ttSideShort}` : styles.ttSide;
  const sideGlyph = t.side === 'S' ? '▼ S' : '▲ L';
  return (
    <div className={`${styles.mtc} ${bull ? styles.mtcBull : styles.mtcBear}`}>
      <div className={styles.mtcR1}>
        <span className={sideClass}>{sideGlyph}</span>
        <span className={`${styles.ttReason} ${reason.toneClass}`}>{reason.label}</span>
        <span className={`prose ${styles.mtcWhen}`}>hace {t.daysAgo}d</span>
        <span className={`num ${styles.mtcPnl} ${bull ? styles.mtcPnlBull : styles.mtcPnlBear}`}>
          {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
        </span>
      </div>
      <div className={`${styles.mtcR2} prose`}>
        <span className="num">${formatPrice(t.entry)}</span> → <span className="num">${formatPrice(t.exit)}</span>
        <span> · {t.heldHours.toFixed(1)}h · </span>
        <span className={`num ${bull ? styles.mtcPnlAbsBull : styles.mtcPnlAbsBear}`}>
          {t.pnlAbs >= 0 ? '+' : ''}${t.pnlAbs.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Chronological view
// ────────────────────────────────────────────────────────────

function Chronological({
  rows, mobile, onOpenSymbol,
}: {
  rows: ClosedTrade[]; mobile?: boolean; onOpenSymbol: (pair: string) => void;
}) {
  const sorted = [...rows].sort((a, b) => a.daysAgo - b.daysAgo); // newest first

  if (mobile) {
    return (
      <section className={`${styles.chrono} ${styles.chronoMobile}`}>
        {sorted.map((t) => {
          const bull = t.pnlAbs >= 0;
          const reason = reasonChipFor(t.reason);
          const sideClass = t.side === 'S' ? `${styles.ttSide} ${styles.ttSideShort}` : styles.ttSide;
          const sideGlyph = t.side === 'S' ? '▼ S' : '▲ L';
          return (
            <div
              key={t.id}
              className={`${styles.mtc} ${bull ? styles.mtcBull : styles.mtcBear} ${styles.mtcClickable}`}
              onClick={() => onOpenSymbol(t.pair)}
            >
              <div className={styles.mtcR1}>
                <span className={sideClass}>{sideGlyph}</span>
                <span className={styles.mtcPair}>{t.pair}</span>
                <span className={`${styles.ttReason} ${reason.toneClass}`}>{reason.label}</span>
                <span className={`num ${styles.mtcPnl} ${bull ? styles.mtcPnlBull : styles.mtcPnlBear}`}>
                  {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                </span>
              </div>
              <div className={`${styles.mtcR2} prose`}>
                <span className="num">${formatPrice(t.entry)}</span> → <span className="num">${formatPrice(t.exit)}</span>
                <span> · {t.heldHours.toFixed(1)}h · hace {t.daysAgo}d</span>
              </div>
            </div>
          );
        })}
      </section>
    );
  }

  return (
    <section className={styles.chrono}>
      <div className={`${styles.chronoHead} label`}>
        <div>#</div>
        <div>Hace</div>
        <div>Par</div>
        <div>Dir</div>
        <div>Entrada</div>
        <div>Salida</div>
        <div>Cant.</div>
        <div>Hold</div>
        <div>Tipo</div>
        <div>P&amp;L</div>
        <div>%</div>
        <div></div>
      </div>
      {sorted.map((t, i) => {
        const tone = t.pnlAbs >= 0 ? styles.chronoPnlBull : styles.chronoPnlBear;
        const reason = reasonChipFor(t.reason);
        const sideClass = t.side === 'S' ? `${styles.ttSide} ${styles.ttSideShort}` : styles.ttSide;
        const sideGlyph = t.side === 'S' ? '▼ S' : '▲ L';
        return (
          <div key={t.id} className={styles.chronoRow} onClick={() => onOpenSymbol(t.pair)}>
            <div className={`${styles.chronoIdx} num`}>{String(i + 1).padStart(2, '0')}</div>
            <div className={`prose ${styles.chronoWhen}`}>{t.daysAgo}d</div>
            <div className={styles.chronoPair}>{t.pair}</div>
            <div><span className={sideClass}>{sideGlyph}</span></div>
            <div className="num">${formatPrice(t.entry)}</div>
            <div className="num">${formatPrice(t.exit)}</div>
            <div className="num">{t.qty}</div>
            <div className="num">{t.heldHours.toFixed(1)}h</div>
            <div><span className={`${styles.ttReason} ${reason.toneClass}`}>{reason.label}</span></div>
            <div className={`num ${tone}`}>{t.pnlAbs >= 0 ? '+' : ''}${t.pnlAbs.toFixed(2)}</div>
            <div className={`num ${tone}`}>{t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%</div>
            <div><span className={styles.chronoArrow}>→</span></div>
          </div>
        );
      })}
    </section>
  );
}

// ────────────────────────────────────────────────────────────
// Empty state
// ────────────────────────────────────────────────────────────

function EmptyHist({ windowLabel, onChangeWindow }: { windowLabel: string; onChangeWindow: (k: WindowKey) => void }) {
  return (
    <section className={styles.empty}>
      <div className={styles.emptyMark}>∅</div>
      <div className={styles.emptyTitle}>Sin operaciones en {windowLabel.toLowerCase()}</div>
      <div className={`${styles.emptyBody} prose`}>
        El periodo elegido no tiene cierres. Probá una ventana más amplia.
      </div>
      <div className={styles.emptyCta}>
        <button className="btn btn--ghost btn--sm" onClick={() => onChangeWindow('90d')}>Ver 90 días</button>
        <button className="btn btn--ghost btn--sm" onClick={() => onChangeWindow('all')}>Ver todo</button>
      </div>
    </section>
  );
}

export default HistorialView;
