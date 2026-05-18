// ============================================================
// CommandBar — terminal-style input in the header.
// Currently visual-only; can be wired to a real ⌘K palette later.
// ============================================================

import React, { useState } from 'react';
import styles from './CommandBar.module.css';

interface CommandBarProps {
  onSubmit?: (value: string) => void;
}

const CommandBar: React.FC<CommandBarProps> = ({ onSubmit }) => {
  const [val, setVal] = useState('');
  const [focused, setFocused] = useState(false);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && onSubmit) {
      onSubmit(val.trim());
      setVal('');
    }
  };

  return (
    <div className={[styles.cmdbar, focused ? styles.focus : ''].filter(Boolean).join(' ')}>
      <span className={styles.prompt}>&gt;</span>
      <input
        className={`${styles.input} num`}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        placeholder={focused ? 'btc · open · scan · /help' : 'buscar pares, posiciones, comandos'}
      />
      {!val && !focused && <span className={styles.kbd}>⌘K</span>}
      {focused && (
        <span className={styles.cursor} aria-hidden="true">▍</span>
      )}
    </div>
  );
};

export default CommandBar;
