import { useState } from 'react';
import { LuChartColumn, LuTable } from 'react-icons/lu';

/**
 * The frame every chart sits in: title, legend, and a chart/table switch.
 *
 * The table view is not a nicety. Three of the series colours sit below 3:1
 * against the light surface, and a tooltip is unreachable on a touch screen
 * being read over someone's shoulder — so every number a chart shows is also
 * reachable as text. Nothing on this dashboard is gated behind hovering.
 */
export default function ChartCard({ title, subtitle, legend = [], table = null, children, className = '' }) {
  const [view, setView] = useState('chart');

  return (
    <section className={`card card-pad flex flex-col ${className}`}>
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold tracking-tight text-ink">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p> : null}
        </div>

        {table ? (
          <div className="flex shrink-0 rounded-xl border border-line bg-surface-sunken p-0.5">
            <ViewButton active={view === 'chart'} onClick={() => setView('chart')} label="Chart">
              <LuChartColumn className="h-3.5 w-3.5" aria-hidden="true" />
            </ViewButton>
            <ViewButton active={view === 'table'} onClick={() => setView('table')} label="Table">
              <LuTable className="h-3.5 w-3.5" aria-hidden="true" />
            </ViewButton>
          </div>
        ) : null}
      </header>

      {/* A legend is always present for two or more series — identity must never
          rest on colour-matching alone. */}
      {legend.length > 1 && view === 'chart' ? (
        <ul className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-[3px] ${item.className}`} aria-hidden="true" />
              <span className="text-xs font-medium text-ink-muted">{item.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex-1">{view === 'chart' ? children : table}</div>
    </section>
  );
}

const ViewButton = ({ active, onClick, label, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    aria-label={`${label} view`}
    className={`grid h-7 w-8 place-items-center rounded-lg transition-colors ${
      active ? 'bg-surface-card text-ink shadow-soft' : 'text-ink-subtle hover:text-ink-muted'
    }`}
  >
    {children}
  </button>
);
