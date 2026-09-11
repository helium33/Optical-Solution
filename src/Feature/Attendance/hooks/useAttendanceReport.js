import { useCallback, useEffect, useMemo, useState } from 'react';

import { queryAttendance } from '../services/attendance.service';
import { businessDayKey, dayKeyRange, ATTENDANCE_STATUS } from '../lib/time';

/**
 * Turns raw attendance documents into the shapes the dashboard draws.
 *
 * One query, one aggregation, many views — the filter bar scopes everything
 * below it, so the stat tiles, both charts and the table can never disagree
 * about what "this month" means.
 */

export const RANGE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'mtd', label: 'This month' },
];

const shiftDayKey = (key, days) => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

/** Resolve a preset (or an explicit custom range) into inclusive day keys. */
export function resolveRange(preset, { now = new Date(), timeZone = 'Asia/Yangon', custom } = {}) {
  const today = businessDayKey(now, timeZone);

  if (preset === 'custom' && custom?.fromKey && custom?.toKey) {
    return { fromKey: custom.fromKey, toKey: custom.toKey, label: 'Custom range' };
  }
  switch (preset) {
    case 'today':
      return { fromKey: today, toKey: today, label: 'Today' };
    case '7d':
      return { fromKey: shiftDayKey(today, -6), toKey: today, label: 'Last 7 days' };
    case 'mtd':
      return { fromKey: `${today.slice(0, 7)}-01`, toKey: today, label: 'This month' };
    case '30d':
    default:
      return { fromKey: shiftDayKey(today, -29), toKey: today, label: 'Last 30 days' };
  }
}

const emptyDay = (dayKey) => ({
  dayKey,
  onTime: 0,
  late: 0,
  present: 0,
  absent: 0,
  workedMinutes: 0,
  regularMinutes: 0,
  overtimeMinutes: 0,
});

export function useAttendanceReport({
  branchIds,
  fromKey,
  toKey,
  roles = null,
  overtimeOnly = false,
  roster = [],
}) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!branchIds?.length || !fromKey || !toKey) {
      setRows([]);
      return undefined;
    }

    let cancelled = false;
    setError(null);

    queryAttendance({ branchIds, fromKey, toKey, roles, overtimeOnly })
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((queryError) => {
        if (cancelled) return;
        setRows([]);
        setError(queryError?.message ?? 'Could not load attendance.');
      });

    return () => {
      cancelled = true;
    };
  }, [branchIds, fromKey, toKey, roles, overtimeOnly, nonce]);

  /**
   * Expected headcount. Without a shift-roster collection, "absent" means
   * "active on this branch and no punch that day" — which over-counts on a
   * staff member's day off. Recorded here rather than hidden: the fix is a
   * `schedules` collection, and the chart labels this series honestly.
   */
  const expectedHeadcount = useMemo(() => {
    const filtered = roles?.length ? roster.filter((p) => roles.includes(p.role)) : roster;
    return branchIds?.length
      ? filtered.filter((p) => branchIds.includes(p.branchId)).length
      : filtered.length;
  }, [roster, roles, branchIds]);

  const daily = useMemo(() => {
    if (!rows) return [];
    const byDay = new Map(dayKeyRange(fromKey, toKey).map((key) => [key, emptyDay(key)]));

    for (const row of rows) {
      const entry = byDay.get(row.dayKey);
      if (!entry) continue;
      entry.present += 1;
      if (row.status === ATTENDANCE_STATUS.LATE) entry.late += 1;
      else entry.onTime += 1;
      entry.workedMinutes += row.minutes?.worked ?? 0;
      entry.regularMinutes += row.minutes?.regular ?? 0;
      entry.overtimeMinutes += row.minutes?.overtime ?? 0;
    }

    for (const entry of byDay.values()) {
      entry.absent = Math.max(0, expectedHeadcount - entry.present);
    }
    return [...byDay.values()];
  }, [rows, fromKey, toKey, expectedHeadcount]);

  const totals = useMemo(() => {
    const base = daily.reduce(
      (acc, day) => ({
        onTime: acc.onTime + day.onTime,
        late: acc.late + day.late,
        present: acc.present + day.present,
        absent: acc.absent + day.absent,
        workedMinutes: acc.workedMinutes + day.workedMinutes,
        regularMinutes: acc.regularMinutes + day.regularMinutes,
        overtimeMinutes: acc.overtimeMinutes + day.overtimeMinutes,
      }),
      { onTime: 0, late: 0, present: 0, absent: 0, workedMinutes: 0, regularMinutes: 0, overtimeMinutes: 0 },
    );
    const expected = base.present + base.absent;
    return {
      ...base,
      expected,
      /* Attendance rate: turned up at all, late or not. */
      attendanceRate: expected ? base.present / expected : null,
      punctualityRate: base.present ? base.onTime / base.present : null,
      overtimeClaims: (rows ?? []).filter((row) => (row.minutes?.overtime ?? 0) > 0).length,
    };
  }, [daily, rows]);

  /** Grouped rollups for the comparison chart. */
  const groupBy = useCallback(
    (key) => {
      const map = new Map();
      for (const row of rows ?? []) {
        const id = row[key];
        if (!map.has(id)) {
          map.set(id, {
            id,
            label: key === 'staffId' ? row.staffName : id,
            present: 0,
            late: 0,
            workedMinutes: 0,
            overtimeMinutes: 0,
          });
        }
        const entry = map.get(id);
        entry.present += 1;
        if (row.status === ATTENDANCE_STATUS.LATE) entry.late += 1;
        entry.workedMinutes += row.minutes?.worked ?? 0;
        entry.overtimeMinutes += row.minutes?.overtime ?? 0;
      }
      return [...map.values()];
    },
    [rows],
  );

  return {
    rows: rows ?? [],
    loading: rows === null,
    error,
    daily,
    totals,
    expectedHeadcount,
    groupBy,
    refresh: () => setNonce((n) => n + 1),
  };
}
