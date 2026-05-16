// ============================================================
// TriggerPill — ✓ / ✗ TRIGGER pill.
// ============================================================

import React from 'react';
import styles from './TriggerPill.module.css';

interface TriggerPillProps {
  on: boolean;
}

const TriggerPill: React.FC<TriggerPillProps> = ({ on }) => {
  return (
    <span className={`${styles.pill} ${on ? styles.on : styles.off}`}>
      {on ? '✓' : '✗'} TRIGGER
    </span>
  );
};

export default TriggerPill;
