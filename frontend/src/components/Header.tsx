// ============================================================
// Header.tsx — dense terminal-style header.
//
// Layout (desktop): brand · LIVE · telemetry · cmdbar · actions · user
// Mobile: collapsed to brand + LIVE pill + scan + bell.
//
// The bell and user-block trigger NotificationBell and UserMenu
// respectively (managed in App.tsx). The gear opens ConfigPanel.
// ============================================================

import React from 'react';
import styles from './Header.module.css';
import type { StatusResponse } from '../types';
import type { AuthUser } from './../auth/api';
import HeartbeatDot from './atoms/HeartbeatDot';
import ScanProgressBar from './atoms/ScanProgressBar';
import CommandBar from './CommandBar';

// SVG icons — inline so they hit currentColor cleanly
const BellIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter">
    <path d="M3 12 v-3 a5 5 0 0 1 10 0 v3 l1.5 1.5 H1.5 Z" fill="none" />
    <path d="M6.5 13.5 a1.5 1.5 0 0 0 3 0" fill="none" />
  </svg>
);
const GearIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter">
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1 v2 M8 13 v2 M1 8 h2 M13 8 h2 M3 3 l1.5 1.5 M11.5 11.5 L13 13 M13 3 l-1.5 1.5 M4.5 11.5 L3 13" />
  </svg>
);
const TuneIcon: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
    <path d="M2 4 H14 M2 8 H10 M2 12 H12" strokeLinecap="square" />
    <circle cx="11" cy="4" r="1.5" fill="currentColor" />
    <circle cx="6"  cy="8" r="1.5" fill="currentColor" />
    <circle cx="13" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

function formatTime(date: Date | null): string {
  if (!date) return '—:—:—';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Compact uptime label from an ISO timestamp. "7d 14h" / "3h 22m" / "47s". */
function formatUptime(startedAt: string | null | undefined, nowMs: number): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '—';
  const sec = Math.max(0, Math.floor((nowMs - start) / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

/** Map backend role IDs to human-facing UI labels. */
function roleLabel(role: string | null | undefined): string {
  if (!role) return '';
  const r = role.toLowerCase();
  if (r === 'admin')  return 'operador';
  if (r === 'viewer') return 'observador';
  return r;
}

interface HeaderProps {
  status:        StatusResponse | null;
  user:          AuthUser | null;
  scanning:      boolean;
  lastRefresh:   Date | null;
  scanProgress:  number;
  secsLeft:      number;
  heartbeatOn?:  boolean;
  unreadCount:   number;
  hasPendingTune: boolean;

  onRefresh:     () => void;
  onScan:        () => void;
  onConfigOpen:  () => void;
  onTuneOpen:    () => void;
  onBellClick:   () => void;
  onUserClick:   () => void;

  notifsOpen:    boolean;
  settingsOpen:  boolean;
  userOpen:      boolean;

  /** When true, render the mobile-collapsed variant. */
  mobile?: boolean;
}

const Header: React.FC<HeaderProps> = (props) => {
  if (props.mobile) return <HeaderMobile {...props} />;

  const {
    status, user, scanning, lastRefresh, scanProgress, secsLeft, heartbeatOn = true,
    unreadCount, hasPendingTune,
    onRefresh, onScan, onConfigOpen, onTuneOpen, onBellClick, onUserClick,
    notifsOpen, settingsOpen, userOpen,
  } = props;
  const running = status?.scanner_state?.running ?? false;
  const scanner = status?.scanner_state;

  return (
    <header className={styles.hdr}>
      <ScanProgressBar progress={scanProgress} animate={heartbeatOn} />

      <div className={styles.main}>
        {/* Brand */}
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="1" y="1" width="18" height="18" stroke="currentColor" strokeWidth="1" />
              <rect x="5" y="5" width="10" height="10" fill="currentColor" opacity="0.85" />
              <rect x="8" y="8" width="4"  height="4"  fill="var(--nbc-bg)" />
            </svg>
          </div>
          <div className={styles.brandText}>
            <div className={styles.brandTitle}>
              crypto<span className={styles.brandSlash}>/</span>scanner
            </div>
            <div className={styles.brandSub}>v6 · 5m · multi-tf</div>
          </div>
        </div>

        <div className={styles.divider} />

        {/* LIVE + countdown */}
        <div className={styles.live}>
          <HeartbeatDot active={heartbeatOn && running} />
          <span className={styles.liveLabel}>{running ? 'live' : 'offline'}</span>
          <span className={`${styles.liveTime} num`}>{formatTime(lastRefresh)}</span>
          <span className={styles.liveSep}>·</span>
          <span className={styles.liveNext}>
            next <span className="num">{String(secsLeft).padStart(2, '0')}s</span>
          </span>
        </div>

        <div className={styles.divider} />

        {/* Telemetry */}
        <div className={styles.telemetry}>
          <TeleStat label="scans"   value={scanner?.scans_total   ?? '—'} />
          <TeleStat label="signals" value={scanner?.signals_total ?? '—'} tone="bull" />
          <TeleStat label="err"     value={scanner?.errors        ?? '—'} tone={(scanner?.errors ?? 0) > 0 ? 'bear' : 'dim'} />
          <TeleStat label="uptime"  value={formatUptime(scanner?.started_at, Date.now())} tone="neutral" />
        </div>

        {/* Command bar */}
        <CommandBar />

        {/* Actions */}
        <div className={styles.actions}>
          <button
            className={`btn btn--ghost btn--sm`}
            onClick={onRefresh}
            disabled={scanning}
            title="Actualizar"
          >
            <span className="btn__icon">↻</span> refresh
          </button>
          <button
            className={`btn btn--primary btn--sm`}
            onClick={onScan}
            disabled={scanning}
            title="Forzar escaneo"
          >
            <span className="btn__caret">▸</span> {scanning ? 'scanning…' : 'scan now'}
          </button>

          {hasPendingTune && (
            <button
              className={`btn btn--ghost btn--icon ${styles.tuneBadge}`}
              onClick={onTuneOpen}
              title="Parámetros optimizados pendientes de revisión"
              aria-label="Auto-tune"
            >
              <TuneIcon />
              <span className={styles.tuneDot} />
            </button>
          )}

          <button
            className={`btn btn--ghost btn--icon ${notifsOpen ? 'btn--active' : ''}`}
            onClick={onBellClick}
            title="Notificaciones"
            aria-expanded={notifsOpen}
          >
            <BellIcon />
            {unreadCount > 0 && (
              <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
            )}
          </button>

          <button
            className={`btn btn--ghost btn--icon ${settingsOpen ? 'btn--active' : ''}`}
            onClick={onConfigOpen}
            title="Ajustes"
            aria-expanded={settingsOpen}
          >
            <GearIcon />
          </button>

          {user && (
            <button
              className={[styles.user, userOpen ? styles.userActive : ''].filter(Boolean).join(' ')}
              onClick={onUserClick}
              aria-expanded={userOpen}
              title={`Sesión iniciada como ${user.email}`}
            >
              <div className={styles.userDot} />
              <div className={styles.userText}>
                <div className={styles.userEmail}>{user.email}</div>
                <div className={styles.userRole}>{roleLabel(user.role)}</div>
              </div>
              <span className={styles.userChev}>▾</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

// ---- Telemetry stat ----

interface TeleStatProps {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'bull' | 'bear' | 'warn' | 'dim';
}
const TeleStat: React.FC<TeleStatProps> = ({ label, value, tone = 'neutral' }) => (
  <div className={`${styles.tele} ${styles[`tele--${tone}`]}`}>
    <span className={styles.teleLabel}>{label}</span>
    <span className={`${styles.teleValue} num`}>
      {typeof value === 'number' ? value.toLocaleString('es-ES') : value}
    </span>
  </div>
);

// ---- Mobile variant ----

const HeaderMobile: React.FC<HeaderProps> = ({
  status, scanning, scanProgress, secsLeft, heartbeatOn = true,
  unreadCount, onScan, onBellClick, notifsOpen,
}) => {
  const running = status?.scanner_state?.running ?? false;
  return (
    <header className={`${styles.hdr} ${styles.hdrMobile}`}>
      <ScanProgressBar progress={scanProgress} animate={heartbeatOn} />
      <div className={styles.main}>
        <div className={styles.brand}>
          <div className={styles.mark} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <rect x="1" y="1" width="18" height="18" stroke="currentColor" strokeWidth="1" />
              <rect x="5" y="5" width="10" height="10" fill="currentColor" />
              <rect x="8" y="8" width="4" height="4" fill="var(--nbc-bg)" />
            </svg>
          </div>
          <div className={styles.brandText}>
            <div className={styles.brandTitle}>crypto/scanner</div>
          </div>
        </div>
        <div className={`${styles.live} ${styles.liveMini}`}>
          <HeartbeatDot active={heartbeatOn && running} />
          <span className="num">{secsLeft}s</span>
        </div>
        <button className="btn btn--primary btn--sm" onClick={onScan} disabled={scanning}>
          {scanning ? '…' : 'scan'}
        </button>
        <button
          className={`btn btn--ghost btn--icon ${notifsOpen ? 'btn--active' : ''}`}
          onClick={onBellClick}
          title="Notificaciones"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span className={styles.badge}>{unreadCount > 99 ? '99+' : unreadCount}</span>
          )}
        </button>
      </div>
    </header>
  );
};

export default Header;
