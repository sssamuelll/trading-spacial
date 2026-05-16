// ============================================================
// SymbolRow — compact horizontal row for the "Tranquilos" bucket.
// ============================================================

import React from 'react';
import styles from './SymbolRow.module.css';
import type { SymbolStatus } from '../types';
import { formatPrice } from '../utils';
import ScoreGrid from './atoms/ScoreGrid';
import TriggerPill from './atoms/TriggerPill';
import PriceSpark from './atoms/PriceSpark';
import { fakeScoreComponents } from '../helpers/hierarchy';

interface SymbolRowProps {
  symbol:   SymbolStatus;
  onClick?: () => void;
}

const SymbolRow: React.FC<SymbolRowProps> = ({ symbol, onClick }) => {
  const score = symbol.score   ?? 0;
  const lrc   = symbol.lrc_pct ?? 0;
  const lrcTone = lrc < 25 ? 'bull' : lrc > 75 ? 'bear' : 'warn';
  const components = fakeScoreComponents(score, 9);

  // tiny deterministic series for the in-row spark
  const seed = symbol.symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const series = Array.from({ length: 12 }, (_, i) => Math.sin((seed + i * 5) * 0.6) + i / 12);

  return (
    <div
      className={[styles.row, onClick ? styles.clickable : ''].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <div className={styles.pair}>
        <span className={styles.base}>{symbol.symbol.replace('USDT', '')}</span>
        <span className={styles.quote}>/USDT</span>
      </div>
      <div className={`${styles.price} num`}>
        <span className={styles.dollar}>$</span>{formatPrice(symbol.price)}
      </div>
      <div className={[styles.change, lrcTone === 'bull' ? styles.changeBull : styles.changeBear].join(' ')}>
        {lrcTone === 'bull' ? '▲' : '▼'} <span className="num">{lrc.toFixed(1)}%</span>
      </div>
      <PriceSpark data={series} width={56} height={16} />
      <div className={`${styles.lrc} ${styles[`lrc--${lrcTone}`]}`}>
        <span className="label">LRC</span>{' '}
        <span className="num">{lrc.toFixed(1)}%</span>
      </div>
      <div className={styles.score}>
        <ScoreGrid components={components} score={score} max={9} variant="big" size="sm" />
      </div>
      <div className={styles.trigger}>
        <TriggerPill on={symbol.gatillo} />
      </div>
      <button
        className="btn btn--ghost btn--sm"
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      >
        Detalle →
      </button>
    </div>
  );
};

export default SymbolRow;
