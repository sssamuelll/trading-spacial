// ============================================================
// StatusPill — composite signal-state pill.
//
// Replaces the previous TriggerPill, which only reflected `gatillo`
// in isolation. A naked gatillo is meaningless: 5m bars confirm
// reversal patterns constantly without the bigger picture (setup +
// macro) being aligned. Showing TRIGGER ✓ for every symbol was
// misleading — users thought the system was about to fire.
//
// This pill shows where each symbol sits in the gate chain:
//
//   señal=1                          → SIGNAL   (cyan, fireable)
//   estado contains 'BLOQUEADA'      → BLOQUEADA(bear)
//   setup=1 && gatillo=1 && !señal   → ARMADO   (cyan, near-fire)
//   setup=1                          → SETUP    (warn)
//   else                             → SIN SETUP (dim)
//
// ============================================================

import React from 'react';
import styles from './StatusPill.module.css';

interface StatusPillProps {
  señal:   boolean;
  setup:   boolean;
  gatillo: boolean;
  estado?: string;
}

type State = 'signal' | 'blocked' | 'armed' | 'setup' | 'idle';

function pickState({ señal, setup, gatillo, estado }: StatusPillProps): State {
  if (señal) return 'signal';
  if (estado && estado.toUpperCase().includes('BLOQUEAD')) return 'blocked';
  if (setup && gatillo) return 'armed';
  if (setup) return 'setup';
  return 'idle';
}

const LABEL: Record<State, string> = {
  signal:  'SIGNAL',
  blocked: 'BLOQUEADA',
  armed:   'ARMADO',
  setup:   'SETUP',
  idle:    'SIN SETUP',
};

const ICON: Record<State, string> = {
  signal:  '●',
  blocked: '×',
  armed:   '▸',
  setup:   '○',
  idle:    '·',
};

const StatusPill: React.FC<StatusPillProps> = (props) => {
  const state = pickState(props);
  return (
    <span className={`${styles.pill} ${styles[`pill--${state}`]}`}>
      <span className={styles.icon}>{ICON[state]}</span>
      {LABEL[state]}
    </span>
  );
};

export default StatusPill;
