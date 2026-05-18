// ============================================================
// NotificationBell.tsx — dropdown rendered from the header.
//
// Design departure from v1: the bell ICON is now part of Header.tsx
// (so it can sit cleanly in the action row), and this file owns the
// dropdown body itself plus the polling/state. The dropdown anchors
// to the top-right of the viewport and dismisses on backdrop click.
//
// The component now accepts `open` + `onClose` from its parent so
// the bell <-> gear <-> user-menu state can be coordinated (only one
// open at a time).
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import styles from './NotificationBell.module.css';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../api';
import type { Notification } from '../types';

const POLL_INTERVAL_MS = 30_000;

// ─── helpers ─────────────────────────────────────────────────

type Tone = 'bull' | 'warn' | 'bear' | 'info' | 'dim';

function toneOf(ev: Notification): Tone {
  if (ev.priority === 'critical') return 'bear';
  if (ev.priority === 'warning')  return 'warn';
  if (ev.event_type === 'signal') return 'bull';
  if (ev.event_type === 'position_exit') return 'info';
  return 'dim';
}

function glyphOf(ev: Notification): string {
  if (ev.event_type === 'signal')        return '◉';
  if (ev.event_type === 'position_exit') return '◆';
  if (ev.event_type === 'health') {
    try {
      const p = JSON.parse(ev.payload_json);
      if (p.to_state === 'PAUSED')   return '⏸';
      if (p.to_state === 'REDUCED')  return '◐';
      if (p.to_state === 'ALERT')    return '⚠';
    } catch { /* fall through */ }
    return '·';
  }
  if (ev.event_type === 'infra')  return '⚠';
  if (ev.event_type === 'system') return '⚙';
  return '·';
}

interface ParsedSignal {
  symbol?:    string;
  score?:     number;
  direction?: 'LONG' | 'SHORT' | string;
}
function parseSignal(ev: Notification): ParsedSignal | null {
  if (ev.event_type !== 'signal') return null;
  try { return JSON.parse(ev.payload_json) as ParsedSignal; } catch { return null; }
}

function summary(ev: Notification): string {
  try {
    const p = JSON.parse(ev.payload_json);
    if (ev.event_type === 'signal') {
      return `score ${p.score ?? '?'} · LRC ${p.lrc_pct?.toFixed?.(1) ?? '?'}%`;
    }
    if (ev.event_type === 'health') {
      return `${p.from_state ?? ''} → ${p.to_state ?? ''} · ${p.reason ?? ''}`;
    }
    if (ev.event_type === 'position_exit') {
      const pnl = typeof p.pnl_usd === 'number' ? p.pnl_usd.toFixed(2) : '?';
      return `${p.exit_reason ?? ''} · P&L $${pnl}`;
    }
    if (ev.event_type === 'infra') {
      return `${p.component ?? '?'}: ${p.message ?? ''}`;
    }
    if (ev.event_type === 'system') {
      return `${p.kind ?? '?'}: ${p.message ?? ''}`;
    }
  } catch { /* fall through */ }
  return ev.event_key;
}

function titleOf(ev: Notification): string {
  if (ev.event_type === 'signal')        return 'Señal detectada';
  if (ev.event_type === 'health')        return 'Kill-switch';
  if (ev.event_type === 'position_exit') return 'Posición cerrada';
  if (ev.event_type === 'infra')         return 'Infraestructura';
  if (ev.event_type === 'system')        return 'Sistema';
  return ev.event_key;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ─── component ───────────────────────────────────────────────

type FilterTab = 'all' | 'signals' | 'system';

interface NotificationBellProps {
  open:    boolean;
  onClose: () => void;
  /** Called whenever the unread count changes — parent uses it to
   *  drive the bell-icon badge in the header. */
  onUnreadChange?: (count: number) => void;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ open, onClose, onUnreadChange }) => {
  const [items, setItems]     = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter]   = useState<FilterTab>('all');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await getNotifications({ unread: true, limit: 50 });
      const next = resp.notifications ?? [];
      setItems(next);
      onUnreadChange?.(next.length);
    } catch (err) {
      // Silent: bell should never crash the header.
      console.warn('NotificationBell refresh failed', err);
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const handleRead = async (id: number) => {
    try {
      await markNotificationRead(id);
      setItems((prev) => {
        const next = prev.filter((n) => n.id !== id);
        onUnreadChange?.(next.length);
        return next;
      });
    } catch (err) {
      console.warn('markNotificationRead failed', err);
    }
  };

  const handleReadAll = async () => {
    try {
      await markAllNotificationsRead();
      setItems([]);
      onUnreadChange?.(0);
    } catch (err) {
      console.warn('markAllNotificationsRead failed', err);
    }
  };

  if (!open) return null;

  const filtered = items.filter((n) => {
    if (filter === 'all')     return true;
    if (filter === 'signals') return n.event_type === 'signal';
    if (filter === 'system')  return n.event_type !== 'signal';
    return true;
  });

  const sigCount = items.filter((n) => n.event_type === 'signal').length;
  const sysCount = items.filter((n) => n.event_type !== 'signal').length;
  const unreadCount = items.length;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <div className={styles.dd} role="dialog" aria-label="Notificaciones">

        <header className={styles.hd}>
          <div className={styles.hdTitle}>
            <span className={styles.hdName}>Notificaciones</span>
            {unreadCount > 0 && <span className={styles.hdCount}>{unreadCount}</span>}
          </div>
          <div className={styles.hdActions}>
            {unreadCount > 0 && (
              <button className={styles.hdBtn} onClick={handleReadAll}>
                Marcar todas leídas
              </button>
            )}
            <button className={styles.hdClose} onClick={onClose} aria-label="Cerrar">×</button>
          </div>
        </header>

        <div className={styles.filter}>
          <FilterChip active={filter === 'all'}     count={unreadCount} onClick={() => setFilter('all')}    >Todas</FilterChip>
          <FilterChip active={filter === 'signals'} count={sigCount}    onClick={() => setFilter('signals')}>Señales</FilterChip>
          <FilterChip active={filter === 'system'}  count={sysCount}    onClick={() => setFilter('system')} >Sistema</FilterChip>
        </div>

        <div className={styles.list}>
          {loading && filtered.length === 0 && (
            <div className={styles.empty}>Cargando…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className={styles.empty}>
              <div className={styles.emptyMark}>∅</div>
              <div>Sin novedades aquí.</div>
            </div>
          )}
          {filtered.map((ev) => {
            const tone = toneOf(ev);
            const sig  = parseSignal(ev);
            return (
              <article
                key={ev.id}
                className={[styles.item, styles[`item--${tone}`], styles.itemUnread].filter(Boolean).join(' ')}
              >
                <div className={styles.itemBar} />
                <div className={`${styles.itemGlyph} ${styles[`itemGlyph--${tone}`]}`}>
                  {glyphOf(ev)}
                </div>
                <div className={styles.itemBody}>
                  <div className={styles.itemTitle}>
                    {sig ? (
                      <>
                        <span className={styles.itemPair}>{sig.symbol}</span>
                        <span className={styles.itemSep}>·</span>
                        <span className={styles.itemMeta}>score <span className="num">{sig.score ?? '?'}</span></span>
                        <span className={styles.itemSep}>·</span>
                        <span className={`${styles.itemSide} ${sig.direction === 'SHORT' ? styles.itemSideBear : styles.itemSideBull}`}>
                          {sig.direction === 'SHORT' ? '▼ SHORT' : '▲ LONG'}
                        </span>
                      </>
                    ) : (
                      <span>{titleOf(ev)}</span>
                    )}
                  </div>
                  <div className={`${styles.itemSub} prose`}>{summary(ev)}</div>
                </div>
                <div className={styles.itemRight}>
                  <span className={`${styles.itemTime} num`}>{formatTime(ev.sent_at)}</span>
                  <button
                    className={styles.itemAck}
                    onClick={() => handleRead(ev.id)}
                    title="Marcar leída"
                    aria-label="Marcar como leída"
                  >✓</button>
                </div>
              </article>
            );
          })}
        </div>

        <footer className={styles.ft}>
          <span className={`${styles.ftHint} prose`}>
            Las señales se generan cada 5 min · Telegram cuando pasan los filtros
          </span>
        </footer>
      </div>
    </>
  );
};

// ─── filter chip ───

interface FilterChipProps {
  active:   boolean;
  count:    number;
  children: React.ReactNode;
  onClick:  () => void;
}
const FilterChip: React.FC<FilterChipProps> = ({ active, count, children, onClick }) => (
  <button
    className={[styles.chip, active ? styles.chipActive : ''].filter(Boolean).join(' ')}
    onClick={onClick}
  >
    {children} <span className="num">{count}</span>
  </button>
);

export default NotificationBell;
