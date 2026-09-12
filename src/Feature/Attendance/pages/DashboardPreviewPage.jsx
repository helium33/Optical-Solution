import { useEffect, useMemo, useState } from 'react';
import { LuUsers, LuTimer, LuCircleAlert, LuFlaskConical, LuNetwork } from 'react-icons/lu';

import FilterBar from '../components/dashboard/FilterBar';
import StatTile from '../components/dashboard/StatTile';
import AttendanceTrendChart from '../components/dashboard/AttendanceTrendChart';
import OvertimeBreakdownChart from '../components/dashboard/OvertimeBreakdownChart';
import AttendanceTable from '../components/dashboard/AttendanceTable';
import OrgTree from '../components/dashboard/OrgTree';
import AddStaffDialog from '../components/dashboard/AddStaffDialog';
import StaffDetailDialog from '../components/dashboard/StaffDetailDialog';
import BranchSettingsDialog from '../components/dashboard/BranchSettingsDialog';
import ThemeToggle from '../components/ui/ThemeToggle';
import Segmented from '../components/ui/Segmented';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';
import { BRANCHES, BRANCH_IDS } from '../config/branches';
import { STAFF_ROLE_ORDER } from '../config/roles';
import { dayKeyRange, businessDayKey, toDecimalHours, formatDuration } from '../lib/time';

/**
 * Dashboard preview with synthetic data. DEV BUILDS ONLY — the route that
 * mounts it is gated on import.meta.env.DEV, so it does not exist in a
 * production bundle.
 *
 * It exists because the dashboard is unreadable until there are a few hundred
 * attendance records in it, and nobody has a few hundred records on the day
 * they set the project up. This lets the design be judged, and the charts be
 * changed, before a single Firebase credential has been typed.
 */

/* Deterministic PRNG so the "data" is identical on every reload — a chart that
   reshuffles every refresh is impossible to iterate on. */
const seeded = (seed) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
};

const NAMES = [
  'Aye Aye Mon', 'Thiri Khine', 'Kyaw Zin Latt', 'Nilar Win',
  'May Thu Aung', 'Zaw Htet Naing', 'Hnin Ei Phyu', 'Soe Moe Kyaw',
  'Khin Myat Noe', 'Tun Tun Oo', 'Su Su Hlaing', 'Aung Ko Ko',
];

function buildFixture() {
  const random = seeded(20260911);
  const today = businessDayKey(new Date(), 'Asia/Yangon');
  const [y, m, d] = today.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - 29));
  const fromKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`;
  const keys = dayKeyRange(fromKey, today);

  const roster = NAMES.map((name, index) => ({
    id: `staff-${index}`,
    name,
    branchId: BRANCH_IDS[index % 3],
    role: STAFF_ROLE_ORDER[3 - (index % 4)],
    employeeCode: `${BRANCH_IDS[index % 3].slice(0, 3).toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
    hasBiometrics: index % 3 === 0,
    active: true,
  }));

  const rows = [];
  for (const dayKey of keys) {
    for (const person of roster) {
      if (random() < 0.09) continue; // a day off or an absence

      const late = random() < 0.11;
      const lateBy = late ? 8 + Math.floor(random() * 25) : 0;
      const claimsOvertime = random() < 0.16;
      const overtime = claimsOvertime ? 20 + Math.floor(random() * 130) : 0;
      const worked = 450 + Math.floor(random() * 25) + overtime;

      rows.push({
        id: `${person.id}-${dayKey}`,
        staffId: person.id,
        staffName: person.name,
        branchId: person.branchId,
        role: person.role,
        dayKey,
        timezone: 'Asia/Yangon',
        checkIn: { at: `${dayKey}T${String(2).padStart(2, '0')}:${String(30 + lateBy).padStart(2, '0')}:00Z` },
        checkOut: { at: `${dayKey}T11:${String(Math.min(59, 10 + Math.floor(overtime / 4))).padStart(2, '0')}:00Z` },
        status: late ? 'late' : 'on_time',
        minutes: {
          worked,
          regular: worked - overtime,
          overtime,
          late: lateBy,
          gross: worked + 60,
          break: 60,
          earlyLeave: 0,
        },
        overtime: {
          claimed: claimsOvertime,
          grantedMinutes: overtime,
          eligibleMinutes: overtime,
          capped: overtime > 140,
          reason: overtime > 140 ? 'capped-pending-review' : null,
        },
      });
    }
  }

  return { keys, roster, rows };
}

export default function DashboardPreviewPage() {
  const { setBranch } = useBranchTheme();
  const [filters, setFilters] = useState({
    range: '30d',
    branchId: 'all',
    role: null,
    overtimeOnly: false,
  });
  const [view, setView] = useState('overview');
  const [addingTo, setAddingTo] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  const [settingsFor, setSettingsFor] = useState(null);

  const { keys, roster, rows: allRows } = useMemo(buildFixture, []);

  const branch = filters.branchId === 'all' ? null : BRANCHES[filters.branchId];
  useEffect(() => setBranch(branch?.theme ?? HOUSE_THEME), [branch, setBranch]);

  const rows = useMemo(() => {
    let result = allRows;
    if (filters.branchId !== 'all') result = result.filter((r) => r.branchId === filters.branchId);
    if (filters.role) result = result.filter((r) => r.role === filters.role);
    if (filters.overtimeOnly) result = result.filter((r) => r.minutes.overtime > 0);
    if (filters.range === 'today') result = result.filter((r) => r.dayKey === keys[keys.length - 1]);
    else if (filters.range === '7d') result = result.filter((r) => keys.slice(-7).includes(r.dayKey));
    else if (filters.range === 'mtd') {
      const month = keys[keys.length - 1].slice(0, 7);
      result = result.filter((r) => r.dayKey.startsWith(month));
    }
    return result;
  }, [allRows, filters, keys]);

  const visibleKeys = useMemo(() => {
    if (filters.range === 'today') return keys.slice(-1);
    if (filters.range === '7d') return keys.slice(-7);
    if (filters.range === 'mtd') {
      const month = keys[keys.length - 1].slice(0, 7);
      return keys.filter((key) => key.startsWith(month));
    }
    return keys;
  }, [keys, filters.range]);

  const expected = useMemo(() => {
    let people = roster;
    if (filters.branchId !== 'all') people = people.filter((p) => p.branchId === filters.branchId);
    if (filters.role) people = people.filter((p) => p.role === filters.role);
    return people.length;
  }, [roster, filters]);

  const daily = useMemo(() => {
    const byDay = new Map(
      visibleKeys.map((dayKey) => [
        dayKey,
        { dayKey, onTime: 0, late: 0, present: 0, absent: 0, workedMinutes: 0, regularMinutes: 0, overtimeMinutes: 0 },
      ]),
    );
    for (const row of rows) {
      const entry = byDay.get(row.dayKey);
      if (!entry) continue;
      entry.present += 1;
      if (row.status === 'late') entry.late += 1;
      else entry.onTime += 1;
      entry.workedMinutes += row.minutes.worked;
      entry.regularMinutes += row.minutes.regular;
      entry.overtimeMinutes += row.minutes.overtime;
    }
    for (const entry of byDay.values()) entry.absent = Math.max(0, expected - entry.present);
    return [...byDay.values()];
  }, [rows, visibleKeys, expected]);

  const totals = useMemo(
    () =>
      daily.reduce(
        (acc, day) => ({
          present: acc.present + day.present,
          late: acc.late + day.late,
          absent: acc.absent + day.absent,
          overtimeMinutes: acc.overtimeMinutes + day.overtimeMinutes,
        }),
        { present: 0, late: 0, absent: 0, overtimeMinutes: 0 },
      ),
    [daily],
  );

  const breakdown = useMemo(() => {
    const key = filters.branchId === 'all' ? 'branchId' : 'staffId';
    const map = new Map();
    for (const row of rows) {
      const id = row[key];
      if (!map.has(id)) {
        map.set(id, {
          id,
          label: key === 'branchId' ? (BRANCHES[id]?.name ?? id) : row.staffName,
          overtimeMinutes: 0,
          present: 0,
        });
      }
      const entry = map.get(id);
      entry.overtimeMinutes += row.minutes.overtime;
      entry.present += 1;
    }
    return [...map.values()];
  }, [rows, filters.branchId]);

  const expectedTotal = totals.present + totals.absent;
  const rate = expectedTotal ? totals.present / expectedTotal : null;
  const claims = rows.filter((row) => row.minutes.overtime > 0).length;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <span className="inline-flex items-center gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-xs font-semibold text-warn-ink">
          <LuFlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
          Preview with sample data — not a real attendance record
        </span>
        <div className="flex items-center gap-3">
          <Segmented
            size="sm"
            label="View"
            options={[
              { value: 'overview', label: 'Reports' },
              { value: 'team', label: 'Team' },
            ]}
            value={view}
            onChange={setView}
          />
          <ThemeToggle />
        </div>
      </div>

      {view === 'team' ? (
        <section className="pt-2">
          <header className="mb-4">
            <h2 className="inline-flex items-center gap-2 text-base font-bold tracking-tight text-ink">
              <LuNetwork className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
              Team
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Grouped by seniority. Tap anyone to correct a day or take them off the system.
            </p>
          </header>
          <OrgTree
            staff={roster.map((person) => ({ ...person, active: true }))}
            logs={[]}
            branchIds={BRANCH_IDS}
            timezone="Asia/Yangon"
            onSelect={setDetailFor}
            onAdd={setAddingTo}
            onSettings={setSettingsFor}
          />
          <BranchSettingsDialog
            open={Boolean(settingsFor)}
            branch={settingsFor}
            actor={{ uid: 'preview-admin' }}
            onClose={() => setSettingsFor(null)}
          />
          <AddStaffDialog
            open={Boolean(addingTo)}
            branchId={addingTo}
            actor={{ uid: 'preview-admin' }}
            onClose={() => setAddingTo(null)}
          />
          <StaffDetailDialog
            open={Boolean(detailFor)}
            person={detailFor}
            actor={{ uid: 'preview-admin', displayName: 'Preview admin' }}
            onClose={() => setDetailFor(null)}
          />
        </section>
      ) : (
      <>
      <FilterBar filters={filters} onChange={setFilters} />

      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          hero
          label="Attendance rate"
          value={rate == null ? '—' : `${Math.round(rate * 100)}%`}
          caption={`${totals.present} of ${expectedTotal} expected shifts had a punch`}
          tone="brand"
          icon={LuUsers}
        />
        <StatTile
          label="Late arrivals"
          value={totals.late}
          caption={totals.present ? `${Math.round((totals.late / totals.present) * 100)}% of shifts worked` : 'No shifts in range'}
          tone={totals.late ? 'warn' : 'default'}
          icon={LuCircleAlert}
        />
        <StatTile
          label="Overtime hours"
          value={toDecimalHours(totals.overtimeMinutes)}
          caption={`${claims} ${claims === 1 ? 'claim' : 'claims'} · ${formatDuration(totals.overtimeMinutes)}`}
          tone={totals.overtimeMinutes ? 'ot' : 'default'}
          icon={LuTimer}
        />
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <AttendanceTrendChart daily={daily} className="lg:col-span-2" />
        <OvertimeBreakdownChart
          items={breakdown}
          title="Overtime"
          subtitle={filters.branchId === 'all' ? 'By branch' : `By person · ${branch.shortName}`}
          emptyHint="Nobody claimed overtime in this range."
        />
      </section>

      <AttendanceTable rows={rows} loading={false} timezone="Asia/Yangon" />
      </>
      )}
    </div>
  );
}
