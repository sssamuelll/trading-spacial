// ============================================================
// ScanProgressBar — thin top-edge bar that fills as the scan
// cycle approaches its next tick. Sits absolutely at the top of
// the header.
// ============================================================

import React from 'react';

interface ScanProgressBarProps {
  /** 0..1 */
  progress: number;
  animate?: boolean;
}

const trackStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0, left: 0, right: 0,
  height: 1,
  background: 'var(--nbc-border-dimmer)',
  overflow: 'hidden',
  zIndex: 2,
  pointerEvents: 'none',
};

const ScanProgressBar: React.FC<ScanProgressBarProps> = ({ progress, animate = true }) => {
  const fillStyle: React.CSSProperties = {
    width: `${Math.min(100, Math.max(0, progress * 100))}%`,
    height: '100%',
    background: 'linear-gradient(90deg, transparent, var(--bull) 40%, var(--bull))',
    boxShadow: '0 0 4px var(--bull)',
    transition: animate ? 'width 1s linear' : 'none',
  };
  return (
    <div style={trackStyle} aria-hidden="true">
      <div style={fillStyle} />
    </div>
  );
};

export default ScanProgressBar;
