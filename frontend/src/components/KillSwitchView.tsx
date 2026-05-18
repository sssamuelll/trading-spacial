// ============================================================
// KillSwitchView — three-layer copilot integration.
//
//   1. Top KsReading strip      : synchronous narrative
//   2. Per-card verdict row     : agent's posture per pair
//   3. Override negotiation     : "forzar release" opens the
//                                 AgentDock to challenge the user's
//                                 thesis before confirming
//
// The override path NEVER calls the release endpoint directly from
// here — it bubbles to App.tsx which seeds the AgentDock with a
// negotiation prompt. The dock emits <<<TOOL:confirm_release:SYM>>>
// only when the user articulates a sound thesis; the dock renders an
// amber confirm button that then hits the real backend.
// ============================================================

import React, { useMemo, useState } from 'react';
import styles from './KillSwitchView.module.css';
import type {
  DashboardResponse,
  DashboardSymbolState,
  DashboardPortfolioState,
  DashboardPortfolioTransition,
  KillSwitchPerSymbolTier,
} from '../types';
import {
  computeKsReading,
  computeCardVerdict,
  groupByTier,
  type CardVerdict,
  type KsReading as KsReadingT,
  type SymbolsByTier,
} from '../helpers/kill-switch-copilot';

// ── Public types ─────────────────────────────────────────────

export type AskAgentPayload =
  | DashboardSymbolState
  | { __freeform: string };

interface KillSwitchViewProps {
  dashboard:          DashboardResponse;
  onAskAgent:         (payload: AskAgentPayload) => void;
  onNegotiateRelease: (sym: DashboardSymbolState, verdict: CardVerdict | null) => void;
  rulesVisible?:      boolean;
  onToggleRules?:     () => void;
  mobile?:            boolean;
}

// ── Tier metadata ────────────────────────────────────────────

interface TierMeta {
  key:   KillSwitchPerSymbolTier;
  tone:  'bull' | 'warn' | 'bear';
  glyph: string;
  label: string;
  blurb: string;
}

const PER_SYMBOL_TIERS: TierMeta[] = [
  { key: 'PAUSED',     tone: 'bear', glyph: '⏸', label: 'Pausados',     blurb: 'el escáner no abre posiciones aquí' },
  { key: 'REDUCED',    tone: 'warn', glyph: '◐', label: 'Reducidos',    blurb: 'tamaño al 50% hasta recuperar WR' },
  { key: 'PROBATION',  tone: 'warn', glyph: '◯', label: 'En prueba',    blurb: 'reactivados condicionalmente' },
  { key: 'ALERT',      tone: 'warn', glyph: '⚠', label: 'En vigilancia', blurb: 'cerca de bajar de tier' },
  { key: 'NORMAL',     tone: 'bull', glyph: '✓', label: 'Saludables',   blurb: 'operativos sin restricciones' },
];

interface PortfolioTierMeta {
  key:       'NORMAL' | 'WARNED' | 'REDUCED' | 'FROZEN';
  tone:      'bull' | 'warn' | 'bear';
  threshold: number;
  label:     string;
  blurb:     string;
}

const PORTFOLIO_TIERS: PortfolioTierMeta[] = [
  { key: 'NORMAL',  tone: 'bull', threshold: 0,  label: 'NORMAL',  blurb: 'operación sin restricciones' },
  { key: 'WARNED',  tone: 'warn', threshold: 5,  label: 'WARNED',  blurb: 'vigilancia activa — alertas extra' },
  { key: 'REDUCED', tone: 'warn', threshold: 10, label: 'REDUCED', blurb: 'tamaños al 50% en todo el portafolio' },
  { key: 'FROZEN',  tone: 'bear', threshold: 15, label: 'FROZEN',  blurb: 'no se abren posiciones nuevas' },
];

// ── Helpers ──────────────────────────────────────────────────

function sinceLabel(stateSince: string | null): string {
  if (!stateSince) return '';
  const t = new Date(stateSince).getTime();
  if (!Number.isFinite(t)) return '';
  const hours = (Date.now() - t) / (1000 * 60 * 60);
  return hours < 24 ? `hace ${hours.toFixed(1)}h` : `hace ${Math.floor(hours / 24)}d`;
}

function tierTone(tier: string): 'bull' | 'warn' | 'bear' {
  if (tier === 'NORMAL' || tier === 'PROBATION') return 'bull';
  if (tier === 'PAUSED' || tier === 'FROZEN')    return 'bear';
  return 'warn';
}

// ── MAIN VIEW ────────────────────────────────────────────────

const KillSwitchView: React.FC<KillSwitchViewProps> = ({
  dashboard, onAskAgent, onNegotiateRelease,
  rulesVisible, onToggleRules, mobile = false,
}) => {
  const portfolio = dashboard.portfolio;
  const symbols   = dashboard.symbols;
  const transitions = dashboard.portfolio.recent_transitions;
  const [expandNormal,  setExpandNormal]  = useState(false);
  const [localShowRules, setLocalShowRules] = useState(true);
  const showRules = rulesVisible ?? localShowRules;
  const handleToggleRules = onToggleRules ?? (() => setLocalShowRules((v) => !v));

  const byTier: SymbolsByTier = useMemo(() => groupByTier(symbols), [symbols]);
  const totalIntervened = symbols.length - byTier.NORMAL.length;
  const reading = useMemo(
    () => computeKsReading(portfolio, symbols, byTier),
    [portfolio, symbols, byTier],
  );

  return (
    <main className={styles.ks}>
      {/* Page bar */}
      <div className={styles.pageBar}>
        <div className={styles.pageBarTitle}>
          <span className={styles.pageBarIndex}>03</span>
          <span className={styles.pageBarName}>Kill-switch</span>
          <span className={styles.pageBarSep}>/</span>
          <span className={`${styles.pageBarHint} prose`}>
            {totalIntervened === 0
              ? 'sin intervenciones · sistema operando sin restricciones'
              : `${totalIntervened} ${totalIntervened === 1 ? 'par intervenido' : 'pares intervenidos'} · portafolio ${portfolio.tier}`}
          </span>
        </div>
        <button className={`btn btn--ghost btn--sm ${styles.pageBarCta}`} onClick={handleToggleRules}>
          {showRules ? '✓ reglas visibles' : 'mostrar reglas'}
        </button>
      </div>

      <PortfolioGauge portfolio={portfolio} />

      <KsReading reading={reading} onAskAgent={onAskAgent} />

      {showRules && <RulesCard onClose={handleToggleRules} />}

      <div className={`${styles.body} ${mobile ? styles.bodyMobile : ''}`}>
        <div className={styles.main}>
          {PER_SYMBOL_TIERS.map((tier) => {
            const list = byTier[tier.key];
            if (list.length === 0) return null;
            if (tier.key === 'NORMAL') {
              return (
                <NormalSummary
                  key="normal"
                  list={list}
                  expanded={expandNormal}
                  onToggle={() => setExpandNormal((v) => !v)}
                />
              );
            }
            return (
              <TierSection
                key={tier.key}
                tier={tier}
                symbols={list}
                onAskAgent={onAskAgent}
                onNegotiateRelease={onNegotiateRelease}
              />
            );
          })}
        </div>

        <aside className={styles.side}>
          <TransitionTimeline transitions={transitions} />
        </aside>
      </div>
    </main>
  );
};

// ── PORTFOLIO GAUGE ──────────────────────────────────────────

const PortfolioGauge: React.FC<{ portfolio: DashboardPortfolioState }> = ({ portfolio }) => {
  const max = 20;
  const ddPctDisplay = Math.abs(portfolio.dd_pct * 100);
  const pos = Math.min(100, (ddPctDisplay / max) * 100);
  const currentTierMeta =
    PORTFOLIO_TIERS.find((t) => t.key === portfolio.tier) ?? PORTFOLIO_TIERS[0];

  const tonePf =
    currentTierMeta.tone === 'bull' ? styles.pfBull :
    currentTierMeta.tone === 'warn' ? styles.pfWarn : styles.pfBear;
  const toneBadge =
    currentTierMeta.tone === 'bull' ? styles.pfTierBadgeBull :
    currentTierMeta.tone === 'warn' ? styles.pfTierBadgeWarn : styles.pfTierBadgeBear;
  const toneNeedle =
    currentTierMeta.tone === 'bull' ? styles.gaugeNeedleBull :
    currentTierMeta.tone === 'warn' ? styles.gaugeNeedleWarn : styles.gaugeNeedleBear;

  return (
    <section className={`${styles.pf} ${tonePf}`}>
      <div className={styles.pfHead}>
        <div className={styles.pfId}>
          <div className={`${styles.pfTierBadge} ${toneBadge}`}>
            <span className={styles.pfTierKey}>{currentTierMeta.label}</span>
            <span className={`${styles.pfTierSub} prose`}>{currentTierMeta.blurb}</span>
          </div>
          <div className={styles.pfEquity}>
            <span className={`${styles.pfEquityLabel} label`}>EQUITY ACTUAL</span>
            <span className={`num ${styles.pfEquityVal}`}>
              ${portfolio.current_equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`prose ${styles.pfEquitySub}`}>peak ${portfolio.peak_equity.toLocaleString()}</span>
          </div>
        </div>
        <div className={styles.pfMetrics}>
          <MiniMetric
            label="Pérdidas concurrentes"
            value={portfolio.concurrent_failures}
            suffix="/ 3"
            tone={portfolio.concurrent_failures >= 3 ? 'bear' : portfolio.concurrent_failures >= 2 ? 'warn' : 'neutral'}
          />
        </div>
      </div>

      <div className={styles.gauge}>
        <div className={styles.gaugeTrack}>
          {PORTFOLIO_TIERS.map((t, i) => {
            const next = PORTFOLIO_TIERS[i + 1];
            const startPct = (t.threshold / max) * 100;
            const endPct = next ? (next.threshold / max) * 100 : 100;
            const zoneClass =
              t.tone === 'bull' ? styles.gaugeZoneBull :
              t.tone === 'warn' ? styles.gaugeZoneWarn : styles.gaugeZoneBear;
            return (
              <div
                key={t.key}
                className={`${styles.gaugeZone} ${zoneClass}`}
                style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
                title={`${t.label}: DD ≥ ${t.threshold}%`}
              />
            );
          })}
          <div
            className={`${styles.gaugeNeedle} ${toneNeedle}`}
            style={{ left: `${pos}%` }}
          >
            <span className={`${styles.gaugeNeedleVal} num`}>DD {ddPctDisplay.toFixed(1)}%</span>
          </div>
        </div>
        <div className={styles.gaugeScale}>
          {PORTFOLIO_TIERS.map((t) => {
            const lblClass =
              t.tone === 'bull' ? styles.gaugeTickLblBull :
              t.tone === 'warn' ? styles.gaugeTickLblWarn : styles.gaugeTickLblBear;
            return (
              <div key={t.key} className={styles.gaugeTick} style={{ left: `${(t.threshold / max) * 100}%` }}>
                <span className={`${styles.gaugeTickLbl} ${lblClass}`}>{t.label}</span>
                <span className={`${styles.gaugeTickVal} num`}>≥{t.threshold}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

const MiniMetric: React.FC<{
  label:  string;
  value:  React.ReactNode;
  suffix?: string;
  tone:   'bull' | 'warn' | 'bear' | 'neutral';
}> = ({ label, value, suffix, tone }) => {
  const toneClass =
    tone === 'bull' ? styles.mmValBull :
    tone === 'warn' ? styles.mmValWarn :
    tone === 'bear' ? styles.mmValBear : styles.mmValNeutral;
  return (
    <div className={styles.mm}>
      <span className={`${styles.mmLabel} label`}>{label}</span>
      <span className={styles.mmRow}>
        <span className={`${styles.mmVal} ${toneClass} num`}>{value}</span>
        {suffix && <span className={`${styles.mmSuf} prose`}>{suffix}</span>}
      </span>
    </div>
  );
};

// ── KsReading (top strip) ────────────────────────────────────

const KsReading: React.FC<{ reading: KsReadingT; onAskAgent: (p: AskAgentPayload) => void }> = ({ reading, onAskAgent }) => {
  const toneClass =
    reading.tone === 'bull' ? '' :
    reading.tone === 'warn' ? styles.readingWarn : '';
  return (
    <section className={`${styles.reading} ${toneClass}`}>
      <div className={styles.readingAvatar}>◈</div>
      <div className={styles.readingBody}>
        <div className={styles.readingHead}>
          <span className={`${styles.readingLabel} label`}>▸ Lectura del copiloto</span>
          <span className={styles.readingLive}>
            <span className={styles.readingDot} /> en vivo
          </span>
        </div>
        <div className={`${styles.readingProse} prose`}>
          <p className={styles.readingHeadline}><strong>{reading.headline}</strong></p>
          <p className={styles.readingInsight}>{reading.insight}</p>
          <p className={styles.readingRec}>{reading.recommendation}</p>
        </div>
        <div className={styles.readingChips}>
          {reading.chips.map((c, i) => (
            <button
              key={i}
              className={styles.readingChip}
              onClick={() => onAskAgent({ __freeform: c.prompt })}
            >{c.label}</button>
          ))}
        </div>
      </div>
    </section>
  );
};

// ── Rules card ───────────────────────────────────────────────

const RulesCard: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <section className={styles.rules}>
    <div className={styles.rulesHd}>
      <span className={`${styles.rulesTitle} label`}>▸ Cómo funciona el kill-switch</span>
      <button className={styles.rulesClose} onClick={onClose} aria-label="ocultar">×</button>
    </div>
    <div className={styles.rulesGrid}>
      <Rule tier="PAUSED"    tone="bear" rule="3 pérdidas consecutivas o 3 meses negativos" effect="el par deja de operar 7 días" />
      <Rule tier="REDUCED"   tone="warn" rule="WR cae por debajo del 40% en últimas 20 ops" effect="tamaño de posición se baja al 50%" />
      <Rule tier="PROBATION" tone="warn" rule="vuelve de PAUSED tras 7d" effect="7 trades en prueba; vuelve a NORMAL con ≥ 4/7 wins" />
      <Rule tier="ALERT"     tone="warn" rule="2 pérdidas consecutivas" effect="solo vigilancia preventiva — no cambia tamaño" />
    </div>
  </section>
);

const Rule: React.FC<{ tier: string; tone: 'bull' | 'warn' | 'bear'; rule: string; effect: string }> = ({ tier, tone, rule, effect }) => {
  const ruleClass = tone === 'bull' ? styles.ruleBull : tone === 'warn' ? styles.ruleWarn : styles.ruleBear;
  const tierClass = tone === 'bull' ? styles.ruleTierBull : tone === 'warn' ? styles.ruleTierWarn : styles.ruleTierBear;
  return (
    <div className={`${styles.rule} ${ruleClass}`}>
      <span className={`${styles.ruleTier} ${tierClass}`}>{tier}</span>
      <div className={styles.ruleBody}>
        <span className={`${styles.ruleWhen} prose`}>si <strong>{rule}</strong></span>
        <span className={`${styles.ruleThen} prose`}>→ {effect}</span>
      </div>
    </div>
  );
};

// ── Tier section ─────────────────────────────────────────────

const TierSection: React.FC<{
  tier:               TierMeta;
  symbols:            DashboardSymbolState[];
  onAskAgent:         (p: AskAgentPayload) => void;
  onNegotiateRelease: (sym: DashboardSymbolState, verdict: CardVerdict | null) => void;
}> = ({ tier, symbols, onAskAgent, onNegotiateRelease }) => {
  const glyphClass =
    tier.tone === 'bull' ? styles.tierGlyphBull :
    tier.tone === 'warn' ? styles.tierGlyphWarn : styles.tierGlyphBear;
  const titleClass =
    tier.tone === 'bull' ? styles.tierTitleBull :
    tier.tone === 'warn' ? styles.tierTitleWarn : styles.tierTitleBear;
  return (
    <section className={styles.tier}>
      <header className={styles.tierHd}>
        <div className={`${styles.tierGlyph} ${glyphClass}`}>{tier.glyph}</div>
        <div className={styles.tierTitleBlock}>
          <span className={`${styles.tierTitle} ${titleClass}`}>{tier.label}</span>
          <span className={styles.tierCount}>{symbols.length}</span>
          <span className={`${styles.tierSub} prose`}>— {tier.blurb}</span>
        </div>
      </header>
      <div className={styles.tierCards}>
        {symbols.map((s) => (
          <SymbolKsCard
            key={s.symbol}
            sym={s}
            tone={tier.tone}
            onAskAgent={onAskAgent}
            onNegotiateRelease={onNegotiateRelease}
          />
        ))}
      </div>
    </section>
  );
};

// ── Per-symbol card ──────────────────────────────────────────

const SymbolKsCard: React.FC<{
  sym:                DashboardSymbolState;
  tone:               'bull' | 'warn' | 'bear';
  onAskAgent:         (p: AskAgentPayload) => void;
  onNegotiateRelease: (sym: DashboardSymbolState, verdict: CardVerdict | null) => void;
}> = ({ sym, tone, onAskAgent, onNegotiateRelease }) => {
  const verdict = computeCardVerdict(sym);
  const since   = sinceLabel(sym.state_since);
  const cardClass =
    tone === 'bull' ? styles.cardBull :
    tone === 'warn' ? styles.cardWarn : styles.cardBear;
  const reasonLblClass =
    tone === 'bull' ? styles.cardReasonLblBull :
    tone === 'warn' ? styles.cardReasonLblWarn : styles.cardReasonLblBear;

  const wr20 = (sym.metrics.win_rate_20_trades ?? 0) * 100;
  const pnl30 = sym.metrics.pnl_30d ?? 0;
  const probationRemaining = sym.metrics.probation_trades_remaining;

  return (
    <article className={`${styles.card} ${cardClass}`}>
      <header className={styles.cardHead}>
        <div className={styles.cardPair}>
          <span className={styles.cardPairBase}>{sym.symbol.replace('USDT', '')}</span>
          <span className={styles.cardPairQuote}>/USDT</span>
        </div>
        {since && <span className={`${styles.cardSince} prose`}>{since}</span>}
      </header>

      <div className={styles.cardMetrics}>
        <KsMetric label="WR (20)"  value={`${wr20.toFixed(0)}%`}
                  tone={wr20 >= 60 ? 'bull' : wr20 >= 40 ? 'warn' : 'bear'} />
        <KsMetric label="P&L 30d" value={`${pnl30 >= 0 ? '+' : ''}$${pnl30.toFixed(2)}`}
                  tone={pnl30 >= 0 ? 'bull' : 'bear'} />
        <KsMetric label="Trades" value={sym.metrics.trades_count_total} tone="neutral" />
        {probationRemaining != null && (
          <KsMetric label="Restantes" value={probationRemaining} suffix="trades" tone="warn" />
        )}
      </div>

      {sym.sparkline_20 && sym.sparkline_20.length > 0 && (
        <Sparkline20 outcomes={sym.sparkline_20} />
      )}

      {sym.last_transition?.reason && (
        <div className={styles.cardReason}>
          <div className={`${styles.cardReasonLbl} ${reasonLblClass}`}>causa</div>
          <div className={`${styles.cardReasonTxt} prose`}>{sym.last_transition.reason}</div>
        </div>
      )}
      {sym.next_conditions && (
        <div className={styles.cardNext}>
          <div className={`${styles.cardNextLbl} label`}>cómo sale</div>
          <div className={`${styles.cardNextTxt} prose`}>{sym.next_conditions}</div>
        </div>
      )}

      {/* Verdict row */}
      {verdict && (
        <button
          type="button"
          className={[styles.verdict, verdictBgClass(verdict.stance)].filter(Boolean).join(' ')}
          onClick={() => onAskAgent(sym)}
        >
          <span className={styles.verdictAvatar}>◈</span>
          <span className={styles.verdictBody}>
            <span className={styles.verdictTag}>copiloto</span>
            <span className={`${styles.verdictText} prose`}>{verdict.text}</span>
          </span>
          <span
            className={`${styles.verdictCta} ${verdictCtaClass(verdict.stance)}`}
            onClick={(e) => { e.stopPropagation(); onAskAgent(sym); }}
          >
            {verdict.action} →
          </span>
        </button>
      )}

      <footer className={styles.cardFt}>
        <button className="btn btn--ghost btn--sm" onClick={() => onAskAgent(sym)}>◈ conversar</button>
        <button
          className={`btn btn--danger btn--sm ${styles.cardRelease}`}
          onClick={() => onNegotiateRelease(sym, verdict)}
        >forzar release →</button>
      </footer>
    </article>
  );
};

function verdictBgClass(stance: CardVerdict['stance']): string {
  if (stance === 'hold')        return styles.verdictHold;
  if (stance === 'optimistic')  return styles.verdictOptimistic;
  if (stance === 'consider')    return styles.verdictConsider;
  if (stance === 'chill')       return styles.verdictChill;
  return '';
}
function verdictCtaClass(stance: CardVerdict['stance']): string {
  if (stance === 'optimistic')  return styles.verdictCtaOptimistic;
  if (stance === 'chill')       return styles.verdictCtaChill;
  if (stance === 'hold')        return styles.verdictCtaHold;
  if (stance === 'consider')    return styles.verdictCtaConsider;
  return styles.verdictCtaNeutral;
}

const KsMetric: React.FC<{
  label:   string;
  value:   React.ReactNode;
  suffix?: string;
  tone:    'bull' | 'warn' | 'bear' | 'neutral';
}> = ({ label, value, suffix, tone }) => {
  const toneClass =
    tone === 'bull' ? styles.kmValBull :
    tone === 'warn' ? styles.kmValWarn :
    tone === 'bear' ? styles.kmValBear : styles.kmValNeutral;
  return (
    <div className={styles.km}>
      <span className={`${styles.kmLabel} label`}>{label}</span>
      <span className={`${styles.kmVal} ${toneClass} num`}>
        {value}
        {suffix && <span className={`${styles.kmSuf} prose`}> {suffix}</span>}
      </span>
    </div>
  );
};

// ── Sparkline ────────────────────────────────────────────────

const Sparkline20: React.FC<{ outcomes: Array<'W' | 'L' | null> }> = ({ outcomes }) => {
  const wins  = outcomes.filter((o) => o === 'W').length;
  const total = outcomes.filter((o) => o != null).length;
  return (
    <div className={styles.spark}>
      <div className={styles.sparkCells} role="img" aria-label={`últimos ${outcomes.length} trades`}>
        {outcomes.map((o, i) => {
          const cellClass =
            o === 'W' ? styles.sparkCellWin :
            o === 'L' ? styles.sparkCellLoss : styles.sparkCellEmpty;
          return <span key={i} className={`${styles.sparkCell} ${cellClass}`} />;
        })}
      </div>
      <div className={`${styles.sparkLegend} prose`}>
        últimos <span className="num">{outcomes.length}</span> · {wins}W / {total - wins}L
      </div>
    </div>
  );
};

// ── Normal summary (collapsed healthy list) ──────────────────

const NormalSummary: React.FC<{
  list:     DashboardSymbolState[];
  expanded: boolean;
  onToggle: () => void;
}> = ({ list, expanded, onToggle }) => {
  const totalTrades = list.reduce((a, s) => a + (s.metrics.trades_count_total ?? 0), 0);
  const totalPnl    = list.reduce((a, s) => a + (s.metrics.pnl_30d ?? 0), 0);
  return (
    <section className={styles.normal}>
      <header className={styles.normalHd} onClick={onToggle}>
        <div className={styles.normalGlyph}>✓</div>
        <div className={styles.normalTitleBlock}>
          <span className={styles.normalTitle}>SALUDABLES</span>
          <span className={styles.normalCount}>{list.length}</span>
          <span className={`${styles.normalSub} prose`}>
            — operativos sin restricciones · {totalTrades} trades · {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)} 30d
          </span>
        </div>
        <span className={styles.normalChev}>{expanded ? '▴' : '▾'}</span>
      </header>
      {expanded && (
        <div className={styles.normalList}>
          {list.map((s) => {
            const pnl30 = s.metrics.pnl_30d ?? 0;
            const wr20  = (s.metrics.win_rate_20_trades ?? 0) * 100;
            return (
              <div key={s.symbol} className={styles.normalRow}>
                <span className={styles.normalPair}>{s.symbol.replace('USDT', '')}</span>
                <span className={`${styles.normalWr} num`}>{wr20.toFixed(0)}%</span>
                <span className={`${styles.normalPnl} num ${pnl30 >= 0 ? styles.normalPnlBull : styles.normalPnlBear}`}>
                  {pnl30 >= 0 ? '+' : ''}${pnl30.toFixed(2)}
                </span>
                <span className={`${styles.normalTrades} prose`}>{s.metrics.trades_count_total} trades</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

// ── Transition timeline ──────────────────────────────────────

const TransitionTimeline: React.FC<{ transitions: DashboardPortfolioTransition[] }> = ({ transitions }) => {
  if (!transitions || transitions.length === 0) {
    return (
      <section className={styles.timeline}>
        <div className={`${styles.timelineHd} label`}>▸ Transiciones recientes</div>
        <div className={styles.timelineEmpty}>
          <div className={styles.timelineEmptyMark}>∅</div>
          <div className={styles.timelineEmptyTitle}>Sin intervenciones</div>
          <div className={`${styles.timelineEmptyBody} prose`}>El kill-switch lleva días sin tener que actuar. Buena señal.</div>
        </div>
      </section>
    );
  }
  return (
    <section className={styles.timeline}>
      <div className={`${styles.timelineHd} label`}>▸ Transiciones recientes</div>
      <ul className={styles.timelineList}>
        {transitions.map((t, i) => {
          const tt = tierTone(t.to_tier);
          const toClass =
            tt === 'bull' ? styles.timelineToBull :
            tt === 'warn' ? styles.timelineToWarn : styles.timelineToBear;
          const ageMs  = Date.now() - new Date(t.ts).getTime();
          const ageMin = Math.max(0, Math.floor(ageMs / 60000));
          const ago =
            ageMin < 60   ? `${ageMin} min` :
            ageMin < 1440 ? `${Math.floor(ageMin / 60)} h` :
                            `${Math.floor(ageMin / 1440)} d`;
          return (
            <li key={i} className={styles.timelineItem}>
              <div className={styles.timelineDot} />
              <div className={styles.timelineBody}>
                <div className={styles.timelineTitle}>
                  <span className={styles.timelineFrom}>{t.from_tier}</span>
                  <span className={styles.timelineArrow}>→</span>
                  <span className={toClass}>{t.to_tier}</span>
                </div>
                <div className={`${styles.timelineReason} prose`}>{t.reason}</div>
                <div className={`${styles.timelineWhen} prose`}>hace {ago}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default KillSwitchView;
