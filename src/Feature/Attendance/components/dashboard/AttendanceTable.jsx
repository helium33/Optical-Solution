import { useMemo, useState } from 'react';
import { LuDownload, LuChevronDown } from 'react-icons/lu';

import Avatar from '../ui/Avatar';
import StatusPill from '../ui/StatusPill';
import { formatClock, formatDayLabel, formatDuration, toDecimalHours } from '../../lib/time';
import { roleLabel } from '../../config/roles';
import { BRANCHES } from '../../config/branches';

/**
 * The log itself. Everything the charts summarise is reachable here as text,
 * one row per person per day.
 *
 * Sorted newest-first by default because the question is almost always about
 * something that just happened. The CSV export carries decimal hours as well as
 * the human-readable duration — payroll software wants 8.25, a person wants
 * "8h 15m", and shipping only one of them guarantees somebody retypes it.
 */

const COLUMNS = [
  { key: 'staffName', label: 'Name', align: 'left' },
  { key: 'dayKey', label: 'Day', align: 'left' },
  { key: 'checkIn', label: 'In', align: 'left', sortable: false },
  { key: 'checkOut', label: 'Out', align: 'left', sortable: false },
  { key: 'worked', label: 'Worked', align: 'right' },
  { key: 'overtime', label: 'Overtime', align: 'right' },
  { key: 'status', label: 'Status', align: 'left', sortable: false },
];

export default function AttendanceTable({ rows, loading, timezone = 'Asia/Yangon' }) {
  const [sort, setSort] = useState({ key: 'dayKey', direction: 'desc' });
  const [limit, setLimit] = useState(25);

  const sorted = useMemo(() => {
    const value = (row) => {
      switch (sort.key) {
        case 'worked':
          return row.minutes?.worked ?? 0;
        case 'overtime':
          return row.minutes?.overtime ?? 0;
        case 'staffName':
          return String(row.staffName ?? '');
        default:
          return String(row.dayKey ?? '');
      }
    };
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (typeof left === 'string') return left.localeCompare(right) * factor;
      return (left - right) * factor;
    });
  }, [rows, sort]);

  const visible = sorted.slice(0, limit);

  const toggleSort = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'desc' },
    );

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div>
          <h3 className="text-[15px] font-bold tracking-tight text-ink">Attendance log</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {loading ? 'Loading…' : `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadCsv(sorted, timezone)}
          disabled={!rows.length}
          className="inline-flex items-center gap-2 rounded-2xl border border-line bg-surface-card px-3.5 py-2 text-xs font-semibold text-ink-muted shadow-soft transition-colors hover:border-brand-500/40 hover:text-ink disabled:opacity-40"
        >
          <LuDownload className="h-3.5 w-3.5" aria-hidden="true" />
          Export CSV
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken/50">
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle ${
                    column.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  {column.sortable === false ? (
                    column.label
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex items-center gap-1 transition-colors hover:text-ink"
                    >
                      {column.label}
                      <LuChevronDown
                        className={`h-3 w-3 transition-all ${
                          sort.key === column.key
                            ? `opacity-100 ${sort.direction === 'asc' ? 'rotate-180' : ''}`
                            : 'opacity-25'
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-line">
            {loading ? (
              [...Array(5)].map((unused, index) => (
                <tr key={index}>
                  <td colSpan={COLUMNS.length} className="px-4 py-4">
                    <span className="relative block h-5 overflow-hidden rounded-lg bg-surface-sunken">
                      <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-surface-card to-transparent" />
                    </span>
                  </td>
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-14 text-center">
                  <p className="text-sm font-semibold text-ink">No records in this range</p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Try widening the date range or clearing a filter.
                  </p>
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const overtime = row.minutes?.overtime ?? 0;
                return (
                  <tr key={row.id} className="transition-colors hover:bg-surface-sunken/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={row.staffName} seed={row.staffId} size={34} />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">{row.staffName}</p>
                          <p className="truncate text-xs text-ink-subtle">
                            {roleLabel(row.role)} · {BRANCHES[row.branchId]?.shortName ?? row.branchId}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                      {formatDayLabel(row.dayKey)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                      {row.checkIn?.at ? formatClock(row.checkIn.at, row.timezone ?? timezone) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">
                      {row.checkOut?.at ? formatClock(row.checkOut.at, row.timezone ?? timezone) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">
                      {formatDuration(row.minutes?.worked ?? 0)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      {overtime > 0 ? (
                        <span className="font-bold text-ot-ink">+{formatDuration(overtime)}</span>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusPill size="sm" status={row.status} />
                        {row.overtime?.capped ? (
                          <StatusPill size="sm" status="overtime" label="Needs review" />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {visible.length < sorted.length ? (
        <div className="border-t border-line p-4 text-center">
          <button
            type="button"
            onClick={() => setLimit((value) => value + 50)}
            className="rounded-2xl bg-surface-sunken px-4 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink"
          >
            Show more ({sorted.length - visible.length} remaining)
          </button>
        </div>
      ) : null}
    </section>
  );
}

function downloadCsv(rows, fallbackTimezone) {
  const header = [
    'Day', 'Branch', 'Name', 'Role', 'Check in', 'Check out',
    'Worked (h:m)', 'Worked (decimal)', 'Overtime (h:m)', 'Overtime (decimal)',
    'Late (min)', 'Status', 'Overtime claimed', 'Needs review',
  ];

  const body = rows.map((row) => {
    const tz = row.timezone ?? fallbackTimezone;
    return [
      row.dayKey,
      BRANCHES[row.branchId]?.name ?? row.branchId,
      row.staffName,
      roleLabel(row.role),
      row.checkIn?.at ? formatClock(row.checkIn.at, tz) : '',
      row.checkOut?.at ? formatClock(row.checkOut.at, tz) : '',
      formatDuration(row.minutes?.worked ?? 0),
      toDecimalHours(row.minutes?.worked ?? 0),
      formatDuration(row.minutes?.overtime ?? 0),
      toDecimalHours(row.minutes?.overtime ?? 0),
      row.minutes?.late ?? 0,
      row.status,
      row.overtime?.claimed ? 'yes' : 'no',
      row.overtime?.capped ? 'yes' : 'no',
    ];
  });

  /* Quote every field: names and roles can contain commas. */
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  /* Lead with a BOM so Excel opens the file as UTF-8 and Burmese names
     do not arrive as mojibake. */
  const url = URL.createObjectURL(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
