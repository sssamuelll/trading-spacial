// ============================================================
// SymbolsGrid.tsx — three-tier bucketed watchlist.
//
// The "filter" prop is preserved for backwards compatibility with
// the existing App.tsx wiring, but the visual story has shifted: we
// always show all three buckets when filter='all', and only the
// firing/featured pairs when filter='signals'.
// ============================================================

import React from 'react';
import styles from './SymbolsGrid.module.css';
import type { SymbolStatus } from '../types';
import type { SymbolsFilter } from '../types-ui';
import SymbolCard from './SymbolCard';
import SymbolRow from './SymbolRow';
import { bucketSymbols } from '../helpers/hierarchy';
import type { ScoreVariant } from './atoms/ScoreGrid';

interface SymbolsGridProps {
  symbols:       SymbolStatus[];
  loading:       boolean;
  filter:        SymbolsFilter;
  onFilterChange: (f: SymbolsFilter) => void;
  onSymbolClick?: (s: SymbolStatus) => void;
  scoreStyle?:    ScoreVariant;
  freshWithinMin?: number;
}

const SkeletonCard: React.FC = () => (
  <div className={styles.skel}>
    <div className={`${styles.skelLine} ${styles.skelTitle}`} />
    <div className={`${styles.skelLine} ${styles.skelPrice}`} />
    <div className={`${styles.skelLine} ${styles.skelBar}`} />
    <div className={`${styles.skelLine} ${styles.skelBar}`} />
    <div className={`${styles.skelLine} ${styles.skelFooter}`} />
  </div>
);

const SymbolsGrid: React.FC<SymbolsGridProps> = ({
  symbols, loading, filter, onFilterChange, onSymbolClick,
  scoreStyle = 'big', freshWithinMin = 8,
}) => {
  const now = Date.now();
  const isFresh = (s: SymbolStatus) =>
    !!s.ts && (now - new Date(s.ts).getTime()) / 60_000 <= freshWithinMin;

  const filtered = (() => {
    if (filter === 'signals') return symbols.filter((s) => s.señal);
    if (filter === 'fresh')   return symbols.filter(isFresh);
    return symbols;
  })();

  const buckets = bucketSymbols(filtered);

  const totalSignals = symbols.filter((s) => s.señal).length;
  const totalFresh   = symbols.filter(isFresh).length;

  return (
    <section className={styles.section}>
      {/* Page bar — title + filter chips */}
      <div className={styles.pageBar}>
        <div className={styles.pageBarTitle}>
          <span className={styles.pageBarIndex}>01</span>
          <span className={styles.pageBarName}>Mercado</span>
          <span className={styles.pageBarSep}>/</span>
          <span className={`${styles.pageBarHint} prose`}>
            {symbols.length} pares · {totalSignals} con gatillo · {totalFresh} nuevos
          </span>
        </div>
        <div className={styles.filter}>
          <Chip active={filter === 'all'}     onClick={() => onFilterChange('all')}    >Todos   <span className="num">{symbols.length}</span></Chip>
          <Chip active={filter === 'signals'} onClick={() => onFilterChange('signals')}>Con señal <span className="num">{totalSignals}</span></Chip>
          <Chip active={filter === 'fresh'}   onClick={() => onFilterChange('fresh')}  >Nuevos  <span className="num">{totalFresh}</span></Chip>
        </div>
      </div>

      {loading ? (
        <div className={styles.gridStandard}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : symbols.length === 0 ? (
        <Empty kind={filter === 'signals' ? 'no-signals' : 'no-data'} total={symbols.length} />
      ) : (
        <>
          {buckets.featured.length > 0 && (
            <>
              <SectionHeader label="Setups firmes" count={buckets.featured.length} hint="score ≥ 5 · gatillo activo" />
              <div className={styles.gridFeatured}>
                {buckets.featured.map((s) => (
                  <SymbolCard
                    key={s.symbol}
                    symbol={s}
                    scoreStyle={scoreStyle}
                    featured
                    fresh={isFresh(s)}
                    onClick={onSymbolClick ? () => onSymbolClick(s) : undefined}
                  />
                ))}
              </div>
            </>
          )}

          {buckets.watching.length > 0 && (
            <>
              <SectionHeader label="En seguimiento" count={buckets.watching.length} hint="score 2–4 · esperando" />
              <div className={styles.gridStandard}>
                {buckets.watching.map((s) => (
                  <SymbolCard
                    key={s.symbol}
                    symbol={s}
                    scoreStyle={scoreStyle}
                    onClick={onSymbolClick ? () => onSymbolClick(s) : undefined}
                  />
                ))}
              </div>
            </>
          )}

          {buckets.quiet.length > 0 && (
            <>
              <SectionHeader label="Tranquilos" count={buckets.quiet.length} hint="score < 2 · sin acción" />
              <div className={styles.rows}>
                {buckets.quiet.map((s) => (
                  <SymbolRow
                    key={s.symbol}
                    symbol={s}
                    onClick={onSymbolClick ? () => onSymbolClick(s) : undefined}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
};

// ─── helpers ───

interface SectionHeaderProps {
  label: string;
  count: number;
  hint?: string;
}
const SectionHeader: React.FC<SectionHeaderProps> = ({ label, count, hint }) => (
  <div className={styles.secHd}>
    <span className={`${styles.secHdLabel} label`}>▸ {label}</span>
    <span className={styles.secHdCount}>{count}</span>
    {hint && <span className={`${styles.secHdHint} prose`}>· {hint}</span>}
  </div>
);

interface ChipProps {
  active:   boolean;
  onClick:  () => void;
  children: React.ReactNode;
}
const Chip: React.FC<ChipProps> = ({ active, onClick, children }) => (
  <button
    className={[styles.chip, active ? styles.chipActive : ''].filter(Boolean).join(' ')}
    onClick={onClick}
  >
    {children}
  </button>
);

interface EmptyProps {
  kind:  'no-signals' | 'no-data';
  total: number;
}
const Empty: React.FC<EmptyProps> = ({ kind, total }) => (
  <div className={styles.empty}>
    <div className={styles.emptyMark}>∅</div>
    <div className={styles.emptyTitle}>
      {kind === 'no-signals' ? 'Sin señales activas' : 'Sin datos'}
    </div>
    <div className={`${styles.emptyBody} prose`}>
      {kind === 'no-signals'
        ? `El scanner está monitoreando ${total} pares en busca de oportunidades`
        : 'Esperando datos del scanner…'}
    </div>
  </div>
);

export default SymbolsGrid;
