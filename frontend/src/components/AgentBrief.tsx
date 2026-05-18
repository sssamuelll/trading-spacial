// ============================================================
// AgentBrief — top-of-Mercado morning briefing panel.
//
// SYNCHRONOUS by design. computeBrief() runs purely on local state;
// no LLM call. The morning briefing must render with zero latency.
// The LLM only enters when the user opens the dock or clicks a chip
// that pre-fills the dock with a prompt.
// ============================================================

import React, { useMemo } from 'react';
import styles from './AgentBrief.module.css';
import type { SymbolStatus, Position, MacroState } from '../types';
import { computeBrief, type BriefHighlight } from '../helpers/brief';

interface AgentBriefProps {
  symbols:      SymbolStatus[];
  positions:    Position[];
  macro:        MacroState;
  onOpenDock:   (kind?: 'changes' | 'plain') => void;
  onOpenSymbol: (pair: string) => void;
}

const AgentBrief: React.FC<AgentBriefProps> = ({
  symbols, positions, macro, onOpenDock, onOpenSymbol,
}) => {
  const brief = useMemo(
    () => computeBrief(symbols, positions, macro),
    [symbols, positions, macro],
  );

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const top = brief.firingHighScore[0];
  const topPair = top ? top.symbol.replace('USDT', '') : null;

  return (
    <section className={styles.ab}>
      <header className={styles.head}>
        <div className={styles.id}>
          <div className={styles.avatar}>◈</div>
          <div className={styles.idText}>
            <div className={styles.name}>briefing del copiloto</div>
            <div className={styles.sub}>
              {symbols.length} pares · {positions.length} posiciones
              {macro.fng != null && <> · F&amp;G {macro.fng}</>}
            </div>
          </div>
        </div>
        <div className={styles.live}>
          <span className={styles.liveDot} />
          <span className={styles.liveLbl}>en vivo</span>
          <span className={`${styles.liveTime} num`}>{timeStr}</span>
        </div>
      </header>

      <div className={styles.body}>
        <div className={`${styles.prose} prose`}>
          {brief.paragraphs.map((p, i) => (
            <p key={i} className={styles.para}>{p}</p>
          ))}
        </div>

        {brief.highlights.length > 0 && (
          <ul className={styles.highlights}>
            {brief.highlights.slice(0, 3).map((h, i) => (
              <HighlightItem
                key={i}
                h={h}
                onOpenSymbol={onOpenSymbol}
              />
            ))}
          </ul>
        )}
      </div>

      <footer className={styles.ft}>
        <div className={styles.chips}>
          {top && (
            <button
              className={`${styles.chip} ${styles.chipPrimary}`}
              onClick={() => onOpenSymbol(top.symbol)}
            >
              ▸ revisar {topPair}
            </button>
          )}
          <button className={styles.chip} onClick={() => onOpenDock('changes')}>
            ¿qué cambió desde ayer?
          </button>
          <button className={styles.chip} onClick={() => onOpenDock('plain')}>
            resumen en simple
          </button>
        </div>
        <button className={styles.expand} onClick={() => onOpenDock()}>
          conversar con copiloto →
        </button>
      </footer>
    </section>
  );
};

const HighlightItem: React.FC<{ h: BriefHighlight; onOpenSymbol: (pair: string) => void }> = ({ h, onOpenSymbol }) => {
  const toneClass =
    h.tone === 'bull' ? styles.hiBull :
    h.tone === 'bear' ? styles.hiBear : styles.hiWarn;
  const glyphClass =
    h.tone === 'bull' ? styles.hiGlyphBull :
    h.tone === 'bear' ? styles.hiGlyphBear : styles.hiGlyphWarn;
  const glyph =
    h.kind === 'fresh-signal' ? '◉' :
    h.kind === 'near-tp'      ? '◆' : '⚠';
  return (
    <li>
      <button
        type="button"
        className={`${styles.hi} ${toneClass}`}
        onClick={() => onOpenSymbol(h.pair)}
        title={`Abrir ${h.pair.replace('USDT', '')}`}
      >
        <span className={`${styles.hiGlyph} ${glyphClass}`}>{glyph}</span>
        <span className={styles.hiBody}>
          <span className={styles.hiTitle}>{h.title}</span>
          <span className={`${styles.hiSub} prose`}>{h.sub}</span>
        </span>
        <span className={styles.hiChev}>›</span>
      </button>
    </li>
  );
};

export default AgentBrief;
