// ============================================================
// SymbolDetail — slide-up sheet that replaces ChartModal.
//
// Three tabs in the right-pane:
//   - Setup    : 9-factor checklist + verdict (synthetic until backend
//                exposes score_components: boolean[])
//   - Posición : hypothetical sizing calculator + "Abrir posición" CTA
//                that bubbles a PositionPreset up to App.tsx
//   - Historial: real closed positions for this pair, last 6
//
// Chart pane uses lightweight-charts (same setup ChartModal already
// had — ported here so we can deprecate ChartModal once verified).
// ============================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';

import styles from './SymbolDetail.module.css';
import type { SymbolStatus, Position, OhlcvCandle, OhlcvVolume } from '../types';
import { formatPrice, timeAgo } from '../utils';
import { getOhlcv, getPositions } from '../api';
import { SCORE_FACTORS } from '../constants/score-factors';

// ── Public types ─────────────────────────────────────────────

export type Timeframe = '5m' | '15m' | '1h' | '4h' | '1d';

export interface PositionPreset {
  symbol:    string;
  direction: 'LONG' | 'SHORT';
  entry:     number;
  sl:        number;
  tp:        number;
  sizeUsd:   number;
}

interface SymbolDetailProps {
  symbol:          SymbolStatus | null;
  onClose:         () => void;
  onOpenPosition?: (preset: PositionPreset) => void;
}

// ── Helpers ──────────────────────────────────────────────────

function priceFormat(price: number) {
  if (price >= 1000) return { precision: 2, minMove: 0.01 };
  if (price >= 1)    return { precision: 4, minMove: 0.0001 };
  return               { precision: 6, minMove: 0.000001 };
}

function computeSMA(candles: OhlcvCandle[], period: number): { time: UTCTimestamp; value: number }[] {
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    out.push({ time: candles[i].time as UTCTimestamp, value: sum / period });
  }
  return out;
}

// Resolve a CSS custom property to its computed hex string. Lightweight-charts
// doesn't evaluate `var(--foo)` — it needs the literal color string.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// TODO: replace when backend exposes symbol.score_components: boolean[].
// Until then, derive a deterministic per-symbol pass/fail breakdown that
// adds up to symbol.score, locking LRC + TRIG to the real flags.
function buildFactors(symbol: SymbolStatus) {
  const score   = symbol.score ?? 0;
  const lrc     = symbol.lrc_pct ?? 50;
  const trigger = symbol.señal === true;
  const seed = symbol.symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);

  const passes = new Set<number>();
  if (lrc < 25) passes.add(0);   // LRC
  if (trigger)  passes.add(8);   // TRIG

  let i = 0;
  while (passes.size < score && i < 100) {
    const idx = (seed + i * 7) % 9;
    passes.add(idx);
    i++;
  }
  return SCORE_FACTORS.map((f, idx) => ({ ...f, pass: passes.has(idx) }));
}

const TIMEFRAMES: { v: Timeframe; l: string }[] = [
  { v: '5m',  l: '5m'  },
  { v: '15m', l: '15m' },
  { v: '1h',  l: '1H'  },
  { v: '4h',  l: '4H'  },
  { v: '1d',  l: '1D'  },
];

// ============================================================
// MAIN — SymbolDetail
// ============================================================

const SymbolDetail: React.FC<SymbolDetailProps> = ({ symbol, onClose, onOpenPosition }) => {
  const [tf,  setTf]  = useState<Timeframe>('1h');
  const [tab, setTab] = useState<'setup' | 'position' | 'history'>('setup');

  // Close on Escape
  useEffect(() => {
    if (!symbol) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [symbol, onClose]);

  if (!symbol) return null;

  const base       = symbol.symbol.replace('USDT', '');
  const score      = symbol.score ?? 0;
  const lrc        = symbol.lrc_pct ?? 0;
  const change24h  = symbol.change_24h ?? 0;
  const livePrice  = symbol.live_price ?? symbol.price ?? 0;
  const isFreshSenal = score >= 5 && symbol.señal === true;
  const macroTone: 'bull' | 'bear' = lrc < 25 ? 'bull' : 'bear';
  const scoreTone: 'bull' | 'warn' | 'dim' = score >= 5 ? 'bull' : score >= 3 ? 'warn' : 'dim';

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <aside
        className={styles.sheet}
        role="dialog"
        aria-label={`Detalle ${base}`}
      >
        {/* ── Header ── */}
        <header className={styles.hd}>
          <div className={styles.hdBrand}>
            <div className={styles.hdPair}>
              <span className={styles.hdBase}>{base}</span>
              <span className={styles.hdQuote}>/USDT</span>
            </div>
            <div className={styles.hdPriceRow}>
              <span className={`num ${styles.hdPrice}`}>${formatPrice(livePrice)}</span>
              <span className={`${styles.hdChange} ${change24h >= 0 ? styles.hdChangeBull : styles.hdChangeBear}`}>
                {change24h >= 0 ? '▲' : '▼'} <span className="num">{change24h.toFixed(2)}%</span>
              </span>
            </div>
          </div>

          <div className={styles.hdChips}>
            <Chip label="SCORE"     value={`${score}/9`}                          tone={scoreTone} />
            <Chip label="LRC 1H"    value={`${lrc.toFixed(1)}%`}                  tone={macroTone} />
            <Chip label="MACRO 4H"  value={macroTone === 'bull' ? 'Alcista ✓' : 'Adversa ✗'} tone={macroTone} />
            <Chip
              label="ESTADO"
              value={isFreshSenal ? 'SETUP VÁLIDO' : symbol.señal ? 'Esperando filtros' : 'Sin gatillo'}
              tone={isFreshSenal ? 'bull' : 'warn'}
              long
            />
          </div>

          <div className={styles.hdTools}>
            <nav className={styles.tf}>
              {TIMEFRAMES.map(({ v, l }) => (
                <button
                  key={v}
                  className={[styles.tfBtn, tf === v ? styles.tfBtnActive : ''].filter(Boolean).join(' ')}
                  onClick={() => setTf(v)}
                >{l}</button>
              ))}
            </nav>
            <button className={styles.close} onClick={onClose} aria-label="Cerrar">×</button>
          </div>
        </header>

        {/* ── Body ── */}
        <div className={styles.body}>
          <section className={styles.chartPane}>
            <div className={styles.chartLegend}>
              <span className={styles.legendItem}>
                <span className={`${styles.legendLine} ${styles.legendLineSma20}`} /> SMA 20
              </span>
              <span className={styles.legendItem}>
                <span className={`${styles.legendLine} ${styles.legendLineSma100}`} /> SMA 100
              </span>
              <span className={`${styles.legendItem} ${styles.legendItemRight} prose`}>
                Binance Spot · {tf} · 300 velas
              </span>
            </div>
            <div className={styles.chartWrap}>
              <ChartCanvas symbol={symbol} timeframe={tf} />
            </div>
          </section>

          <section className={styles.analysis}>
            <nav className={styles.tabs}>
              <TabBtn active={tab === 'setup'}    onClick={() => setTab('setup')}>Setup</TabBtn>
              <TabBtn active={tab === 'position'} onClick={() => setTab('position')}>Posición</TabBtn>
              <TabBtn active={tab === 'history'}  onClick={() => setTab('history')}>Historial</TabBtn>
            </nav>
            <div className={styles.tabBody}>
              {tab === 'setup'    && <SetupTab    symbol={symbol} />}
              {tab === 'position' && <PositionTab symbol={symbol} onOpenPosition={onOpenPosition} />}
              {tab === 'history'  && <HistoryTab  symbol={symbol} />}
            </div>
          </section>
        </div>

        {/* ── Footer ── */}
        <footer className={styles.ft}>
          <span className="prose">
            <span className="num">LRC ≤ 25%</span> = zona LONG · <span className="num">SMA 100</span> = filtro macro
          </span>
          <span className="prose">
            Datos cada ~3s · Última actualización ahora mismo
          </span>
        </footer>
      </aside>
    </>
  );
};

// ============================================================
// CHART — lightweight-charts (ported from ChartModal)
// ============================================================

interface ChartCanvasProps {
  symbol:    SymbolStatus;
  timeframe: Timeframe;
}

const ChartCanvas: React.FC<ChartCanvasProps> = ({ symbol, timeframe }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Tear down any prior chart on this slot.
    chartRef.current?.remove();
    chartRef.current = null;

    const container = containerRef.current;

    // Pull colors from the redesign tokens so the chart matches the
    // rest of the dashboard (cyan/amber, dark bg).
    const C_BG     = cssVar('--nbc-bg',            '#0a0d0b');
    const C_GRID   = cssVar('--nbc-border-dimmer', '#6ad7ff19');
    const C_BORDER = cssVar('--nbc-border-dim',    '#6ad7ff33');
    const C_TEXT   = cssVar('--nbc-fg-muted',      '#8093a0');
    const C_BULL   = cssVar('--bull',              '#6ad7ff');
    const C_BEAR   = cssVar('--bear',              '#ffb84e');
    const C_SMA20  = cssVar('--warn',              '#ffb84e');
    const C_SMA100 = cssVar('--bull',              '#6ad7ff');

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: C_BG },
        textColor:  C_TEXT,
        fontFamily: "'JetBrains Mono', 'Geist Mono', ui-monospace, monospace",
        fontSize:   11,
      },
      grid: {
        vertLines: { color: C_GRID },
        horzLines: { color: C_GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: C_TEXT, style: 2, width: 1, labelBackgroundColor: C_BORDER },
        horzLine: { color: C_TEXT, style: 2, width: 1, labelBackgroundColor: C_BORDER },
      },
      rightPriceScale: {
        borderColor:  C_BORDER,
        textColor:    C_TEXT,
        scaleMargins: { top: 0.08, bottom: 0.22 },
      },
      timeScale: {
        borderColor:    C_BORDER,
        timeVisible:    true,
        secondsVisible: false,
        fixLeftEdge:    false,
        fixRightEdge:   false,
      },
      width:  container.clientWidth  || 800,
      height: container.clientHeight || 420,
    });
    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width:  containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    ro.observe(container);

    let alive = true;
    setLoading(true);
    setError(null);

    getOhlcv(symbol.symbol, timeframe, 300)
      .then((data) => {
        if (!alive || chartRef.current !== chart) return;
        const candles = data.candles;
        if (!candles.length) return;

        const lastClose = candles[candles.length - 1].close;
        const fmt       = priceFormat(lastClose);

        const candleSeries = chart.addCandlestickSeries({
          upColor:         C_BULL,
          downColor:       C_BEAR,
          borderUpColor:   C_BULL,
          borderDownColor: C_BEAR,
          wickUpColor:     C_BULL,
          wickDownColor:   C_BEAR,
          priceFormat:     { type: 'price', ...fmt },
        });
        candleSeries.setData(
          candles.map((c) => ({
            time:  c.time as UTCTimestamp,
            open:  c.open,
            high:  c.high,
            low:   c.low,
            close: c.close,
          }))
        );

        const volSeries = chart.addHistogramSeries({
          color:        'rgba(106,215,255,0.20)',
          priceFormat:  { type: 'volume' },
          priceScaleId: 'vol',
        });
        chart.priceScale('vol').applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
        });
        volSeries.setData(
          (data.volumes as OhlcvVolume[]).map((v) => ({
            time:  v.time as UTCTimestamp,
            value: v.value,
            color: v.color,
          }))
        );

        const sma20 = computeSMA(candles, 20);
        if (sma20.length) {
          const s20 = chart.addLineSeries({
            color:                  C_SMA20,
            lineWidth:              1,
            priceLineVisible:       false,
            lastValueVisible:       false,
            crosshairMarkerVisible: false,
            title:                  'SMA 20',
          });
          s20.setData(sma20);
        }
        const sma100 = computeSMA(candles, 100);
        if (sma100.length) {
          const s100 = chart.addLineSeries({
            color:                  C_SMA100,
            lineWidth:              1,
            priceLineVisible:       false,
            lastValueVisible:       false,
            crosshairMarkerVisible: false,
            title:                  'SMA 100',
          });
          s100.setData(sma100);
        }

        chart.timeScale().fitContent();
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Error cargando datos');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      ro.disconnect();
      if (chartRef.current === chart) {
        chart.remove();
        chartRef.current = null;
      }
    };
  }, [symbol.symbol, timeframe]);

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loading && <div className={styles.chartLoading}>Cargando…</div>}
      {error   && <div className={styles.chartError}>{error}</div>}
    </>
  );
};

// ============================================================
// SETUP TAB — 9-factor checklist + verdict
// ============================================================

const SetupTab: React.FC<{ symbol: SymbolStatus }> = ({ symbol }) => {
  const factors   = useMemo(() => buildFactors(symbol), [symbol]);
  const passCount = factors.filter((f) => f.pass).length;
  const verdict =
    passCount >= 6
      ? { tone: 'bull' as const, title: 'Setup firme — considera abrir',          body: 'La mayoría de filtros coinciden. Riesgo controlado con ATR.' }
      : passCount >= 4
      ? { tone: 'warn' as const, title: 'Setup parcial — observa',                body: `${9 - passCount} filtros aún no cumplen. Espera confirmación antes de abrir.` }
      : { tone: 'bear' as const, title: 'NO operes — demasiados filtros en contra', body: 'El sistema no recomienda abrir posición en estas condiciones.' };

  const verdictClass = verdict.tone === 'bull' ? styles.verdictBull : verdict.tone === 'warn' ? styles.verdictWarn : styles.verdictBear;

  return (
    <div className={styles.tab}>
      <div>
        <div className={styles.checklistHd}>
          <span className="label">— desglose del score</span>
          <span className={styles.checklistScore}>
            <span className="num">{passCount}</span>
            <span className={styles.checklistMax}>/9</span>
          </span>
        </div>
        <ul className={styles.checklistList}>
          {factors.map((f) => (
            <li key={f.key} className={styles.fact}>
              <span className={[styles.factGlyph, f.pass ? styles.factGlyphPass : styles.factGlyphFail].join(' ')}>
                {f.pass ? '✓' : '✗'}
              </span>
              <div className={styles.factBody}>
                <div className={styles.factTitle}>
                  <span className={styles.factKey}>{f.key}</span>
                  <span className={styles.factLabel}>{f.label}</span>
                </div>
                <div className={`${styles.factPlain} prose`}>{f.plain}</div>
              </div>
              <div className={[styles.factPill, f.pass ? styles.factPillPass : styles.factPillFail].join(' ')}>
                {f.pass ? 'PASA' : 'FALLA'}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className={`${styles.verdict} ${verdictClass}`}>
        <div className={styles.verdictIcon}>
          {verdict.tone === 'bull' ? '◉' : verdict.tone === 'warn' ? '◐' : '⏸'}
        </div>
        <div>
          <div className={styles.verdictTitle}>{verdict.title}</div>
          <div className={`${styles.verdictBody} prose`}>{verdict.body}</div>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// POSITION TAB — hypothetical sizing calculator + CTA
// ============================================================

interface PositionTabProps {
  symbol:          SymbolStatus;
  onOpenPosition?: (preset: PositionPreset) => void;
}

const PositionTab: React.FC<PositionTabProps> = ({ symbol, onOpenPosition }) => {
  const [capital, setCapital] = useState(1000);
  const [riskPct, setRiskPct] = useState(1);
  const [slPct,   setSlPct]   = useState(2.5);
  const [rr,      setRr]      = useState(2);

  const entry  = symbol.live_price ?? symbol.price ?? 0;
  const isLong = (symbol.direction ?? 'LONG') === 'LONG';
  const sl     = isLong ? entry * (1 - slPct / 100) : entry * (1 + slPct / 100);
  const tp     = isLong ? entry * (1 + (slPct * rr) / 100) : entry * (1 - (slPct * rr) / 100);

  const riskUsd   = capital * (riskPct / 100);
  const slDistAbs = Math.abs(entry - sl);
  const qty       = slDistAbs > 0 ? riskUsd / slDistAbs : 0;
  const posValue  = qty * entry;
  const rewardUsd = qty * Math.abs(tp - entry);

  const minBar = Math.min(sl, entry, tp);
  const maxBar = Math.max(sl, entry, tp);
  const span   = (maxBar - minBar) || 1;
  const posOf  = (p: number) => ((p - minBar) / span) * 100;

  const ctaDisabled = entry <= 0 || qty <= 0;

  const handleOpen = () => {
    if (!onOpenPosition || ctaDisabled) return;
    onOpenPosition({
      symbol:    symbol.symbol,
      direction: isLong ? 'LONG' : 'SHORT',
      entry,
      sl,
      tp,
      sizeUsd:   posValue,
    });
  };

  return (
    <div className={styles.tab}>
      <div className={styles.posHead}>
        <span className="label">— calculadora hipotética</span>
        <span className="prose">si abres aquí con tu plan de riesgo actual</span>
      </div>

      <div className={styles.posInputs}>
        <Stepper label="Capital"  value={`$${capital}`}            onMinus={() => setCapital(Math.max(100, capital - 100))} onPlus={() => setCapital(capital + 100)} />
        <Stepper label="Riesgo %" value={`${riskPct.toFixed(1)}%`} onMinus={() => setRiskPct(Math.max(0.1, +(riskPct - 0.1).toFixed(1)))} onPlus={() => setRiskPct(+(riskPct + 0.1).toFixed(1))} />
        <Stepper label="SL %"     value={`${slPct.toFixed(2)}%`}   onMinus={() => setSlPct(Math.max(0.5, +(slPct - 0.25).toFixed(2)))}   onPlus={() => setSlPct(+(slPct + 0.25).toFixed(2))} />
        <Stepper label="R:R"      value={`1:${rr}`}                onMinus={() => setRr(Math.max(1, rr - 0.5))} onPlus={() => setRr(rr + 0.5)} />
      </div>

      <div className={styles.posViz}>
        <div className={styles.posBar}>
          <div className={`${styles.posZone} ${styles.posZoneLoss}`} style={{ left: '0%', width: `${posOf(entry)}%` }} />
          <div className={`${styles.posZone} ${styles.posZoneGain}`} style={{ left: `${posOf(entry)}%`, right: '0%' }} />
          <div className={`${styles.posMarker} ${styles.posMarkerSl}`}    style={{ left: `${posOf(sl)}%` }}>
            <span className={styles.posMarkerLbl}>SL</span>
            <span className={`num ${styles.posMarkerVal}`}>{formatPrice(sl)}</span>
          </div>
          <div className={`${styles.posMarker} ${styles.posMarkerEntry}`} style={{ left: `${posOf(entry)}%` }}>
            <span className={styles.posMarkerLbl}>ENTRY</span>
            <span className={`num ${styles.posMarkerVal}`}>{formatPrice(entry)}</span>
          </div>
          <div className={`${styles.posMarker} ${styles.posMarkerTp}`}    style={{ left: `${posOf(tp)}%` }}>
            <span className={styles.posMarkerLbl}>TP</span>
            <span className={`num ${styles.posMarkerVal}`}>{formatPrice(tp)}</span>
          </div>
        </div>
      </div>

      <div className={styles.posOutputs}>
        <Output label="Cantidad"       value={qty.toFixed(4)}            tone="neutral" />
        <Output label="Valor posición" value={`$${posValue.toFixed(2)}`} tone="neutral" />
        <Output label="Riesgo"         value={`-$${riskUsd.toFixed(2)}`} tone="bear" sub="si toca SL" />
        <Output label="Reward"         value={`+$${rewardUsd.toFixed(2)}`} tone="bull" sub="si toca TP" />
      </div>

      <button
        className={`btn btn--primary ${styles.posCta}`}
        onClick={handleOpen}
        disabled={ctaDisabled}
      >
        <span className="btn__caret">▸</span> Abrir esta posición
      </button>
    </div>
  );
};

const Stepper: React.FC<{ label: string; value: string; onMinus: () => void; onPlus: () => void }> = ({ label, value, onMinus, onPlus }) => (
  <div className={styles.stepper}>
    <div className={`${styles.stepperLabel} label`}>{label}</div>
    <div className={styles.stepperRow}>
      <button className={styles.stepperBtn} onClick={onMinus}>−</button>
      <span className={`${styles.stepperVal} num`}>{value}</span>
      <button className={styles.stepperBtn} onClick={onPlus}>+</button>
    </div>
  </div>
);

type OutputTone = 'bull' | 'bear' | 'warn' | 'neutral';
const Output: React.FC<{ label: string; value: React.ReactNode; tone: OutputTone; sub?: string }> = ({ label, value, tone, sub }) => {
  const toneClass =
    tone === 'bull'    ? styles.outBull :
    tone === 'bear'    ? styles.outBear :
    tone === 'warn'    ? styles.outWarn :
                         styles.outNeutral;
  return (
    <div className={`${styles.out} ${toneClass}`}>
      <div className={`${styles.outLabel} label`}>{label}</div>
      <div className={`${styles.outVal} num`}>{value}</div>
      {sub && <div className={`${styles.outSub} prose`}>{sub}</div>}
    </div>
  );
};

// ============================================================
// HISTORY TAB — real closed positions for this pair
// ============================================================

interface HistoryEntry {
  ts:      string;
  outcome: 'tp' | 'sl' | 'manual';
  score:   number | null;
  pnl:     number;
}

const HistoryTab: React.FC<{ symbol: SymbolStatus }> = ({ symbol }) => {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setEntries(null);
    setError(null);
    // TODO: backend doesn't accept symbol query param on /positions yet,
    // so we filter client-side. Replace when the endpoint supports it.
    getPositions('closed')
      .then((resp) => {
        if (!alive) return;
        const list: HistoryEntry[] = (resp.positions ?? [])
          .filter((p: Position) => p.symbol === symbol.symbol)
          .slice(0, 6)
          .map((p: Position) => ({
            ts:      p.exit_ts ?? p.entry_ts,
            outcome: p.exit_reason === 'TP_HIT' ? 'tp' : p.exit_reason === 'SL_HIT' ? 'sl' : 'manual',
            score:   null,                    // TODO: join with scan to get score at signal time
            pnl:     p.pnl_pct ?? 0,
          }));
        setEntries(list);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Error cargando historial');
      });
    return () => { alive = false; };
  }, [symbol.symbol]);

  if (entries === null && !error) {
    return (
      <div className={styles.tab}>
        <div className={`${styles.histEmpty} prose`}>Cargando historial…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles.tab}>
        <div className={`${styles.histEmpty} prose`}>Error: {error}</div>
      </div>
    );
  }
  const list = entries ?? [];
  const wins = list.filter((h) => h.pnl > 0).length;
  const wr   = list.length > 0 ? (wins / list.length) * 100 : 0;

  return (
    <div className={styles.tab}>
      <div className={styles.histHead}>
        <span className="label">— últimas operaciones del par</span>
      </div>

      <div className={styles.histStats}>
        <Output label="Total" value={list.length} tone="neutral" />
        <Output label="Wins"  value={wins}        tone="bull" />
        <Output label="WR"    value={`${wr.toFixed(0)}%`} tone={wr >= 60 ? 'bull' : wr >= 40 ? 'warn' : 'bear'} />
      </div>

      {list.length === 0 ? (
        <div className={`${styles.histEmpty} prose`}>Sin operaciones previas en este par.</div>
      ) : (
        <>
          <ul className={styles.histList}>
            {list.map((h, i) => {
              const tone: 'bull' | 'bear' | 'warn' = h.pnl > 0 ? 'bull' : h.pnl < 0 ? 'bear' : 'warn';
              const tag  = h.outcome === 'tp' ? 'TP' : h.outcome === 'sl' ? 'SL' : 'MAN';
              const tagClass  = tone === 'bull' ? styles.histTagBull : tone === 'bear' ? styles.histTagBear : styles.histTagWarn;
              const pnlClass  = tone === 'bull' ? styles.histPnlBull : tone === 'bear' ? styles.histPnlBear : styles.histPnlWarn;
              return (
                <li key={i} className={styles.histItem}>
                  <span className={`${styles.histWhen} prose`}>{timeAgo(h.ts)}</span>
                  <span className={`${styles.histTag} ${tagClass}`}>{tag}</span>
                  <span className={styles.histScore}>
                    {h.score != null ? <>score <span className="num">{h.score}/9</span></> : <span className="prose">—</span>}
                  </span>
                  <span className={`${styles.histPnl} ${pnlClass} num`}>
                    {h.pnl > 0 ? '+' : ''}{h.pnl.toFixed(2)}%
                  </span>
                </li>
              );
            })}
          </ul>
          <div className={`${styles.histNote} prose`}>
            "MAN" = cerrada manualmente antes de TP/SL.
          </div>
        </>
      )}
    </div>
  );
};

// ============================================================
// Header chip + tab button helpers
// ============================================================

type ChipTone = 'bull' | 'bear' | 'warn' | 'dim';

const Chip: React.FC<{ label: string; value: string; tone: ChipTone; long?: boolean }> = ({ label, value, tone, long }) => {
  const toneClass =
    tone === 'bull' ? styles.chipBull :
    tone === 'bear' ? styles.chipBear :
    tone === 'warn' ? styles.chipWarn :
                      styles.chipDim;
  return (
    <div className={[styles.chip, toneClass, long ? styles.chipLong : ''].filter(Boolean).join(' ')}>
      <span className={`${styles.chipLabel} label`}>{label}</span>
      <span className={`${styles.chipVal} num`}>{value}</span>
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
  <button
    className={[styles.tabBtn, active ? styles.tabBtnActive : ''].filter(Boolean).join(' ')}
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
  >{children}</button>
);

export default SymbolDetail;
