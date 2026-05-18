// ============================================================
// Ticker — horizontal scrolling tape of pair / price / 24h change.
//
// Marquee of the curated watchlist. The change column shows real 24h
// percent change (populated by useLiveTicker from Binance /ticker/24hr),
// not the LRC% proxy we used pre-redesign.
// ============================================================

import React from 'react';
import styles from './Ticker.module.css';
import type { SymbolStatus } from '../types';
import { formatPrice } from '../utils';

interface TickerProps {
  symbols: SymbolStatus[];
  animate?: boolean;
  onSymbolClick?: (s: SymbolStatus) => void;
}

const Ticker: React.FC<TickerProps> = ({ symbols, animate = true, onSymbolClick }) => {
  if (!symbols || symbols.length === 0) return null;
  // Duplicate the list so the marquee can loop seamlessly via translateX(-50%).
  const items = [...symbols, ...symbols];
  return (
    <div className={[styles.ticker, animate ? '' : styles.paused].filter(Boolean).join(' ')}>
      <div className={styles.brand}>▸ tape</div>
      <div className={styles.viewport}>
        <div className={styles.track}>
          {items.map((s, i) => {
            const chg = s.change_24h;
            const hasChg = chg != null;
            const isUp = hasChg && chg >= 0;
            const clickable = !!onSymbolClick;
            return (
              <span
                key={`${s.symbol}-${i}`}
                className={[styles.item, clickable ? styles.clickable : ''].filter(Boolean).join(' ')}
                onClick={clickable ? () => onSymbolClick(s) : undefined}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onSymbolClick(s); } : undefined}
                title={clickable ? `Ver gráfico ${s.symbol}` : undefined}
              >
                <span className={styles.pair}>{s.symbol.replace('USDT', '')}</span>
                <span className={`num ${styles.price}`}>${formatPrice(s.live_price ?? s.price)}</span>
                <span className={`${styles.chg} ${hasChg ? (isUp ? styles.chgBull : styles.chgBear) : styles.chgDim}`}>
                  {hasChg
                    ? <>
                        {isUp ? '▲' : '▼'}{' '}
                        <span className="num">{(isUp ? '+' : '') + chg.toFixed(2)}%</span>
                      </>
                    : <span className="num">—</span>}
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
