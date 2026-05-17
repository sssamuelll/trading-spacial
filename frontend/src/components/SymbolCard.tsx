// ============================================================
// SymbolCard.tsx — featured / standard variants for the bucketed
// watchlist. Renders price + LRC bar + ScoreGrid + trigger pill.
// ============================================================

import React from 'react';
import styles from './SymbolCard.module.css';
import type { SymbolStatus } from '../types';
import { formatPrice, timeAgo } from '../utils';
import ScoreGrid, { type ScoreVariant } from './atoms/ScoreGrid';
import LrcBar from './atoms/LrcBar';
import SideBadge from './atoms/SideBadge';
import TriggerPill from './atoms/TriggerPill';
import PriceSpark from './atoms/PriceSpark';
import { fakeScoreComponents } from '../helpers/hierarchy';

interface SymbolCardProps {
  symbol:      SymbolStatus;
  featured?:   boolean;
  scoreStyle?: ScoreVariant;
  fresh?:      boolean;
  onClick?:    () => void;
}

function splitPair(sym: string): { base: string; quote: string } {
  const quotes = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'BUSD'];
  for (const q of quotes) {
    if (sym.endsWith(q)) return { base: sym.slice(0, -q.length), quote: q };
  }
  return { base: sym.slice(0, -4), quote: sym.slice(-4) };
}

function toneOfScore(score: number): 'bull' | 'warn' | 'dim' {
  if (score >= 5) return 'bull';
  if (score >= 3) return 'warn';
  return 'dim';
}
function toneOfLrc(lrc: number): 'bull' | 'warn' | 'bear' {
  if (lrc < 25) return 'bull';
  if (lrc > 75) return 'bear';
  return 'warn';
}

const SymbolCard: React.FC<SymbolCardProps> = ({
  symbol, featured = false, scoreStyle = 'grid', fresh = false, onClick,
}) => {
  const { base, quote } = splitPair(symbol.symbol);
  const score = symbol.score   ?? 0;
  const lrc   = symbol.lrc_pct ?? 0;
  const tone  = toneOfScore(score);
  const lrcTone = toneOfLrc(lrc);
  const components = fakeScoreComponents(score, 9);
  const side = symbol.direction ?? (symbol.señal ? 'LONG' : 'LONG');

  return (
    <article
      onClick={onClick}
      className={[
        styles.sym,
        featured ? styles.featured : styles.standard,
        styles[`sym--${tone}`],
        fresh ? styles.fresh : '',
        onClick ? styles.clickable : '',
      ].filter(Boolean).join(' ')}
      title={onClick ? 'Ver gráfico' : undefined}
    >
      {fresh && (
        <div className={styles.freshFlag}>
          NUEVO · {symbol.ts ? timeAgo(symbol.ts).replace('hace ', '') : 'ahora'}
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.pair}>
          <span className={styles.pairBase}>{base}</span>
          <span className={styles.pairQuote}>/{quote}</span>
        </div>
        <div className={styles.headerRight}>
          {symbol.señal && <SideBadge side={side} />}
          {symbol.señal
            ? <span className={`${styles.setup} ${styles[`setup--${tone}`]}`}>SETUP</span>
            : symbol.gatillo
              ? <span className={`${styles.setup} ${styles[`setup--warn`]}`}>SETUP</span>
              : <span className={`${styles.setup} ${styles[`setup--dim`]}`}>—</span>}
        </div>
      </header>

      <div className={styles.priceRow}>
        <div className={styles.price}>
          <span className={styles.dollar}>$</span>
          <span className="num">{formatPrice(symbol.live_price ?? symbol.price)}</span>
        </div>
        <div className={[
          styles.change,
          lrcTone === 'bull' ? styles.changeBull : styles.changeBear,
        ].join(' ')}>
          {lrcTone === 'bull' ? '▲' : '▼'}{' '}
          <span className="num">{lrc.toFixed(1)}%</span>
        </div>
        {/* Real-time sparkline. Data is the rolling buffer accumulated by
            `useLiveTicker` (one sample per ~3s ticker poll). Empty on first
            mount; grows over the session. */}
        <PriceSpark
          data={symbol.recent_closes ?? []}
          width={featured ? 88 : 64}
          height={featured ? 26 : 20}
        />
      </div>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <div className={`${styles.metricLabel} label`}>LRC%</div>
          <div className={`${styles.metricVal} ${styles[`metricVal--${lrcTone}`]}`}>
            <span className="num">{lrc.toFixed(1)}%</span>
          </div>
          <LrcBar value={lrc} />
        </div>

        <div className={`${styles.metric} ${styles.metricScore}`}>
          <div className={`${styles.metricLabel} label`}>SCORE</div>
          <ScoreGrid
            components={components}
            score={score}
            max={9}
            variant={scoreStyle}
            size={featured ? 'lg' : 'md'}
          />
        </div>
      </div>

      <footer className={styles.footer}>
        <TriggerPill on={symbol.gatillo} />
        <span className={`${styles.lastUpdated} prose`}>
          {symbol.ts ? timeAgo(symbol.ts) : '—'}
        </span>
        {featured && onClick && (
          <button
            className={`btn btn--primary btn--sm ${styles.cta}`}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
          >
            Abrir posición →
          </button>
        )}
      </footer>
    </article>
  );
};

export default SymbolCard;
