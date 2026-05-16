// ============================================================
// SideBadge — L / S pill with shape backup for colorblind users.
// ============================================================

import React from 'react';
import styles from './SideBadge.module.css';

interface SideBadgeProps {
  side: 'LONG' | 'SHORT' | 'L' | 'S' | string;
}

const SideBadge: React.FC<SideBadgeProps> = ({ side }) => {
  const isLong = side === 'LONG' || side === 'L';
  return (
    <span className={`${styles.badge} ${isLong ? styles.long : styles.short}`}>
      <span className={styles.shape} aria-hidden="true">
        {isLong ? '▲' : '▼'}
      </span>
      <span className={styles.letter}>{isLong ? 'L' : 'S'}</span>
    </span>
  );
};

export default SideBadge;
