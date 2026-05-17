// ============================================================
// PriceSpark — sparkline of recent ticker samples.
//
// Renders nothing for <2 data points (otherwise react-sparklines'
// auto-scaling produces a flat ugly line). Auto-colors based on
// first vs last sample (bull/bear) unless `color` is provided.
//
// Data source is the rolling buffer populated by `useLiveTicker` in
// App.tsx, propagated as `symbol.recent_closes`.
// ============================================================

import React from 'react';
import { Sparklines, SparklinesLine } from 'react-sparklines';

interface PriceSparkProps {
  data: number[];
  width?:  number;
  height?: number;
  color?:  string;
}

const PriceSpark: React.FC<PriceSparkProps> = ({
  data, width = 60, height = 18, color,
}) => {
  if (!data || data.length < 2) {
    // Reserve the slot so layout doesn't jump when data arrives.
    return <span style={{ display: 'inline-block', width, height }} aria-hidden="true" />;
  }
  const isUp = data[data.length - 1] >= data[0];
  const stroke = color ?? (isUp ? 'var(--bull)' : 'var(--bear)');
  return (
    <span style={{ display: 'inline-flex', width, height, opacity: 0.85 }} aria-hidden="true">
      <Sparklines data={data} width={width} height={height} margin={1}>
        <SparklinesLine
          color={stroke}
          style={{ strokeWidth: 1.25, fill: 'none', strokeLinejoin: 'round', strokeLinecap: 'round' }}
        />
      </Sparklines>
    </span>
  );
};

export default PriceSpark;
