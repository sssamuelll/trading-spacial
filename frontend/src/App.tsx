// ============================================================
// App.tsx — Main application component (redesigned layout)
//
// Layout:
//   ┌──────────────────────────────────────────────┐
//   │  Header                                       │
//   ├──────────────────────────────────────────────┤
//   │  Ticker tape                                  │
//   ├──────┬───────────────────────────────────────┤
//   │      │  Page bar · StatusBar · Focus          │
//   │ Rail │  Watchlist (Setups · Watching · Quiet) │
//   │      │  SignalsTable                          │
//   └──────┴───────────────────────────────────────┘
//
// Overlays (top-level, anchored to viewport):
//   - NotificationBell dropdown
//   - ConfigPanel slide-out
//   - UserMenu dropdown
//   - ChartModal, TuneReportModal (unchanged)
//
// On mobile (<768px), the rail collapses to a BottomNav and the
// header collapses to brand+scan+bell.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getSymbols,
  getStatus,
  getSignals,
  forceScan,
  getTuneLatest,
  applyTune,
  rejectTune,
  getPositions,
} from './api';
import type {
  SymbolStatus,
  StatusResponse,
  Signal,
  TuneResult,
  Position,
} from './types';
import type { MainTab, SymbolsFilter } from './types-ui';

import { useAuth } from './auth/useAuth';
import { useScanCountdown } from './hooks/useScanCountdown';
import { useIsMobile } from './hooks/useIsMobile';
import { useLiveTicker } from './hooks/useLiveTicker';
import { computeFocus } from './helpers/hierarchy';

import ChartModal from './components/ChartModal';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import SymbolsGrid from './components/SymbolsGrid';
import SignalsTable from './components/SignalsTable';
import ConfigPanel from './components/ConfigPanel';
import PositionsPanel from './components/PositionsPanel';
import TuneReportModal from './components/TuneReportModal';
import NotificationToast from './components/NotificationToast';
import KillSwitchDashboard from './components/KillSwitchDashboard';

// New components
import LeftRail from './components/LeftRail';
import BottomNav from './components/BottomNav';
import Ticker from './components/Ticker';
import FocusPanel from './components/FocusPanel';
import NotificationBell from './components/NotificationBell';
import UserMenu from './components/UserMenu';

import appStyles from './App.module.css';

const REFRESH_INTERVAL_MS = 30_000;

type OverlayKind = 'notifs' | 'settings' | 'user' | null;

const App: React.FC = () => {
  const { user, logout } = useAuth();
  const mobile = useIsMobile();

  // ── data ───────────────────────────────────────────────
  // Raw symbols from /symbols. The exposed `symbols` (further down) overlays
  // live ticker prices on top so the dashboard refreshes in seconds.
  const [symbolsRaw,  setSymbols]     = useState<SymbolStatus[]>([]);
  const [status,      setStatus]      = useState<StatusResponse | null>(null);
  const [signals,     setSignals]     = useState<Signal[]>([]);
  const [positions,   setPositions]   = useState<Position[]>([]);
  const [scanning,    setScanning]    = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [tuneResult,  setTuneResult]  = useState<TuneResult | null>(null);

  // ── ui ─────────────────────────────────────────────────
  const [filter,         setFilter]         = useState<SymbolsFilter>('all');
  const [mainTab,        setMainTab]        = useState<MainTab>('mercado');
  const [tuneModalOpen,  setTuneModalOpen]  = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolStatus | null>(null);
  const [openOverlay,    setOpenOverlay]    = useState<OverlayKind>(null);
  const [unreadCount,    setUnreadCount]    = useState<number>(0);

  // Signal to open as position (passed from SignalsTable → PositionsPanel)
  const [signalForPos, setSignalForPos] = useState<Signal | null>(null);

  // ── data fetching ──────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [symbolsRes, statusRes, signalsRes, tuneRes, positionsRes] = await Promise.all([
        getSymbols(),
        getStatus(),
        getSignals({ limit: 20, only_signals: false, since_hours: 24 }),
        getTuneLatest().catch(() => null),
        getPositions('open').catch(() => ({ total: 0, positions: [] })),
      ]);
      setSymbols(symbolsRes.symbols);
      setStatus(statusRes);
      setSignals(signalsRes.signals);
      setTuneResult(tuneRes);
      setPositions(positionsRes.positions ?? []);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    const id = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ── derived state ──────────────────────────────────────
  const lastRefreshTs = lastRefresh ? lastRefresh.getTime() : null;
  const { progress, secsLeft } = useScanCountdown(REFRESH_INTERVAL_MS, lastRefreshTs);

  // Live ticker poll (3s). Overrides `live_price` from /symbols so prices
  // refresh in seconds, and accumulates a per-symbol price history buffer
  // that drives the sparkline in the watchlist cards / rows.
  const { prices: tickerPrices, changes: tickerChanges, history: tickerHistory } = useLiveTicker(3000);
  const symbols = useMemo(
    () => symbolsRaw.map((s) => ({
      ...s,
      live_price:    tickerPrices[s.symbol]  ?? s.live_price,
      change_24h:    tickerChanges[s.symbol] ?? s.change_24h ?? null,
      recent_closes: tickerHistory[s.symbol] ?? s.recent_closes ?? [],
    })),
    [symbolsRaw, tickerPrices, tickerChanges, tickerHistory],
  );

  const focus = useMemo(
    () => computeFocus(symbols, positions, status, Date.now()),
    [symbols, positions, status],
  );
  const navCounts = useMemo(
    () => ({
      market:     symbols.length,
      positions:  positions.length,
      killswitch: 0, // wired once KillSwitch dashboard exposes a count
    }),
    [symbols.length, positions.length],
  );
  const hasPendingTune = tuneResult?.status === 'pending';

  // ── handlers ───────────────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setLoading(true);
    await fetchAll();
  }, [fetchAll]);

  const handleScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    try {
      await forceScan();
      await fetchAll();
    } catch (err) {
      console.error('forceScan error:', err);
    } finally {
      setScanning(false);
    }
  }, [scanning, fetchAll]);

  const handleOpenFromSignal = useCallback((signal: Signal) => {
    setSignalForPos(signal);
    setMainTab('posiciones');
  }, []);

  const handleTuneApply  = useCallback(async () => { await applyTune();  await fetchAll(); }, [fetchAll]);
  const handleTuneReject = useCallback(async () => { await rejectTune(); await fetchAll(); }, [fetchAll]);

  const handleLogout = async () => {
    try { await logout(); } catch (err) { console.warn('[app] logout error:', err); }
  };

  const handleNavSelect = (tab: MainTab | 'menu') => {
    if (tab === 'menu') {
      setOpenOverlay('user');
      return;
    }
    setMainTab(tab);
  };

  // Close overlays when the tab changes
  useEffect(() => { setOpenOverlay(null); }, [mainTab]);

  return (
    <div className={[appStyles.app, mobile ? appStyles.appMobile : appStyles.appDesktop].join(' ')}>
      <NotificationToast />

      <Header
        status={status}
        user={user}
        scanning={scanning}
        lastRefresh={lastRefresh}
        scanProgress={progress}
        secsLeft={secsLeft}
        unreadCount={unreadCount}
        hasPendingTune={hasPendingTune}
        onRefresh={handleRefresh}
        onScan={handleScan}
        onConfigOpen={() => setOpenOverlay(openOverlay === 'settings' ? null : 'settings')}
        onTuneOpen={() => setTuneModalOpen(true)}
        onBellClick={() => setOpenOverlay(openOverlay === 'notifs' ? null : 'notifs')}
        onUserClick={() => setOpenOverlay(openOverlay === 'user' ? null : 'user')}
        notifsOpen={openOverlay === 'notifs'}
        settingsOpen={openOverlay === 'settings'}
        userOpen={openOverlay === 'user'}
        mobile={mobile}
      />

      <Ticker symbols={symbols} onSymbolClick={setSelectedSymbol} />

      <div className={appStyles.body}>
        {!mobile && (
          <LeftRail
            active={mainTab}
            counts={navCounts}
            onSelect={(tab) => setMainTab(tab)}
            onLogout={handleLogout}
            onTuneOpen={() => setTuneModalOpen(true)}
            hasPendingTune={hasPendingTune}
          />
        )}

        <main className={appStyles.main}>
          {error && (
            <div className={appStyles.errorBanner}>
              <span>⚠</span>
              <span>Error de conexión: {error}</span>
              <button onClick={() => setError(null)} aria-label="Cerrar">✕</button>
            </div>
          )}

          {/* ── Mercado ────────────────────────────────── */}
          {mainTab === 'mercado' && (
            <>
              <StatusBar status={status} />
              <FocusPanel
                items={focus}
                onAction={(it) => {
                  if (it.pair) {
                    const sym = symbols.find((s) => s.symbol === it.pair);
                    if (sym) setSelectedSymbol(sym);
                  }
                  if (it.kind === 'risk-position' || it.kind === 'near-tp') {
                    setMainTab('posiciones');
                  }
                }}
              />

              <ErrorBoundary fallbackLabel="Error en el grid de símbolos">
                <SymbolsGrid
                  symbols={symbols}
                  loading={loading}
                  filter={filter}
                  onFilterChange={setFilter}
                  onSymbolClick={setSelectedSymbol}
                />
              </ErrorBoundary>

              <ErrorBoundary fallbackLabel="Error en la tabla de señales">
                <SignalsTable
                  signals={signals}
                  loading={loading}
                  onOpenPosition={handleOpenFromSignal}
                  mobile={mobile}
                />
              </ErrorBoundary>
            </>
          )}

          {/* ── Posiciones ─────────────────────────────── */}
          {mainTab === 'posiciones' && (
            <ErrorBoundary fallbackLabel="Error en el panel de posiciones">
              <PositionsPanel
                symbols={symbols}
                onOpenFromSignal={signalForPos}
                onSignalConsumed={() => setSignalForPos(null)}
              />
            </ErrorBoundary>
          )}

          {/* ── Kill-switch ───────────────────────────── */}
          {mainTab === 'kill-switch' && (
            <ErrorBoundary fallbackLabel="Error en dashboard de kill switch">
              <KillSwitchDashboard />
            </ErrorBoundary>
          )}

          <footer className={appStyles.footer}>
            <span className="prose">Crypto Scanner V6 · scanner uptime —</span>
            <span className="prose">3 timeframes · 4H macro → 1H signal → 5M entry · cada {REFRESH_INTERVAL_MS / 1000}s</span>
          </footer>
        </main>
      </div>

      {mobile && (
        <BottomNav active={mainTab} counts={navCounts} onSelect={handleNavSelect} />
      )}

      {/* ── Overlays ────────────────────────────────────── */}
      <NotificationBell
        open={openOverlay === 'notifs'}
        onClose={() => setOpenOverlay(null)}
        onUnreadChange={setUnreadCount}
      />
      <ConfigPanel
        open={openOverlay === 'settings'}
        onClose={() => setOpenOverlay(null)}
      />
      {user && (
        <UserMenu
          open={openOverlay === 'user'}
          user={user}
          onClose={() => setOpenOverlay(null)}
          onLogout={() => {
            setOpenOverlay(null);
            handleLogout();
          }}
        />
      )}

      {tuneModalOpen && tuneResult && (
        <TuneReportModal
          tune={tuneResult}
          onApply={handleTuneApply}
          onReject={handleTuneReject}
          onClose={() => setTuneModalOpen(false)}
        />
      )}

      <ChartModal
        symbol={selectedSymbol}
        onClose={() => setSelectedSymbol(null)}
      />
    </div>
  );
};

export default App;
