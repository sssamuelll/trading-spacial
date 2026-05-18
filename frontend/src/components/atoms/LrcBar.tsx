// ============================================================
// LrcBar — engineered ruler showing where LRC% sits.
// Sweet spot 25-75% (the bullish zone where price is mid-channel).
// ============================================================

import React from 'react';
import styles from './LrcBar.module.css';

interface LrcBarProps {
  /** 0..100 LRC% from backend */
  value: number;
}

const LrcBar: React.FC<LrcBarProps> = ({ value }) => {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={styles.bar} aria-hidden="true">
      <div className={styles.track}>
        <div className={styles.zone} style={{ left: '25%', width: '50%' }} />
      </div>
      <div className={styles.pointer} style={{ left: `${clamped}%` }} />
    </div>
  );
};

export default LrcBar;
