// ============================================================
// PriceSpark — small SVG sparkline of price ticks.
//
// Distinct from the existing Sparkline.tsx, which renders W/L/null
// trade outcomes for the kill-switch view. This one takes a number[]
// price series and auto-colors bull/bear based on first vs last value.
// ============================================================

import React from 'react';

interface PriceSparkProps {
  data: number[];
  width?:  number;
  height?: number;
  color?:  string;
}

const PriceSpark: React.FC<PriceSparkProps> = ({
  data, width = 60, height = 18, color,
}) => {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = (max - min) || 1;
  const stride = width / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * stride;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const isUp = data[data.length - 1] >= data[0];
  const stroke = color ?? (isUp ? 'var(--bull)' : 'var(--bear)');
  return (
    <svg width={width} height={height} aria-hidden="true" style={{ opacity: 0.85 }}>
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="1.25"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default PriceSpark;
