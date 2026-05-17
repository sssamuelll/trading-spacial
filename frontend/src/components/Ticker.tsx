// ============================================================
// Ticker — horizontal scrolling tape of price/change for all pairs.
// ============================================================

import React from 'react';
import styles from './Ticker.module.css';
import type { SymbolStatus } from '../types';
import { formatPrice } from '../utils';

interface TickerProps {
  symbols: SymbolStatus[];
  animate?: boolean;
}

const Ticker: React.FC<TickerProps> = ({ symbols, animate = true }) => {
  if (!symbols || symbols.length === 0) return null;
  // duplicate the list so the marquee can loop seamlessly via translateX(-50%)
  const items = [...symbols, ...symbols];
  return (
    <div className={[styles.ticker, animate ? '' : styles.paused].filter(Boolean).join(' ')}>
      <div className={styles.brand}>▸ tape</div>
      <div className={styles.viewport}>
        <div className={styles.track}>
          {items.map((s, i) => {
            const lrc = s.lrc_pct ?? 0;
            // Use lrc_pct's sign as our "change indicator" proxy until the
            // backend exposes a real 24h-change field. lrc <= 25 = bullish.
            const isUp = lrc <= 25;
            return (
              <span key={`${s.symbol}-${i}`} className={styles.item}>
                <span className={styles.pair}>{s.symbol.replace('USDT', '')}</span>
                <span className={`num ${styles.price}`}>${formatPrice(s.live_price ?? s.price)}</span>
                <span className={`${styles.chg} ${isUp ? styles.chgBull : styles.chgBear}`}>
                  {isUp ? '▲' : '▼'} <span className="num">{lrc.toFixed(1)}%</span>
                </span>
                <span className={styles.sep}>·</span>
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Ticker;
