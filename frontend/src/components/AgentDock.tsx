// ============================================================
// AgentDock — floating launcher + slide-up chat panel.
//
// Mounted at App level so the conversation persists across tab
// changes (Mercado → Posiciones → Kill-switch → back to Mercado).
//
// Each turn rebuilds the system prompt with the current portfolio
// snapshot so the agent always sees fresh data.
// Tool-marker protocol: `<<<TOOL:open_symbol:BTCUSDT>>>` becomes a
// "▸ abrir BTCUSDT" link button under the message.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import styles from './AgentDock.module.css';
import type { SymbolStatus, Position, MacroState } from '../types';
import { chatAgent, type AgentMessage } from '../api';
import { formatPrice } from '../utils';

interface AgentDockProps {
  open:           boolean;
  onOpen:         () => void;
  onClose:        () => void;
  symbols:        SymbolStatus[];
  positions:      Position[];
  macro:          MacroState;
  initialPrompt?: string | null;
  onOpenSymbol?:  (pair: string) => void;
  /** Confirm a manual kill-switch release once the agent emits
   *  <<<TOOL:confirm_release:SYM>>>. Renders an amber "▸ confirmar
   *  release de SYM" button inline under the agent message. */
  onConfirmRelease?: (symbol: string) => Promise<void> | void;
  /** Confirm applying an auto-tune run once the agent emits
   *  <<<TOOL:confirm_apply_tune:N>>>. Renders an amber "▸ confirmar
   *  apply del tune #N" button inline under the agent message. */
  onConfirmApplyTune?: (tuneId: number) => Promise<void> | void;
  unreadHint?:    boolean;
}

interface ToolCall {
  name: string;
  arg?: string;
}
interface DockMsg {
  role:   'user' | 'assistant';
  text:   string;
  tools?: ToolCall[];
  error?: boolean;
}

const DOCK_SUGGESTIONS = [
  '¿en qué par tengo más probabilidad ahora?',
  'explícame el setup de PENDLE',
  'simular $500 en RUNE',
  '¿debería cerrar ETH ahora?',
];

const AgentDock: React.FC<AgentDockProps> = ({
  open, onOpen, onClose,
  symbols, positions, macro,
  initialPrompt, onOpenSymbol, onConfirmRelease, onConfirmApplyTune, unreadHint,
}) => {
  const [msgs,    setMsgs]    = useState<DockMsg[]>([]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Welcome message on first open
  useEffect(() => {
    if (open && msgs.length === 0 && !initialPrompt) {
      setMsgs([{
        role: 'assistant',
        text: `Hola. Estoy mirando tus ${symbols.length} pares y ${positions.length} posiciones. Pregúntame lo que quieras.`,
      }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-send the initial prompt when one is passed in
  useEffect(() => {
    if (open && initialPrompt && msgs.length === 0) {
      void send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPrompt]);

  // Autoscroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, loading]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || loading) return;
    setMsgs((p) => [...p, { role: 'user', text: t }]);
    setInput('');
    setLoading(true);

    try {
      const openPositions = positions.filter((p) => p.status === 'open');
      const positionsLine = openPositions.length === 0
        ? ''
        : ' (' + openPositions.map((p) => `${p.symbol.replace('USDT','')} ${(p.pnl_pct ?? 0) > 0 ? '+' : ''}${(p.pnl_pct ?? 0).toFixed(2)}%`).join(', ') + ')';

      const signalSyms = symbols
        .filter((s) => (s.score ?? 0) >= 5 && s.señal === true)
        .map((s) => `- ${s.symbol.replace('USDT','')}: score ${s.score ?? 0}/9, LRC ${(s.lrc_pct ?? 0).toFixed(1)}%, side ${s.direction ?? 'LONG'}, precio $${formatPrice(s.live_price ?? s.price)}`)
        .join('\n');

      const fundingStr = macro.funding != null ? `${(macro.funding * 100).toFixed(4)}%/8h` : '—';
      const fngStr     = macro.fng != null ? String(macro.fng) : '—';

      const sysPrompt = `Eres un copiloto de trading de la app crypto-scanner v6. El usuario está en la vista Mercado.

PORTAFOLIO ACTUAL:
- Pares en watchlist: ${symbols.length}
- Posiciones abiertas: ${openPositions.length}${positionsLine}
- Régimen: ${macro.regime ?? '—'}
- F&G: ${fngStr}
- Funding BTC: ${fundingStr}
- Errores del escáner: ${macro.errors}
- Kill-switch pausados: ${macro.killSwitchActive}

PARES CON SEÑAL (score ≥ 5 + gatillo):
${signalSyms || '- ninguno'}

INSTRUCCIONES:
- Responde en español, breve (2-4 oraciones máx).
- No inventes datos que no están arriba.
- Si el usuario pregunta sobre un par específico, sugiere abrirlo terminando con <<<TOOL:open_symbol:NOMBRE>>> donde NOMBRE es el símbolo completo incluyendo USDT (ej: <<<TOOL:open_symbol:BTCUSDT>>>).
- Si el usuario quiere liberar manualmente un par del kill-switch y justifica con UN argumento concreto (cambio de régimen macro, evento puntual identificable, par específico con causa clara, etc), termina la respuesta con <<<TOOL:confirm_release:NOMBRE>>> con el símbolo completo incluyendo USDT. Si la justificación es vaga ("siento que ya está bien", "creo que ya pasó"), pide MÁS detalles concretos SIN emitir el marker — tu trabajo es hacer que el usuario articule su tesis antes del override.
- Si el usuario quiere aplicar un auto-tune (modificar SL/TP/BE de la estrategia en vivo) y articula argumentos concretos por símbolo (razón económica, contexto reciente del par, tesis sobre por qué el backtest es representativo del régimen actual), termina la respuesta con <<<TOOL:confirm_apply_tune:N>>> donde N es el ID numérico del tune. Si la justificación es vaga o solo cita las métricas del propio backtest sin razonar sobre el mercado, pedí más detalles SIN emitir el marker.
- Si pregunta por todas sus posiciones, lista las que están arriba.
- Si pide un resumen "en simple" o "para papá", usa lenguaje muy directo, sin jerga.
- No uses negrita más de una vez por respuesta.`;

      const history: AgentMessage[] = msgs.slice(-6).map((m) => ({
        role:    m.role,
        content: m.text,
      }));
      const resp = await chatAgent({
        system:   sysPrompt,
        messages: [...history, { role: 'user', content: t }],
      });
      const { tools, cleaned } = extractTools(resp.text || '');
      setMsgs((p) => [...p, { role: 'assistant', text: cleaned, tools }]);
    } catch (err) {
      setMsgs((p) => [...p, {
        role:  'assistant',
        text:  err instanceof Error ? `No pude analizar: ${err.message}` : 'No pude analizar. Inténtalo de nuevo.',
        error: true,
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating launcher */}
      <button
        className={`${styles.fab} ${open ? styles.fabHidden : ''}`}
        onClick={onOpen}
        title="Abrir copiloto"
        aria-label="Abrir copiloto"
      >
        <span className={styles.fabGlyph}>◈</span>
        <span className={styles.fabPulse} />
        {unreadHint && <span className={styles.fabBadge}>1</span>}
      </button>

      {/* Dock panel */}
      {open && (
        <aside className={styles.dock} role="dialog" aria-label="Copiloto">
          <header className={styles.hd}>
            <div className={styles.id}>
              <span className={styles.avatar}>◈</span>
              <div>
                <div className={styles.name}>copiloto</div>
                <div className={styles.sub}>
                  <span className={styles.dot} /> contexto completo del portafolio
                </div>
              </div>
            </div>
            <button className={styles.close} onClick={onClose} aria-label="Cerrar">×</button>
          </header>

          <div className={styles.scroll} ref={scrollRef}>
            {msgs.map((m, i) => (
              <DockMessage
                key={i}
                m={m}
                onOpenSymbol={onOpenSymbol}
                onConfirmRelease={onConfirmRelease}
                onConfirmApplyTune={onConfirmApplyTune}
              />
            ))}
            {loading && <DockTyping />}
          </div>

          <div className={styles.sugg}>
            {DOCK_SUGGESTIONS.map((s, i) => (
              <button
                key={i}
                className={styles.suggChip}
                onClick={() => send(s)}
                disabled={loading}
              >{s}</button>
            ))}
          </div>

          <form className={styles.inputRow} onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <span className={styles.prompt}>&gt;</span>
            <input
              className={styles.input}
              placeholder={loading ? 'pensando…' : 'pregúntame algo sobre el mercado, tus posiciones, un par…'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <button className={styles.send} type="submit" disabled={loading || !input.trim()}>↵</button>
          </form>
        </aside>
      )}
    </>
  );
};

// ── Helpers / sub-components ─────────────────────────────────

// Extract `<<<TOOL:name:ARG>>>` markers; the agent can append them to
// trigger downstream UI affordances (currently only `open_symbol`).
function extractTools(text: string): { tools: ToolCall[]; cleaned: string } {
  const tools: ToolCall[] = [];
  const cleaned = text.replace(/<<<TOOL:([a-z_]+)(?::([A-Z0-9_]+))?>>>/g, (_, name: string, arg?: string) => {
    tools.push({ name, arg });
    return '';
  }).trim();
  return { tools, cleaned };
}

const DockMessage: React.FC<{
  m: DockMsg;
  onOpenSymbol?:     (pair: string) => void;
  onConfirmRelease?: (symbol: string) => Promise<void> | void;
  onConfirmApplyTune?: (tuneId: number) => Promise<void> | void;
}> = ({ m, onOpenSymbol, onConfirmRelease, onConfirmApplyTune }) => {
  if (m.role === 'user') {
    return (
      <div className={`${styles.msg} ${styles.msgUser}`}>
        <div className={`${styles.bubble} ${styles.bubbleUser}`}>{m.text}</div>
      </div>
    );
  }
  return (
    <div className={`${styles.msg} ${styles.msgAsst}`}>
      <div className={styles.msgAvatar}>◈</div>
      <div className={styles.msgBody}>
        {m.text && (
          <div className={[styles.bubble, styles.bubbleAsst, m.error ? styles.bubbleError : ''].filter(Boolean).join(' ')}>
            <DockText text={m.text} />
          </div>
        )}
        {m.tools?.map((t, i) => {
          if (t.name === 'open_symbol' && t.arg && onOpenSymbol) {
            const display = t.arg.replace('USDT', '');
            return (
              <button
                key={i}
                className={styles.toolLink}
                onClick={() => onOpenSymbol(t.arg!)}
              >▸ abrir {display}</button>
            );
          }
          if (t.name === 'confirm_release' && t.arg && onConfirmRelease) {
            const display = t.arg.replace('USDT', '');
            return (
              <button
                key={i}
                className={styles.toolConfirm}
                onClick={() => void onConfirmRelease(t.arg!)}
              >▸ confirmar release de {display}</button>
            );
          }
          if (t.name === 'confirm_apply_tune' && t.arg && onConfirmApplyTune) {
            const id = parseInt(t.arg, 10);
            if (!Number.isFinite(id)) return null;
            return (
              <button
                key={i}
                className={styles.toolConfirm}
                onClick={() => void onConfirmApplyTune(id)}
              >▸ confirmar apply del tune #{id}</button>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
};

const DockText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) {
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        }
        return (
          <React.Fragment key={i}>
            {p.split('\n').map((line, j) => (
              <React.Fragment key={j}>{j > 0 && <br />}{line}</React.Fragment>
            ))}
          </React.Fragment>
        );
      })}
    </>
  );
};

const DockTyping: React.FC = () => (
  <div className={`${styles.msg} ${styles.msgAsst}`}>
    <div className={styles.msgAvatar}>◈</div>
    <div className={styles.msgBody}>
      <div className={`${styles.bubble} ${styles.bubbleAsst} ${styles.bubbleTyping}`}>
        <span className={styles.typingDot} />
        <span className={styles.typingDot} />
        <span className={styles.typingDot} />
      </div>
    </div>
  </div>
);

export default AgentDock;
