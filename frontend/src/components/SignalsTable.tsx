// ============================================================
// SignalsTable.tsx — Recent signals (desktop table + mobile cards)
// ============================================================

import React from 'react';
import styles from './SignalsTable.module.css';
import type { Signal } from '../types';
import { timeAgo, formatPrice } from '../utils';
import SideBadge from './atoms/SideBadge';
import ScoreGrid from './atoms/ScoreGrid';
import { fakeScoreComponents } from '../helpers/hierarchy';

interface SignalsTableProps {
  signals: Signal[];
  loading: boolean;
  onOpenPosition?: (signal: Signal) => void;
  /** When true, render the mobile card layout. */
  mobile?: boolean;
  /** A signal is "fresh" when its ts is within `freshWithinMin` minutes. */
  freshWithinMin?: number;
}

function formatDatetime(ts: string): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function scoreNumTone(score: number): 'bull' | 'warn' | 'dim' {
  if (score >= 6) return 'bull';
  if (score >= 4) return 'warn';
  return 'dim';
}

function lrcTone(lrc: number): 'bull' | 'bear' | 'warn' {
  if (lrc < 25) return 'bull';
  if (lrc > 75) return 'bear';
  return 'warn';
}

function stateDescriptor(sig: Signal): { tone: 'bull' | 'warn' | 'dim'; label: string } {
  if (sig.señal) return { tone: 'bull', label: 'Setup válido' };
  if (sig.setup) return { tone: 'warn', label: 'Sin gatillo 5M' };
  return { tone: 'dim', label: sig.estado || '—' };
}

const SignalsTable: React.FC<SignalsTableProps> = ({
  signals, loading, onOpenPosition, mobile = false, freshWithinMin = 5,
}) => {
  const rows = signals.slice(0, 20);
  const now = Date.now();
  const isFresh = (sig: Signal) =>
    !!sig.ts && (now - new Date(sig.ts).getTime()) / 60_000 <= freshWithinMin;

  if (mobile) {
    return (
      <section className={styles.section}>
        <header className={styles.sectionHd}>
          <span className={`${styles.sectionLbl} label`}>▸ Señales recientes</span>
          <span className={styles.sectionCount}>{signals.length}</span>
        </header>
        {loading ? (
          <div className={styles.loading}>Cargando señales…</div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>Sin señales recientes</div>
        ) : (
          <div className={styles.cards}>
            {rows.map((sig) => (
              <article key={sig.id} className={[styles.card, isFresh(sig) ? styles.cardFresh : ''].filter(Boolean).join(' ')}>
                <div className={styles.cardRow1}>
                  <SideBadge side={sig.direction ?? 'LONG'} />
                  <span className={styles.cardPair}>{sig.symbol}</span>
                  <span className={`${styles.cardPrice} num`}>${formatPrice(sig.price)}</span>
                  <span className={`${styles.cardTime} prose`}>{timeAgo(sig.ts)}</span>
                </div>
                <div className={styles.cardRow2}>
                  <ScoreGrid
                    components={fakeScoreComponents(sig.score ?? 0, 9)}
                    score={sig.score ?? 0}
                    max={9}
                    variant="big"
                    size="sm"
                  />
                  <span className={`${styles.cardLrc} ${styles[`cardLrc--${lrcTone(sig.lrc_pct ?? 0)}`]}`}>
                    <span className="label">LRC</span>{' '}
                    <span className="num">{(sig.lrc_pct ?? 0).toFixed(1)}%</span>
                  </span>
                  <span className={`${styles.cardTrig} ${sig.gatillo ? styles.cardTrigOn : styles.cardTrigOff}`}>
                    {sig.gatillo ? '✓' : '✗'} TRIGGER
                  </span>
                  {onOpenPosition && sig.señal && (
                    <button
                      className="btn btn--primary btn--sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => onOpenPosition(sig)}
                    >+ Posición</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  // Desktop table
  return (
    <section className={styles.section}>
      <header className={styles.sectionHd}>
        <span className={`${styles.sectionLbl} label`}>▸ Señales recientes</span>
        <span className={styles.sectionCount}>{signals.length}</span>
      </header>

      {loading ? (
        <div className={styles.loading}>Cargando señales…</div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>Sin señales recientes</div>
      ) : (
        <div className={styles.tableWrap}>
          <div className={`${styles.head} label`}>
            <div>#</div>
            <div>Hace</div>
            <div>Par</div>
            <div>Dir</div>
            <div>Precio</div>
            <div>LRC%</div>
            <div>Score</div>
            <div>Estado</div>
            <div>Gatillo</div>
            {onOpenPosition && <div />}
          </div>
          {rows.map((sig, i) => {
            const sd = stateDescriptor(sig);
            const sn = scoreNumTone(sig.score ?? 0);
            const lt = lrcTone(sig.lrc_pct ?? 0);
            return (
              <div
                key={sig.id}
                className={[styles.row, isFresh(sig) ? styles.rowFresh : ''].filter(Boolean).join(' ')}
              >
                <div className={`${styles.idx} num`}>{String(i + 1).padStart(2, '0')}</div>
                <div className={`${styles.time} prose`} title={formatDatetime(sig.ts)}>{timeAgo(sig.ts)}</div>
                <div className={styles.pair}>{sig.symbol}</div>
                <div><SideBadge side={sig.direction ?? 'LONG'} /></div>
                <div className={`num ${styles.priceCell}`}>
                  <span className={styles.dollar}>$</span>{formatPrice(sig.price)}
                </div>
                <div className={`num ${styles[`lrc--${lt}`]}`}>{(sig.lrc_pct ?? 0).toFixed(1)}%</div>
                <div>
                  <span className={`num ${styles.scoreNum} ${styles[`scoreNum--${sn}`]}`}>
                    {sig.score ?? '—'}<span className={styles.scoreMax}>/9</span>
                  </span>
                </div>
                <div className={`${styles.state} prose`}>
                  <span className={`${styles.dot} ${styles[`dot--${sd.tone}`]}`} /> {sd.label}
                </div>
                <div className={styles.trig}>
                  {sig.gatillo
                    ? <span className={styles.trigYes}>✓</span>
                    : <span className={styles.trigNo}>✗</span>}
                </div>
                {onOpenPosition && (
                  <div className={styles.action}>
                    {sig.señal && (
                      <button
                        className="btn btn--primary btn--sm"
                        onClick={() => onOpenPosition(sig)}
                        title="Abrir posición desde esta señal"
                      >+ Posición</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default SignalsTable;
