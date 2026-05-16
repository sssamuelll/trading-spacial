// ============================================================
// StatusBar.tsx — dense horizontal strip of scanner metrics.
//
// Replaces the original 4 large metric cards. Reads the same
// `status.scanner_state` fields.
// ============================================================

import React from 'react';
import styles from './StatusBar.module.css';
import type { StatusResponse } from '../types';

interface StatusBarProps {
  status: StatusResponse | null;
}

interface ItemProps {
  label:   string;
  value:   string | number;
  suffix?: string;
  tone?:   'bull' | 'bear' | 'warn' | 'neutral' | 'dim';
  hint?:   string;
}
const Item: React.FC<ItemProps> = ({ label, value, suffix, tone = 'neutral', hint }) => (
  <div className={styles.item} title={hint}>
    <div className={`${styles.label} label`}>{label}</div>
    <div className={`${styles.value} ${styles[`value--${tone}`]}`}>
      <span className="num">{typeof value === 'number' ? value.toLocaleString('es-ES') : value}</span>
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </div>
  </div>
);

const StatusBar: React.FC<StatusBarProps> = ({ status }) => {
  const s = status?.scanner_state;

  const scansTotal   = s?.scans_total   ?? 0;
  const signalsTotal = s?.signals_total ?? 0;
  const errors       = s?.errors        ?? 0;
  const symActive    = s?.symbols_active ?? 0;
  const lastSymbol   = s?.last_symbol   ?? '—';

  return (
    <div className={styles.strip}>
      <Item
        label="Escaneos"
        value={scansTotal}
        suffix={` · ${signalsTotal} señales`}
        tone="neutral"
        hint="Total de ciclos de escaneo desde inicio"
      />
      <Item
        label="Señales"
        value={signalsTotal}
        tone={signalsTotal > 0 ? 'bull' : 'dim'}
        hint="Señales detectadas (gatillo 5M confirmado)"
      />
      <Item
        label="Errores"
        value={errors}
        tone={errors > 0 ? 'bear' : 'dim'}
        hint="Fallos en el último ciclo"
      />
      <Item
        label="Activos"
        value={symActive}
        tone="neutral"
        hint="Símbolos en la watch-list"
      />
      <Item
        label="Último par"
        value={lastSymbol}
        tone="dim"
        hint="Último símbolo escaneado"
      />
    </div>
  );
};

export default StatusBar;
