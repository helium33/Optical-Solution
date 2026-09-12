import { useState } from 'react';
import ChartCard from './ChartCard';
import { formatDuration, toDecimalHours } from '../../lib/time';

/**
 * Overtime, ranked.
 *
 * One series, so there is no legend — the title already says what is plotted,
 * and a legend box with a single swatch just restates it. The bars carry the
 * overtime orange rather than the default first slot because overtime is the
 * same entity here as it is in every other view; colour follows the entity, not
 * the chart it happens to appear in.
 */
export default function OvertimeBreakdownChart({ items, title, subtitle, emptyHint, className = '' }) {
  const [hover, setHover] = useState(null);

  const ranked = [...items]
    .filter((item) => item.overtimeMinutes > 0)
    .sort((a, b) => b.overtimeMinutes - a.overtimeMinutes)
    .slice(0, 8);

  const max = Math.max(1, ...ranked.map((item) => item.overtimeMinutes));
  const total = ranked.reduce((sum, item) => sum + item.overtimeMinutes, 0);
  const topShare = total ? Math.round((ranked[0].overtimeMinutes / total) * 100) : null;

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      table={<OvertimeTable items={ranked} />}
      className={className}
    >
      {ranked.length === 0 ? (
        <div className="grid h-full min-h-[180px] place-items-center rounded-2xl bg-surface-sunken/50 px-6 text-center">
          <div>
            <p className="text-sm font-semibold text-ink">No overtime claimed</p>
            <p className="mt-1 text-xs text-ink-muted">{emptyHint}</p>
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col">
        <ul className="space-y-3">
          {ranked.map((item, index) => (
            <li
              key={item.id}
              onPointerEnter={() => setHover(index)}
              onPointerLeave={() => setHover(null)}
              className={`transition-opacity duration-200 ${
                hover !== null && hover !== index ? 'opacity-50' : 'opacity-100'
              }`}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs font-semibold text-ink">{item.label}</span>
                {/* Bars label at the tip; the value is the point of the row. */}
                <span className="shrink-0 text-xs font-bold text-ink tabular">
                  {formatDuration(item.overtimeMinutes)}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken">
                <div
                  className="h-full rounded-full bg-viz-2 transition-all duration-600 ease-expo"
                  style={{ width: `${Math.max(3, (item.overtimeMinutes / max) * 100)}%` }}
                  role="img"
                  aria-label={`${item.label}: ${formatDuration(item.overtimeMinutes)} of overtime`}
                />
              </div>
            </li>
          ))}
        </ul>

        {/* The rows answer "who"; this answers "how much, in total" — and it
            gives the card a baseline so it does not float in a half-empty
            box beside the taller trend chart. */}
        <div className="mt-auto space-y-2 pt-6">
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="eyebrow">Total overtime</span>
            <span className="text-2xl font-bold tracking-tight text-ot-ink">
              {formatDuration(total)}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">
            {toDecimalHours(total)} hours across {ranked.length}{' '}
            {ranked.length === 1 ? 'entry' : 'entries'}
            {topShare != null ? ` · ${ranked[0].label} accounts for ${topShare}%` : ''}
          </p>
        </div>
        </div>
      )}
    </ChartCard>
  );
}

function OvertimeTable({ items }) {
  return (
    <div className="overflow-auto rounded-2xl border border-line">
      <table className="w-full text-left text-xs">
        <thead className="bg-surface-sunken text-ink-subtle">
          <tr>
            <th className="px-3 py-2 font-semibold">Name</th>
            <th className="px-3 py-2 text-right font-semibold">Overtime</th>
            <th className="px-3 py-2 text-right font-semibold">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-ink-subtle">
                Nothing to show
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <td className="px-3 py-2 font-medium text-ink">{item.label}</td>
                <td className="px-3 py-2 text-right text-ink-muted">
                  {formatDuration(item.overtimeMinutes)}
                </td>
                <td className="px-3 py-2 text-right text-ink-muted">
                  {toDecimalHours(item.overtimeMinutes)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
