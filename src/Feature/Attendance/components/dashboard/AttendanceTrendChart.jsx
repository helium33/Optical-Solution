import { useState } from 'react';
import ChartCard from './ChartCard';
import { formatDayLabel } from '../../lib/time';

/**
 * Attendance by day — a stacked column per business day.
 *
 * Encoding notes:
 *   - On time and Late are the two hue-bearing series (the validated blue /
 *     orange pair — worst-case CVD separation 24.7 in light, 26.8 in dark).
 *   - Absent is a NEUTRAL grey, not a third hue. Semantically it is the
 *     "nothing happened" category and should recede; practically, the obvious
 *     third choice (red) fails the colour checks hard against orange — 7.1
 *     normal-vision separation, which even full-colour readers cannot split.
 *   - A 2px gap in the surface colour separates the segments. The gap does the
 *     separating; no segment is given a stroke.
 *
 * A single-day range gets a proportion bar instead of a one-column chart,
 * because a bar chart with one bar is a stat tile wearing a costume.
 */

const SERIES = [
  { key: 'onTime', label: 'On time', className: 'bg-viz-1' },
  { key: 'late', label: 'Late', className: 'bg-viz-2' },
  { key: 'absent', label: 'No punch', className: 'bg-viz-muted' },
];

export default function AttendanceTrendChart({ daily, className = '' }) {
  const single = daily.length === 1;

  return (
    <ChartCard
      title="Attendance"
      subtitle={
        single
          ? 'Everyone rostered today'
          : `${daily.length} days · people on the roster with and without a punch`
      }
      legend={SERIES}
      table={<TrendTable daily={daily} />}
      className={className}
    >
      {single ? <ProportionBar day={daily[0]} /> : <Columns daily={daily} />}
    </ChartCard>
  );
}

/* ─────────────────────────── multi-day columns ────────────────────────── */

function Columns({ daily }) {
  const [hover, setHover] = useState(null);

  const max = Math.max(1, ...daily.map((day) => day.present + day.absent));
  const ticks = axisTicks(max);
  const plotMax = ticks[ticks.length - 1];

  return (
    <div className="relative">
      <div className="flex gap-3">
        {/* y axis */}
        <div className="relative w-8 shrink-0" style={{ height: 220 }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-[10px] font-medium text-ink-subtle tabular"
              style={{ bottom: `${(tick / plotMax) * 100}%` }}
            >
              {tick}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1" style={{ height: 220 }}>
          {/* hairline gridlines, solid and recessive */}
          {ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden="true"
              className={`absolute inset-x-0 h-px ${tick === 0 ? 'bg-viz-axis' : 'bg-viz-grid'}`}
              style={{ bottom: `${(tick / plotMax) * 100}%` }}
            />
          ))}

          <div className="absolute inset-0 flex items-end justify-between gap-[2px]">
            {daily.map((day, index) => {
              const total = day.present + day.absent;
              const active = hover === index;
              return (
                <button
                  key={day.dayKey}
                  type="button"
                  /* The hit target is the whole column slot, not the painted
                     bar — a 6px bar is not something a thumb can find. */
                  className="group relative flex h-full flex-1 flex-col justify-end outline-none"
                  onPointerEnter={() => setHover(index)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  aria-label={`${formatDayLabel(day.dayKey)}: ${day.onTime} on time, ${day.late} late, ${day.absent} without a punch`}
                >
                  <span
                    className={`mx-auto flex w-full max-w-[24px] flex-col justify-end gap-[2px] transition-opacity duration-200 ${
                      hover !== null && !active ? 'opacity-45' : 'opacity-100'
                    }`}
                    style={{ height: `${(total / plotMax) * 100}%` }}
                  >
                    {/* Stack order runs bottom-up; reverse so On time sits at
                        the base where the eye compares it against the axis. */}
                    {[...SERIES].reverse().map((series) => {
                      const value = day[series.key];
                      if (!value) return null;
                      return (
                        <span
                          key={series.key}
                          className={`${series.className} w-full`}
                          style={{
                            flexGrow: value,
                            /* 4px rounded data-end, square at the baseline. */
                            borderRadius:
                              series.key === topSeriesKey(day) ? '4px 4px 0 0' : '0',
                            minHeight: 2,
                          }}
                        />
                      );
                    })}
                  </span>
                </button>
              );
            })}
          </div>

          {hover !== null ? <Tooltip day={daily[hover]} index={hover} count={daily.length} /> : null}
        </div>
      </div>

      {/* x axis — label first, last and a couple between, never all 30 */}
      <div className="ml-11 mt-2 flex justify-between text-[10px] font-medium text-ink-subtle">
        {sparseLabels(daily).map((entry) => (
          <span key={entry.dayKey}>{formatDayLabel(entry.dayKey, { weekday: undefined })}</span>
        ))}
      </div>
    </div>
  );
}

/** Which series is drawn at the top of this day's stack (gets the rounded cap). */
const topSeriesKey = (day) => {
  if (day.absent) return 'absent';
  if (day.late) return 'late';
  return 'onTime';
};

function Tooltip({ day, index, count }) {
  /* Anchor near the column, flipping side near the edges so it never clips. */
  const position = (index + 0.5) / count;
  const align = position > 0.7 ? 'right' : position < 0.3 ? 'left' : 'center';

  /* Anchored INSIDE the plot rather than above it. Floating it above meant it
     sat on top of the card's title and the chart/table switch — a tooltip that
     covers the control you were about to press is worse than no tooltip. It is
     frosted so the bars behind it stay legible. */
  return (
    <div
      role="tooltip"
      className="glass-strong pointer-events-none absolute top-1 z-20 w-44 rounded-2xl p-3 shadow-lift"
      style={{
        left: align === 'right' ? 'auto' : align === 'left' ? '0%' : `${position * 100}%`,
        right: align === 'right' ? '0%' : 'auto',
        transform: align === 'center' ? 'translateX(-50%)' : 'none',
      }}
    >
      <p className="mb-2 text-[11px] font-bold text-ink">{formatDayLabel(day.dayKey)}</p>
      <dl className="space-y-1">
        {SERIES.map((series) => (
          <div key={series.key} className="flex items-center gap-2">
            {/* Line key, not a filled box — a box is data-weight ink here. */}
            <span className={`h-0.5 w-3 rounded-full ${series.className}`} aria-hidden="true" />
            {/* Value leads, label follows: the reader has the series already. */}
            <dd className="text-xs font-bold text-ink tabular">{day[series.key]}</dd>
            <dt className="text-[11px] text-ink-subtle">{series.label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ───────────────────────────── single day ─────────────────────────────── */

function ProportionBar({ day }) {
  const total = Math.max(1, day.present + day.absent);

  return (
    <div>
      <div className="flex h-14 gap-[2px] overflow-hidden rounded-2xl">
        {SERIES.map((series) => {
          const value = day[series.key];
          if (!value) return null;
          const share = value / total;
          return (
            <div
              key={series.key}
              className={`${series.className} relative grid place-items-center transition-all duration-500 ease-expo`}
              style={{ flexGrow: value }}
              title={`${series.label}: ${value}`}
            >
              {/* Only label inside when the text demonstrably fits. */}
              {share > 0.12 ? (
                <span className="text-sm font-bold text-white drop-shadow-sm tabular">{value}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        {SERIES.map((series) => (
          <div key={series.key} className="rounded-2xl bg-surface-sunken/60 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-[11px] font-medium text-ink-subtle">
              <span className={`h-2 w-2 rounded-[2px] ${series.className}`} aria-hidden="true" />
              {series.label}
            </dt>
            <dd className="mt-0.5 text-lg font-bold tracking-tight text-ink tabular">
              {day[series.key]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ───────────────────────────── table view ─────────────────────────────── */

function TrendTable({ daily }) {
  return (
    <div className="max-h-[280px] overflow-auto rounded-2xl border border-line">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface-sunken">
          <tr className="text-ink-subtle">
            <th className="px-3 py-2 font-semibold">Day</th>
            {SERIES.map((series) => (
              <th key={series.key} className="px-3 py-2 text-right font-semibold">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {daily.map((day) => (
            <tr key={day.dayKey}>
              <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                {formatDayLabel(day.dayKey)}
              </td>
              {SERIES.map((series) => (
                <td key={series.key} className="px-3 py-2 text-right text-ink-muted">
                  {day[series.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── helpers ────────────────────────────────── */

/** Clean round tick values: 0 … max, at most 4 lines. */
function axisTicks(max) {
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return ticks;
}

function niceStep(raw) {
  if (raw <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const snapped = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return snapped * magnitude;
}

function sparseLabels(daily) {
  if (daily.length <= 5) return daily;
  const step = Math.ceil(daily.length / 5);
  const picked = daily.filter((unused, index) => index % step === 0);
  if (picked[picked.length - 1] !== daily[daily.length - 1]) picked.push(daily[daily.length - 1]);
  return picked;
}
