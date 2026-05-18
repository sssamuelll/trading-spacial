// ============================================================
// FocusPanel — "qué mirar ahora". Top-of-page strip of the most
// actionable items computed by helpers/hierarchy.ts.
// ============================================================

import React from 'react';
import styles from './FocusPanel.module.css';
import type { FocusItem, FocusKind } from '../helpers/hierarchy';

interface FocusPanelProps {
  items:      FocusItem[];
  onAction?:  (item: FocusItem) => void;
}

const toneMap: Record<FocusKind, 'bull' | 'bear' | 'warn'> = {
  'risk-position': 'bear',
  'fresh-signal':  'bull',
  'near-tp':       'bull',
  'kill-switch':   'warn',
  'error':         'bear',
};

const iconMap: Record<FocusKind, string> = {
  'risk-position': '⚠',
  'fresh-signal':  '◉',
  'near-tp':       '◆',
  'kill-switch':   '⏸',
  'error':         '×',
};

const FocusPanel: React.FC<FocusPanelProps> = ({ items, onAction }) => {
  if (!items || items.length === 0) {
    return (
      <section className={`${styles.focus} ${styles.empty}`}>
        <div className={styles.emptyMark}>∅</div>
        <div className={styles.emptyText}>
          <div className={styles.emptyTitle}>Todo tranquilo.</div>
          <div className={`${styles.emptyBody} prose`}>
            No hay setups firmes ni posiciones en riesgo ahora mismo. El escáner sigue corriendo cada 5 min.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.focus}>
      <div className={styles.header}>
        <div className={`${styles.label} label`}>▸ Foco · qué mirar ahora</div>
        <div className={`${styles.count} prose`}>
          {items.length} {items.length === 1 ? 'cosa' : 'cosas'} requieren tu atención
        </div>
      </div>
      <div className={styles.items}>
        {items.map((it, i) => {
          const tone = toneMap[it.kind];
          return (
            <article
              key={i}
              className={[styles.item, styles[`item--${tone}`]].join(' ')}
            >
              <div className={`${styles.glyph} ${styles[`glyph--${tone}`]}`}>{iconMap[it.kind]}</div>
              <div className={styles.body}>
                <div className={styles.title}>{it.title}</div>
                <div className={`${styles.sub} prose`}>{it.body}</div>
              </div>
              <div className={styles.action}>
                <button
                  className={`btn btn--${tone === 'bear' ? 'danger' : 'primary'} btn--sm`}
                  onClick={() => onAction?.(it)}
                >
                  {it.action} →
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default FocusPanel;
