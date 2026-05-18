// ============================================================
// HeartbeatDot — pulsing dot for "LIVE" status.
// ============================================================

import React from 'react';

interface HeartbeatDotProps {
  active?: boolean;
  size?: number;
}

const HeartbeatDot: React.FC<HeartbeatDotProps> = ({ active = true, size = 8 }) => {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width:   size,
        height:  size,
        background: 'var(--bull)',
        borderRadius: '50%',
        animation: active ? 'heartbeat 1.4s ease-in-out infinite' : 'none',
        boxShadow: active ? '0 0 8px var(--bull)' : 'none',
      }}
    />
  );
};

export default HeartbeatDot;
