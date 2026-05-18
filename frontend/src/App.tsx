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
  getCapital,
  closePosition,
  updatePosition,
} from './api';
import type {
  SymbolStatus,
  StatusResponse,
  Signal,
  TuneResult,
  Position,
  MacroState,
  Capital,
} from './types';
import type { MainTab, SymbolsFilter } from './types-ui';

import { useAuth } from './auth/useAuth';
import { useScanCountdown } from './hooks/useScanCountdown';
import { useIsMobile } from './hooks/useIsMobile';
import { useLiveTicker } from './hooks/useLiveTicker';
import { useMacro } from './hooks/useMacro';
import { computeFocus } from './helpers/hierarchy';

import SymbolDetail, { type PositionPreset } from './components/SymbolDetail';
import AgentBrief from './components/AgentBrief';
import AgentDock from './components/AgentDock';
import ErrorBoundary from './components/ErrorBoundary';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import SymbolsGrid from './components/SymbolsGrid';
import SignalsTable from './components/SignalsTable';
import ConfigPanel from './components/ConfigPanel';
import PositionsView, { type PortfolioSummary } from './components/PositionsView';
import OpenPositionModal from './components/OpenPositionModal';
import TuneReportModal from './components/TuneReportModal';
import { type PositionInsight } from './helpers/position-insight';
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

// Agent feature flag — same gate the SymbolDetail copilot uses. When off,
// FocusPanel stays in the briefing slot and the AgentDock FAB is hidden.
const AGENT_ENABLED: boolean = (() => {
  const flag = (import.meta.env.VITE_AGENT_ENABLED ?? '').toString().trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
})();

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

  // Signal to open as position (passed from SignalsTable)
  const [signalForPos, setSignalForPos] = useState<Signal | null>(null);

  // Preset to open as position (passed from SymbolDetail)
  const [presetForPos, setPresetForPos] = useState<PositionPreset | null>(null);

  // AgentDock state — open flag + optional prompt the AgentBrief chip
  // injected when the user clicked one of the canned questions.
  const [dockOpen,          setDockOpen]          = useState(false);
  const [dockInitialPrompt, setDockInitialPrompt] = useState<string | null>(null);

  // OpenPositionModal — mounted at App level so the PositionsView CTA,
  // the SignalsTable flow, and the SymbolDetail preset can all trigger it.
  type ModalPrefill = {
    symbol:    string;
    price?:    number | null;
    sl?:       number | null;
    tp?:       number | null;
    scan_id?:  number | null;
    direction?: 'LONG' | 'SHORT';
    sizeUsd?:  number;
  };
  const [openPositionModalOpen, setOpenPositionModalOpen] = useState(false);
  const [openPositionPrefill,   setOpenPositionPrefill]   = useState<ModalPrefill | undefined>();

  // Closed-positions snapshot for the 7d hero metrics (win rate, P&L 7d).
  const [closedPositions7d, setClosedPositions7d] = useState<Position[]>([]);

  // Capital — drives the Equity hero readout. Fetched once on mount and on
  // tab navigation back to posiciones (cheap, ~1 row).
  const [capital, setCapital] = useState<Capital | null>(null);

  // ── data fetching ──────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [symbolsRes, statusRes, signalsRes, tuneRes, positionsRes, closedRes, capitalRes] = await Promise.all([
        getSymbols(),
        getStatus(),
        getSignals({ limit: 20, only_signals: false, since_hours: 24 }),
        getTuneLatest().catch(() => null),
        getPositions('open').catch(() => ({ total: 0, positions: [] })),
        getPositions('closed').catch(() => ({ total: 0, positions: [] })),
        // /capital 404s when the row isn't initialized — treat as "no data" and
        // fall back to a zeroed PortfolioSummary so PositionsView renders.
        getCapital().catch(() => null),
      ]);
      setSymbols(symbolsRes.symbols);
      setStatus(statusRes);
      setSignals(signalsRes.signals);
      setTuneResult(tuneRes);
      setPositions(positionsRes.positions ?? []);
      // Filter closed positions to the last 7 days client-side. The backend
      // doesn't accept a window param yet (TODO).
      const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recentClosed = (closedRes.positions ?? []).filter((p: Position) => {
        const tsStr = p.exit_ts ?? p.entry_ts;
        if (!tsStr) return false;
        const t = new Date(tsStr).getTime();
        return Number.isFinite(t) && t >= sevenDaysAgoMs;
      });
      setClosedPositions7d(recentClosed);
      setCapital(capitalRes ?? null);
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

  // Macro signals (régimen / F&G / funding) — slow, 30s polling.
  const macro = useMacro(30000);

  // Pre-fill the OpenPositionModal whenever upstream sources push a
  // signal or a SymbolDetail preset. Both flows used to live inside
  // PositionsPanel — lifted here so the modal can be a top-level overlay.
  useEffect(() => {
    if (signalForPos) {
      setOpenPositionPrefill({
        symbol:  signalForPos.symbol,
        price:   signalForPos.price,
        scan_id: signalForPos.id,
      });
      setOpenPositionModalOpen(true);
      setSignalForPos(null);
    }
  }, [signalForPos]);

  useEffect(() => {
    if (presetForPos) {
      // PositionPreset carries qty (base coin units); the modal's Capital
      // field wants USD notional, so derive sizeUsd = qty × entry.
      setOpenPositionPrefill({
        symbol:    presetForPos.symbol,
        price:     presetForPos.entry,
        sl:        presetForPos.sl,
        tp:        presetForPos.tp,
        direction: presetForPos.direction,
        sizeUsd:   presetForPos.qty * presetForPos.entry,
      });
      setOpenPositionModalOpen(true);
      setPresetForPos(null);
    }
  }, [presetForPos]);

  // Compose the MacroState the agent (Brief + Dock) consumes — merges the
  // /macro response with /status scanner counters. Kill-switch count isn't
  // exposed by /status yet, so we placeholder to 0 — same as StatusBar.
  const macroState: MacroState = useMemo(() => ({
    regime:           macro?.regime ?? null,
    fng:              macro?.fear_greed_index ?? null,
    funding:          macro?.funding_rate_pct != null ? macro.funding_rate_pct / 100 : null,
    scansToday:       status?.scanner_state?.scans_total   ?? 0,
    signalsToday:     status?.scanner_state?.signals_total ?? 0,
    errors:           status?.scanner_state?.errors        ?? 0,
    killSwitchActive: 0,
  }), [macro, status]);

  // PortfolioSummary for PositionsView's hero strip. Derived from /capital
  // and the open-position pnl_pct totals.
  // - equity: capital balance, fallback to 0 if /capital 404s
  // - pnlToday: not exposed by backend yet → 0 with TODO
  // - drawdown: capital.max_drawdown_pct
  const portfolio: PortfolioSummary = useMemo(() => ({
    equity:   capital?.balance ?? 0,
    pnlToday: 0,   // TODO: backend doesn't expose intraday delta yet
    drawdown: capital?.max_drawdown_pct ?? 0,
  }), [capital]);

  // Highest-score symbol with señal=true — used as the empty-state
  // suggestion in PositionsView.
  const topFreshSetup: SymbolStatus | null = useMemo(() => {
    const candidates = symbols
      .filter((s) => s.señal === true && (s.score ?? 0) >= 5)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return candidates[0] ?? null;
  }, [symbols]);

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

  const handleOpenFromPreset = useCallback((preset: PositionPreset) => {
    setSelectedSymbol(null);      // close SymbolDetail
    setPresetForPos(preset);
    setMainTab('posiciones');
  }, []);

  // ── Position management handlers (lifted from the old PositionsPanel) ──
  const handleAbrirPosicion = useCallback(() => {
    setOpenPositionPrefill(undefined);
    setOpenPositionModalOpen(true);
  }, []);

  const handleEditSlTp = useCallback(async (p: Position) => {
    // Lightweight stub for now — prompt() is honest about the deferred work
    // and avoids shipping a half-built modal. Replace with a proper inline
    // editor when the redesign reaches positions.
    const slStr = window.prompt(`Nuevo SL para ${p.symbol}:`, p.sl_price != null ? String(p.sl_price) : '');
    if (slStr === null) return;
    const tpStr = window.prompt(`Nuevo TP para ${p.symbol}:`, p.tp_price != null ? String(p.tp_price) : '');
    if (tpStr === null) return;
    const sl = parseFloat(slStr);
    const tp = parseFloat(tpStr);
    if (!Number.isFinite(sl) || !Number.isFinite(tp)) return;
    try {
      await updatePosition(p.id, { sl_price: sl, tp_price: tp });
      await fetchAll();
    } catch (err) {
      window.alert(`No se pudo actualizar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [fetchAll]);

  const handleClosePosition = useCallback(async (p: Position) => {
    const liveSym = symbols.find((s) => s.symbol === p.symbol);
    const exitPx = liveSym?.live_price ?? liveSym?.price ?? p.entry_price * (1 + (p.pnl_pct ?? 0) / 100);
    const ok = window.confirm(
      `Cerrar ${p.symbol} a $${exitPx.toFixed(2)} (P&L ${(p.pnl_pct ?? 0).toFixed(2)}%)?`,
    );
    if (!ok) return;
    try {
      await closePosition(p.id, { exit_price: exitPx, exit_reason: 'MANUAL' });
      await fetchAll();
    } catch (err) {
      window.alert(`No se pudo cerrar: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [symbols, fetchAll]);

  const handleAskAgent = useCallback((p: Position, insight: PositionInsight) => {
    const liveSym = symbols.find((s) => s.symbol === p.symbol);
    const currentPx = liveSym?.live_price ?? liveSym?.price ?? p.entry_price * (1 + (p.pnl_pct ?? 0) / 100);
    const pnlPct = p.pnl_pct ?? 0;
    const pnlAbs = p.pnl_usd ?? 0;
    const display = p.symbol.replace('USDT', '');
    const prompt =
      `Hablemos de mi posición en ${display}. ` +
      `Estado: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% ` +
      `(${pnlAbs >= 0 ? '+' : ''}$${pnlAbs.toFixed(2)}). ` +
      `Entrada $${p.entry_price}, ahora $${currentPx.toFixed(2)}, ` +
      `SL $${p.sl_price ?? '—'}, TP $${p.tp_price ?? '—'}. ` +
      `Tu lectura inicial fue: "${insight.text}" — ${insight.action}.`;
    setDockInitialPrompt(prompt);
    setDockOpen(true);
  }, [symbols]);

  const openDock = useCallback((kind?: 'changes' | 'plain') => {
    if (kind === 'changes') setDockInitialPrompt('¿Qué cambió desde ayer?');
    else if (kind === 'plain') setDockInitialPrompt('Hazme un resumen muy directo, sin jerga, como para alguien que no es trader.');
    else setDockInitialPrompt(null);
    setDockOpen(true);
  }, []);

  const closeDock = useCallback(() => {
    setDockOpen(false);
    setDockInitialPrompt(null);
  }, []);

  // Open SymbolDetail by pair id. Accepts either "BTCUSDT" or just "BTC".
  const openSymbolByPair = useCallback((pair: string) => {
    const full = pair.endsWith('USDT') ? pair : `${pair}USDT`;
    const sym = symbols.find((s) => s.symbol === full);
    if (sym) setSelectedSymbol(sym);
  }, [symbols]);

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
              <ErrorBoundary fallbackLabel="Error en el grid de símbolos">
                <SymbolsGrid
                  symbols={symbols}
                  loading={loading}
                  filter={filter}
                  onFilterChange={setFilter}
                  onSymbolClick={setSelectedSymbol}
                  belowPageBar={
                    <>
                      <StatusBar status={status} macro={macro} />
                      {AGENT_ENABLED ? (
                        <AgentBrief
                          symbols={symbols}
                          positions={positions}
                          macro={macroState}
                          onOpenDock={openDock}
                          onOpenSymbol={openSymbolByPair}
                        />
                      ) : (
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
                      )}
                    </>
                  }
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
              <PositionsView
                positions={positions}
                portfolio={portfolio}
                closedRecent7d={closedPositions7d}
                freshSetup={topFreshSetup}
                symbols={symbols}
                onOpenSymbol={openSymbolByPair}
                onAbrirPosicion={handleAbrirPosicion}
                onAskAgent={handleAskAgent}
                onEditSlTp={handleEditSlTp}
                onClosePosition={handleClosePosition}
                mobile={mobile}
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

      <SymbolDetail
        symbol={selectedSymbol}
        onClose={() => setSelectedSymbol(null)}
        onOpenPosition={handleOpenFromPreset}
      />

      {AGENT_ENABLED && (
        <AgentDock
          open={dockOpen}
          onOpen={() => openDock()}
          onClose={closeDock}
          symbols={symbols}
          positions={positions}
          macro={macroState}
          initialPrompt={dockInitialPrompt}
          onOpenSymbol={openSymbolByPair}
        />
      )}

      {openPositionModalOpen && (
        <OpenPositionModal
          symbols={symbols}
          prefill={openPositionPrefill}
          onClose={() => setOpenPositionModalOpen(false)}
          onCreated={async () => {
            setOpenPositionModalOpen(false);
            await fetchAll();
          }}
        />
      )}
    </div>
  );
};

export default App;
