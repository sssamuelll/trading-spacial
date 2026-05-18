// ============================================================
// AutoTuneView — Análisis → Auto-tune (A2)
//
// What this view answers:
//   1. ¿Qué quiere cambiar y por qué confiar?  → ParamDiff + stats
//   2. ¿Esto es seguro de aplicar?              → warnings + verdict
//   3. ¿Cómo me fue la última vez?              → mini-historial
//
// States: 'pending' (default) | 'applied' | 'rejected' | 'idle'
//
// Copilot layers (same as Historial / Posiciones / KillSwitch):
//   1. AgentBrief — synchronous local prose summary
//   2. Per-symbol verdict (tone-aware)
//   3. "Aplicar" = negotiated conversation (friction-by-design)
// ============================================================

import { useState, useMemo, useCallback } from 'react';
import styles from './AutoTuneView.module.css';
import {
  aggregateTune,
  type TuneRun,
  type TuneResultRow,
  type TuneHistoryRow,
} from '../helpers/auto-tune';
import {
  symbolVerdict,
  buildTuneBrief,
  paramTone,
  type Tone,
} from '../helpers/auto-tune-copilot';

// ── Public types ─────────────────────────────────────────────

/** Freeform agent prompt — shared shape with Historial / KillSwitch. */
export interface AgentFreeformPrompt {
  __freeform: string;
}

export interface AutoTuneViewProps {
  tune:             TuneRun | null;
  history?:         TuneHistoryRow[];
  onOpenSymbol:     (pair: string) => void;
  onAskAgent:       (payload: AgentFreeformPrompt) => void;
  onApplyNegotiate: (tune: TuneRun) => void;
  onReject:         (tune: TuneRun) => void;
  onForceTune?:     () => void;
  mobile?:          boolean;
}

// ── Local formatters ─────────────────────────────────────────

const fmtAtr = (n: number) => n.toFixed(2);
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

// ── Main view ────────────────────────────────────────────────

export function AutoTuneView({
  tune,
  history = [],
  onOpenSymbol,
  onAskAgent,
  onApplyNegotiate,
  onReject,
  onForceTune,
  mobile = false,
}: AutoTuneViewProps) {
  const agg   = useMemo(() => aggregateTune(tune),       [tune]);
  const brief = useMemo(() => buildTuneBrief(tune, agg), [tune, agg]);

  const askAboutTune = useCallback(() => {
    if (!tune) return;
    onAskAgent({
      __freeform:
        `Hablemos del auto-tune #${tune.id} corrido hace ${tune.hoursAgo}h. ` +
        `Propone ${agg.toChange} cambios, mejora agregada +$${agg.improvementUsd.toFixed(2)} en validation. ` +
        `${agg.warningCount} warnings detectados. ¿Qué riesgos ves? ¿Hay alguno donde la mejora sea frágil?`,
    });
  }, [tune, agg, onAskAgent]);

  const pageHint = !tune
    ? 'sin tune pendiente · próximo ciclo automático en 6h'
    : tune.status === 'pending'
      ? `tune #${tune.id} · corrido hace ${tune.hoursAgo}h · ${agg.toChange} cambios propuestos`
      : tune.status === 'applied'
        ? `tune #${tune.id} · aplicado · ${agg.toChange} cambios efectivos`
        : `tune #${tune.id} · rechazado · ${agg.toChange} cambios descartados`;

  return (
    <main className={styles.au}>
      {/* PAGE BAR */}
      <div className={styles.pageBar}>
        <div className={styles.pageBarTitle}>
          <span className={styles.pageBarIndex}>A2</span>
          <span className={styles.pageBarName}>Auto-tune</span>
          <span className={styles.pageBarSep}>/</span>
          <span className={`${styles.pageBarHint} prose`}>{pageHint}</span>
        </div>
        {onForceTune && (
          <button
            className={`btn btn--ghost btn--sm ${styles.pageBarCta}`}
            onClick={onForceTune}
            title="Forzar nuevo backtest"
          >
            <span className={styles.icon}>↻</span> Forzar tune
          </button>
        )}
      </div>

      {/* IDLE STATE */}
      {!tune && <IdleState onForceTune={onForceTune} />}

      {/* PENDING / APPLIED / REJECTED */}
      {tune && (
        <>
          {tune.status === 'applied' && (
            <TuneStatusBanner
              tone="bull" glyph="◆" title="Tune aplicado"
              body={`Los ${agg.toChange} cambios están vivos. Monitorea las próximas 20 operaciones por símbolo para validar el impacto.`}
            />
          )}
          {tune.status === 'rejected' && (
            <TuneStatusBanner
              tone="dim" glyph="◌" title="Tune rechazado"
              body="Los parámetros actuales no fueron modificados. El próximo ciclo automático correrá en 6h."
            />
          )}

          {/* HERO METRICS */}
          <div className={styles.hero}>
            <div className={styles.heroMain}>
              <div className={`label ${styles.heroLbl}`}>Mejora proyectada</div>
              <div className={`${styles.heroVal} num ${agg.improvementUsd >= 0 ? styles.heroValBull : styles.heroValBear}`}>
                {agg.improvementUsd >= 0 ? '+' : ''}${agg.improvementUsd.toFixed(2)}
              </div>
              <div className={`${styles.heroSub} prose`}>
                en validation · promedio {fmtPct(agg.avgImprovementPct)} por cambio
              </div>
            </div>
            <div className={styles.heroMetrics}>
              <MC
                label="Cambios" value={String(agg.toChange)} tone="bull"
                sub={agg.toChange === 0 ? 'sin cambios' : 'CHANGE'}
              />
              <MC
                label="Sin cambio" value={String(agg.toKeep)} tone="dim"
                sub="KEEP · parámetros actuales OK"
              />
              <MC
                label="Sin datos" value={String(agg.noData + agg.errors)}
                tone={agg.errors > 0 ? 'warn' : 'dim'}
                sub={agg.errors > 0 ? `${agg.errors} con error` : 'NO_DATA'}
              />
              <MC
                label="Warnings" value={String(agg.warningCount)}
                tone={agg.warningCount > 0 ? 'warn' : 'bull'}
                sub={agg.warningCount === 0 ? 'limpio' : 'revisar antes de aplicar'}
              />
            </div>
          </div>

          {/* BRIEF */}
          <div className={styles.brief}>
            <div className={styles.briefAvatar}>
              <span className={styles.briefGlyph}>◆</span>
            </div>
            <div className={styles.briefBody}>
              <div className={styles.briefTagRow}>
                <span className={styles.briefTag}>lectura del tune</span>
                <span className={`${styles.briefLatency} prose`}>síncrono · local</span>
              </div>
              <div className={styles.briefHeadline}>{brief.headline}</div>
              {brief.lines.map((l, i) => (
                <p key={i} className={`${styles.briefLine} prose`}>{l}</p>
              ))}
              {tune.status === 'pending' && (
                <button className={styles.briefCta} onClick={askAboutTune}>
                  Conversar sobre este tune <span>→</span>
                </button>
              )}
            </div>
          </div>

          {/* SECTION HEADER */}
          <div className={styles.secHd}>
            <span className={`label ${styles.secHdLabel}`}>▸ Propuestas por símbolo</span>
            <span className={styles.secHdCount}>{agg.total}</span>
            <span className={`prose ${styles.secHdHint}`}>
              {tune.status === 'pending'
                ? 'expande para ver el diff de parámetros y stats del backtest'
                : `snapshot del tune ${tune.status}`}
            </span>
          </div>

          {/* CARDS */}
          <section className={styles.cards}>
            {tune.results.map((r) => (
              <SymbolCard
                key={r.symbol}
                r={r}
                mobile={mobile}
                readonly={tune.status !== 'pending'}
                onOpenSymbol={onOpenSymbol}
                onAskAgent={onAskAgent}
              />
            ))}
          </section>

          {/* ACTIONS FOOTER */}
          {tune.status === 'pending' && (
            <div className={`${styles.actions} ${mobile ? styles.actionsMobile : ''}`}>
              <div className={`${styles.actionsHint} prose`}>
                Aplicar abre una conversación con el copiloto para articular tu tesis antes de modificar la estrategia en vivo.
              </div>
              <div className={styles.actionsBtns}>
                <button className="btn btn--ghost btn--sm" onClick={() => onReject(tune)}>
                  Rechazar tune
                </button>
                <button className={styles.apply} onClick={() => onApplyNegotiate(tune)}>
                  Aplicar tune <span className={styles.applyArrow}>→</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* HISTORY */}
      {history.length > 0 && (
        <>
          <div className={styles.histHd}>
            <span className={`label ${styles.histHdLabel}`}>▸ Últimos tunes</span>
            <span className={styles.histHdCount}>{history.length}</span>
            <span className={`prose ${styles.histHdHint}`}>historial de auto-tunes corridos</span>
          </div>
          <TuneHistoryList rows={history} mobile={mobile} />
        </>
      )}
    </main>
  );
}

// ── Metric cell ──────────────────────────────────────────────

function mcToneClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.mcValBull;
    case 'bear':    return styles.mcValBear;
    case 'warn':    return styles.mcValWarn;
    case 'neutral': return styles.mcValNeutral;
    default:        return styles.mcValDim;
  }
}

function MC({ label, value, tone, sub }: { label: string; value: string; tone: Tone; sub?: string }) {
  return (
    <div className={styles.mc}>
      <div className={`${styles.mcLabel} label`}>{label}</div>
      <div className={`${styles.mcVal} ${mcToneClass(tone)} num`}>{value}</div>
      {sub && <div className={`${styles.mcSub} prose`}>{sub}</div>}
    </div>
  );
}

// ── Status banner (applied / rejected) ───────────────────────

function TuneStatusBanner({
  tone, glyph, title, body,
}: { tone: Tone; glyph: string; title: string; body: string }) {
  const statusClass = tone === 'bull' ? styles.statusBull : styles.statusDim;
  const avatarClass = tone === 'bull' ? styles.statusAvatarBull : styles.statusAvatarDim;
  return (
    <div className={`${styles.status} ${statusClass}`}>
      <div className={`${styles.statusAvatar} ${avatarClass}`}><span>{glyph}</span></div>
      <div>
        <div className={styles.statusTitle}>{title}</div>
        <div className={`${styles.statusSub} prose`}>{body}</div>
      </div>
    </div>
  );
}

// ── Symbol card ──────────────────────────────────────────────

interface SymbolCardProps {
  r:            TuneResultRow;
  mobile?:      boolean;
  readonly:     boolean;
  onOpenSymbol: (pair: string) => void;
  onAskAgent:   (payload: AgentFreeformPrompt) => void;
}

function pcBorderClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.pcBull;
    case 'bear':    return styles.pcBear;
    case 'warn':    return styles.pcWarn;
    case 'neutral': return styles.pcNeutral;
    default:        return styles.pcDim;
  }
}

function recoChipClass(tone: Tone): string {
  if (tone === 'bull') return styles.pcRecoBull;
  if (tone === 'warn') return styles.pcRecoWarn;
  return styles.pcRecoDim;
}

function verdictGlyphClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.pcVerdictGlyphBull;
    case 'bear':    return styles.pcVerdictGlyphBear;
    case 'warn':    return styles.pcVerdictGlyphWarn;
    case 'neutral': return styles.pcVerdictGlyphNeutral;
    default:        return styles.pcVerdictGlyphDim;
  }
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

function SymbolCard({ r, readonly, onOpenSymbol, onAskAgent }: SymbolCardProps) {
  const isActionable = r.recommendation === 'CHANGE';
  const [open, setOpen] = useState<boolean>(isActionable);

  const verdict = useMemo(() => symbolVerdict(r), [r]);
  const pair    = r.symbol.replace(/USDT$/, '');
  const tone    = verdict.tone;

  const recoChip =
    r.recommendation === 'CHANGE'  ? { tone: 'bull' as Tone, label: 'CHANGE'  } :
    r.recommendation === 'KEEP'    ? { tone: 'dim'  as Tone, label: 'KEEP'    } :
    r.recommendation === 'NO_DATA' ? { tone: 'dim'  as Tone, label: 'NO DATA' } :
                                     { tone: 'warn' as Tone, label: 'ERROR'   };

  const askVerdict = useCallback(() => {
    onAskAgent({
      __freeform:
        `Hablemos del auto-tune para ${pair}. Recomendación: ${r.recommendation}. ` +
        (r.recommendation === 'CHANGE'
          ? `Propone SL ${fmtAtr(r.current_params.atr_sl_mult)} → ${fmtAtr(r.proposed_params!.atr_sl_mult)}, ` +
            `TP ${fmtAtr(r.current_params.atr_tp_mult)} → ${fmtAtr(r.proposed_params!.atr_tp_mult)}, ` +
            `BE ${fmtAtr(r.current_params.atr_be_mult)} → ${fmtAtr(r.proposed_params!.atr_be_mult)}. ` +
            `Mejora +${r.proposal_detail!.improvement_pct.toFixed(1)}% con ${r.proposal_detail!.val_trades} ops de validation. `
          : `Sin propuesta de cambio. `) +
        `Tu lectura inicial: "${verdict.text}". ${verdict.action}.`,
    });
  }, [r, pair, verdict, onAskAgent]);

  return (
    <article className={`${styles.pc} ${pcBorderClass(tone)} ${open ? styles.pcOpen : ''}`}>
      <button className={styles.pcHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`${styles.pcChev} ${open ? styles.pcChevOpen : ''}`}>▸</span>

        <span className={styles.pcPair}>
          <span className={styles.pcPairBase}>{pair}</span>
          <span className={styles.pcPairQuote}>/USDT</span>
        </span>

        <span className={`${styles.pcReco} ${recoChipClass(recoChip.tone)}`}>{recoChip.label}</span>

        {r.proposal_detail
          ? <>
              <span className={styles.pcImp}>
                <span className={`label ${styles.pcImpLbl}`}>Mejora</span>
                <span className={`num ${styles.pcImpVal} ${r.proposal_detail.improvement_pct >= 5 ? styles.pcImpValBull : styles.pcImpValWarn}`}>
                  {fmtPct(r.proposal_detail.improvement_pct)}
                </span>
              </span>
              <span className={styles.pcTrades}>
                <span className={`label ${styles.pcImpLbl}`}>Val.ops</span>
                <span className={`num ${styles.pcImpVal} ${r.proposal_detail.val_trades >= 30 ? styles.pcImpValBull : styles.pcImpValWarn}`}>
                  {r.proposal_detail.val_trades}
                </span>
              </span>
            </>
          : <>
              <span className={styles.pcImp}>
                <span className={`label ${styles.pcImpLbl}`}>Mejora</span>
                <span className={`num ${styles.pcImpVal} ${styles.pcImpValDim}`}>—</span>
              </span>
              <span className={styles.pcTrades}>
                <span className={`label ${styles.pcImpLbl}`}>Val.ops</span>
                <span className={`num ${styles.pcImpVal} ${styles.pcImpValDim}`}>—</span>
              </span>
            </>
        }

        <span
          className={`${styles.pcVerdictGlyph} ${verdictGlyphClass(tone)}`}
          title={verdict.text}
        >
          {verdict.glyph}
        </span>
      </button>

      {open && (
        <div className={styles.pcBody}>
          {/* Verdict copiloto */}
          <div
            className={`${styles.pcVerdict} ${verdictToneClass(tone)} ${!readonly ? styles.pcVerdictInteractive : ''}`}
            onClick={readonly ? undefined : askVerdict}
            role={readonly ? undefined : 'button'}
          >
            <div className={`${styles.pcVerdictAvatar} ${verdictAvatarToneClass(tone)}`}>
              <span>{verdict.glyph}</span>
            </div>
            <div className={styles.pcVerdictBody}>
              <span className={styles.pcVerdictTag}>copiloto</span>
              <span className={`${styles.pcVerdictText} prose`}>{verdict.text}</span>
              {verdict.warnings.length > 0 && (
                <ul className={styles.pcWarnings}>
                  {verdict.warnings.map((w, i) => (
                    <li key={i} className={styles.pcWarn}>
                      <span className={styles.pcWarnGlyph}>⚠</span>
                      <span className="prose">{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {!readonly && (
              <button
                className={`${styles.pcVerdictCta} ${verdictCtaToneClass(tone)}`}
                onClick={(e) => { e.stopPropagation(); askVerdict(); }}
              >
                {verdict.action} →
              </button>
            )}
          </div>

          {/* Param diff visual (CHANGE only) */}
          {r.recommendation === 'CHANGE' && (
            <div className={styles.diff}>
              <ParamDiff paramKey="sl" label="ATR · Stop-loss"   current={r.current_params.atr_sl_mult} proposed={r.proposed_params!.atr_sl_mult} />
              <ParamDiff paramKey="tp" label="ATR · Take-profit" current={r.current_params.atr_tp_mult} proposed={r.proposed_params!.atr_tp_mult} />
              <ParamDiff paramKey="be" label="ATR · Break-even"  current={r.current_params.atr_be_mult} proposed={r.proposed_params!.atr_be_mult} />
            </div>
          )}

          {r.recommendation === 'KEEP' && (
            <div className={styles.keepRow}>
              <span className={`label ${styles.keepRowLbl}`}>Parámetros actuales</span>
              <span className={`num ${styles.keepRowVal}`}>SL {fmtAtr(r.current_params.atr_sl_mult)}</span>
              <span className={styles.keepRowSep}>·</span>
              <span className={`num ${styles.keepRowVal}`}>TP {fmtAtr(r.current_params.atr_tp_mult)}</span>
              <span className={styles.keepRowSep}>·</span>
              <span className={`num ${styles.keepRowVal}`}>BE {fmtAtr(r.current_params.atr_be_mult)}</span>
            </div>
          )}

          {r.recommendation === 'CHANGE' && (
            <div className={styles.pcStats}>
              <Stat label="Mejora"    value={fmtPct(r.proposal_detail!.improvement_pct)}     tone={r.proposal_detail!.improvement_pct >= 5 ? 'bull' : 'warn'} />
              <Stat label="Val P&L"   value={`+$${r.proposal_detail!.val_pnl.toFixed(2)}`}   tone="bull" />
              <Stat label="Val PF"    value={`${r.proposal_detail!.val_pf.toFixed(2)}x`}     tone={r.proposal_detail!.val_pf >= 2 ? 'bull' : 'warn'} />
              <Stat label="Val.ops"   value={String(r.proposal_detail!.val_trades)}           tone={r.proposal_detail!.val_trades >= 30 ? 'bull' : 'warn'} />
              <Stat label="Train P&L" value={`+$${r.proposal_detail!.train_pnl.toFixed(2)}`}  tone="neutral" />
              <Stat label="Total ops" value={String(r.proposal_detail!.total_trades)}         tone="neutral" />
            </div>
          )}

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

// ── ParamDiff ────────────────────────────────────────────────

interface ParamDiffProps {
  paramKey: 'sl' | 'tp' | 'be';
  label:    string;
  current:  number;
  proposed: number;
}

function paramBorderClass(tone: Tone): string {
  switch (tone) {
    case 'bull': return styles.paramBull;
    case 'warn': return styles.paramWarn;
    case 'dim':  return styles.paramDim;
    default:     return styles.paramNeutral;
  }
}

function paramDeltaToneClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.paramDeltaBull;
    case 'warn':    return styles.paramDeltaWarn;
    case 'bear':    return styles.paramDeltaBear;
    case 'neutral': return styles.paramDeltaNeutral;
    default:        return styles.paramDeltaDim;
  }
}

function paramNewToneClass(tone: Tone): string {
  switch (tone) {
    case 'bull':    return styles.paramNewBull;
    case 'warn':    return styles.paramNewWarn;
    case 'bear':    return styles.paramNewBear;
    case 'neutral': return styles.paramNewNeutral;
    default:        return styles.paramNewDim;
  }
}

function paramBarNewToneClass(tone: Tone): string {
  switch (tone) {
    case 'bull': return styles.paramBarNewBull;
    case 'warn': return styles.paramBarNewWarn;
    case 'dim':  return styles.paramBarNewDim;
    default:     return styles.paramBarNewNeutral;
  }
}

function ParamDiff({ paramKey, label, current, proposed }: ParamDiffProps) {
  const tone     = paramTone(paramKey, current, proposed);
  const delta    = proposed - current;
  const deltaPct = current === 0 ? 0 : (delta / current) * 100;
  const noChange = Math.abs(delta) < 0.005;

  const scaleMax = 5;
  const curW = (current  / scaleMax) * 100;
  const newW = (proposed / scaleMax) * 100;

  return (
    <div className={`${styles.param} ${paramBorderClass(tone)}`}>
      <div className={styles.paramLblRow}>
        <span className={`label ${styles.paramLbl}`}>{label}</span>
        {noChange
          ? <span className={`${styles.paramDelta} ${styles.paramDeltaDim}`}>sin cambio</span>
          : <span className={`${styles.paramDelta} ${paramDeltaToneClass(tone)}`}>
              {delta > 0 ? '+' : ''}{deltaPct.toFixed(0)}%
            </span>
        }
      </div>
      <div className={styles.paramVals}>
        <span className={`num ${styles.paramCur}`}>{fmtAtr(current)}</span>
        <span className={styles.paramArrow}>→</span>
        <span className={`num ${styles.paramNew} ${paramNewToneClass(tone)}`}>{fmtAtr(proposed)}</span>
      </div>
      <div className={styles.paramBars}>
        <div
          className={`${styles.paramBar} ${styles.paramBarCur}`}
          style={{ width: `${curW}%` }}
          title={`actual ${fmtAtr(current)}`}
        />
        <div
          className={`${styles.paramBar} ${styles.paramBarNew} ${paramBarNewToneClass(tone)}`}
          style={{ width: `${newW}%` }}
          title={`propuesto ${fmtAtr(proposed)}`}
        />
        <div className={styles.paramScale}>
          {[1, 2, 3, 4].map((tick) => (
            <span key={tick} className={styles.paramTick} style={{ left: `${(tick / scaleMax) * 100}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  return (
    <div className={styles.stat}>
      <div className={`label ${styles.statLbl}`}>{label}</div>
      <div className={`num ${styles.statVal} ${statValToneClass(tone)}`}>{value}</div>
    </div>
  );
}

// ── History list ─────────────────────────────────────────────

function histStatusClass(status: TuneHistoryRow['status']): string {
  if (status === 'applied')  return styles.histStatusApplied;
  if (status === 'rejected') return styles.histStatusRejected;
  return styles.histStatusPending;
}

function histCardBorderClass(status: TuneHistoryRow['status']): string {
  if (status === 'applied')  return styles.histCardApplied;
  if (status === 'rejected') return styles.histCardRejected;
  return styles.histCardPending;
}

function TuneHistoryList({ rows, mobile }: { rows: TuneHistoryRow[]; mobile?: boolean }) {
  if (mobile) {
    return (
      <div className={`${styles.hist} ${styles.histMobile}`}>
        {rows.map((r) => (
          <div key={r.id} className={`${styles.histCard} ${histCardBorderClass(r.status)}`}>
            <div className={styles.histCardR1}>
              <span className={`num ${styles.histCardId}`}>#{r.id}</span>
              <span className={`${styles.histStatus} ${histStatusClass(r.status)}`}>{r.status.toUpperCase()}</span>
              <span className={`prose ${styles.histCardAgo}`}>hace {r.daysAgo}d</span>
              <span className={`num ${styles.histCardCount}`}>{r.changes_count} cambios</span>
            </div>
            <div className={`${styles.histCardR2} prose`}>{r.summary}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.hist}>
      <div className={`${styles.histHead} label`}>
        <div>#</div>
        <div>Fecha</div>
        <div>Hace</div>
        <div>Status</div>
        <div>Cambios</div>
        <div>Resumen</div>
        <div></div>
      </div>
      {rows.map((r) => (
        <div key={r.id} className={styles.histRow}>
          <div className={`num ${styles.histId}`}>#{r.id}</div>
          <div className={`num ${styles.histDate}`}>{r.ts}</div>
          <div className={`prose ${styles.histAgo}`}>hace {r.daysAgo}d</div>
          <div><span className={`${styles.histStatus} ${histStatusClass(r.status)}`}>{r.status.toUpperCase()}</span></div>
          <div className={`num ${styles.histCount}`}>{r.changes_count}</div>
          <div className={`prose ${styles.histSummary}`}>{r.summary}</div>
          <div><button className="btn btn--ghost btn--sm">Ver reporte →</button></div>
        </div>
      ))}
    </div>
  );
}

// ── Idle state ───────────────────────────────────────────────

function IdleState({ onForceTune }: { onForceTune?: () => void }) {
  return (
    <section className={styles.idle}>
      <div className={styles.idleMark}>◌</div>
      <div className={styles.idleTitle}>Sin tune pendiente</div>
      <div className={`${styles.idleBody} prose`}>
        El sistema está al día con los parámetros actuales. El próximo ciclo de auto-tune correrá automáticamente en 6h sobre los últimos 90 días de operaciones.
      </div>
      {onForceTune && (
        <button className={`btn btn--ghost btn--sm ${styles.idleCta}`} onClick={onForceTune}>
          <span className={styles.icon}>↻</span> Forzar tune ahora
        </button>
      )}
    </section>
  );
}

export default AutoTuneView;
