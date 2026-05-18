// ============================================================
// RailIcon — geometric icons shared between LeftRail + BottomNav.
// ============================================================

import React from 'react';

export type RailIconName =
  | 'mercado'
  | 'positions'
  | 'killswitch'
  | 'history'
  | 'tune'
  | 'config';

interface Props {
  name: RailIconName;
  size?: number;
  className?: string;
}

const RailIcon: React.FC<Props> = ({ name, size = 20, className }) => {
  let path: React.ReactNode = null;
  switch (name) {
    case 'mercado':
      path = (
        <g>
          <rect x="3"   y="9"  width="3" height="6" />
          <rect x="8.5" y="5"  width="3" height="10" />
          <rect x="14"  y="11" width="3" height="4" />
        </g>
      );
      break;
    case 'positions':
      path = (
        <g>
          <rect x="3" y="3"  width="14" height="2.5" />
          <rect x="3" y="8.5" width="9"  height="2.5" />
          <rect x="3" y="14" width="11" height="2.5" />
        </g>
      );
      break;
    case 'killswitch':
      path = (
        <g>
          <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="9" y="3.5" width="2" height="6.5" />
        </g>
      );
      break;
    case 'history':
      path = (
        <g>
          <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10 6 V10 L13 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
        </g>
      );
      break;
    case 'tune':
      path = (
        <g>
          <line x1="3"   y1="6"  x2="17" y2="6"  stroke="currentColor" strokeWidth="1.5" />
          <line x1="3"   y1="14" x2="17" y2="14" stroke="currentColor" strokeWidth="1.5" />
          <rect x="6.5"  y="3.5" width="3" height="5" />
          <rect x="11.5" y="11.5" width="3" height="5" />
        </g>
      );
      break;
    case 'config':
      path = (
        <g>
          <circle cx="10" cy="10" r="2.5" fill="currentColor" />
          <path
            d="M10 2.5 v3 M10 14.5 v3 M2.5 10 h3 M14.5 10 h3 M4.5 4.5 l2.1 2.1 M13.4 13.4 l2.1 2.1 M15.5 4.5 l-2.1 2.1 M6.6 13.4 l-2.1 2.1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
        </g>
      );
      break;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
};

export default RailIcon;
