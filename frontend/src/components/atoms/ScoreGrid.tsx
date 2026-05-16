// ============================================================
// ScoreGrid — 3-column grid of filled/empty cells + headline.
// Variants: 'grid' (default), 'bar', 'big'
// ============================================================

import React from 'react';
import styles from './ScoreGrid.module.css';

export type ScoreVariant = 'grid' | 'bar' | 'big';
export type ScoreSize    = 'sm' | 'md' | 'lg';

interface ScoreGridProps {
  /** 0/1 array, one entry per component */
  components: number[];
  /** Headline score (usually equals sum of components) */
  score: number;
  /** Max score on the dial (default 9 — v6 backend uses 0..9) */
  max?: number;
  variant?: ScoreVariant;
  size?: ScoreSize;
  /** Optional cell labels (for tooltips) */
  cellLabels?: Array<{ label: string; plain: string }>;
}

function toneOf(score: number, max: number): 'bull' | 'warn' | 'dim' {
  const ratio = score / Math.max(1, max);
  if (ratio >= 0.55) return 'bull';
  if (ratio >= 0.33) return 'warn';
  return 'dim';
}

const ScoreGrid: React.FC<ScoreGridProps> = ({
  components, score, max = 9, variant = 'grid', size = 'md', cellLabels,
}) => {
  const tone = toneOf(score, max);

  if (variant === 'big') {
    return (
      <div className={`${styles.big} ${styles[`big--${tone}`]} ${styles[`big--${size}`]}`}>
        <span className={`num ${styles.bigNum}`}>{score}</span>
        <span className={styles.bigMax}>/{max}</span>
      </div>
    );
  }

  if (variant === 'bar') {
    return (
      <div className={styles.bar}>
        {components.map((c, i) => (
          <div
            key={i}
            className={[
              styles.barCell,
              c ? styles.barCellOn : styles.barCellOff,
              styles[`barCell--${tone}`],
            ].join(' ')}
          />
        ))}
        <div className={`${styles.barNum} ${styles[`barNum--${tone}`]}`}>
          <span className="num">{score}</span>
          <span className={styles.barMax}>/{max}</span>
        </div>
      </div>
    );
  }

  // grid (default)
  return (
    <div className={`${styles.grid} ${styles[`grid--${size}`]}`}>
      <div
        className={styles.gridCells}
        role="img"
        aria-label={`Score ${score} de ${max}`}
      >
        {components.map((c, i) => {
          const lbl = cellLabels?.[i];
          return (
            <div
              key={i}
              className={[
                styles.gridCell,
                c ? styles.gridCellOn : styles.gridCellOff,
                styles[`gridCell--${tone}`],
              ].join(' ')}
              title={lbl ? `${lbl.label} — ${lbl.plain}: ${c ? 'sí' : 'no'}` : undefined}
            >
              {!c && <span className={styles.gridOffMark}>·</span>}
            </div>
          );
        })}
      </div>
      <div className={`${styles.gridNum} ${styles[`gridNum--${tone}`]}`}>
        <span className="num">{score}</span>
        <span className={styles.gridMax}>/{max}</span>
      </div>
    </div>
  );
};

export default ScoreGrid;
