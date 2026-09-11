import { useEffect, useMemo, useState } from 'react';
import { LuGlasses, LuLogOut, LuUsers, LuTimer, LuCircleAlert, LuExternalLink } from 'react-icons/lu';

import ThemeToggle from '../components/ui/ThemeToggle';
import Avatar from '../components/ui/Avatar';
import FilterBar from '../components/dashboard/FilterBar';
import StatTile from '../components/dashboard/StatTile';
import AttendanceTrendChart from '../components/dashboard/AttendanceTrendChart';
import OvertimeBreakdownChart from '../components/dashboard/OvertimeBreakdownChart';
import AttendanceTable from '../components/dashboard/AttendanceTable';

import { useAuth } from '../auth/AuthProvider';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';
import { useAttendanceReport, resolveRange } from '../hooks/useAttendanceReport';
import { subscribeAllStaff } from '../services/staff.service';
import { BRANCHES, BRANCH_IDS, getBranch } from '../config/branches';
import { formatDuration, toDecimalHours } from '../lib/time';

/**
 * Reporting for all three shops.
 *
 * The one idea worth calling out: selecting a branch in the filter bar re-themes
 * the entire dashboard to that branch's palette. It is not decoration — with
 * three shops in one table, the ambient colour is a constant, peripheral answer
 * to "whose numbers am I looking at?", which is exactly the question people get
 * wrong when they screenshot a dashboard and send it to the wrong supervisor.
 */
export default function AdminDashboardPage() {
  const { principal, signOut } = useAuth();
  const { setBranch } = useBranchTheme();

  const [filters, setFilters] = useState({
    range: '30d',
    branchId: 'all',
    role: null,
    overtimeOnly: false,
  });
  const [roster, setRoster] = useState([]);

  const branch = filters.branchId === 'all' ? null : getBranch(filters.branchId);
  const timezone = branch?.timezone ?? 'Asia/Yangon';

  /* The dashboard wears the branch it is filtered to. */
  useEffect(() => {
    setBranch(branch?.theme ?? HOUSE_THEME);
  }, [branch, setBranch]);

  useEffect(() => subscribeAllStaff(setRoster, () => setRoster([])), []);

  const range = useMemo(
    () => resolveRange(filters.range, { timeZone: timezone }),
    [filters.range, timezone],
  );

  const branchIds = useMemo(
    () => (filters.branchId === 'all' ? BRANCH_IDS : [filters.branchId]),
    [filters.branchId],
  );

  const roles = useMemo(() => (filters.role ? [filters.role] : null), [filters.role]);

  const report = useAttendanceReport({
    branchIds,
    fromKey: range.fromKey,
    toKey: range.toKey,
    roles,
    overtimeOnly: filters.overtimeOnly,
    roster,
  });

  const { totals, daily, loading } = report;

  /* When every branch is in view, compare branches. When one is selected,
     comparing it to itself is a one-bar chart — show the people instead. */
  const breakdown = useMemo(() => {
    if (filters.branchId === 'all') {
      return report.groupBy('branchId').map((entry) => ({
        ...entry,
        label: BRANCHES[entry.id]?.name ?? entry.id,
      }));
    }
    return report.groupBy('staffId');
  }, [report, filters.branchId]);

  const rate = totals.attendanceRate;

  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-line bg-surface-card/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-brand-on shadow-soft">
              <LuGlasses className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-bold leading-tight tracking-tight text-ink">
                Attendance
              </h1>
              <p className="truncate text-xs text-ink-subtle">
                {branch ? branch.name : 'Win · Pwint · Yangon'} · {range.label}
              </p>
            </div>
          </div>

          <a
            href="/attendance/kiosk"
            className="hidden items-center gap-1.5 rounded-2xl border border-line px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink sm:inline-flex"
          >
            Open kiosk
            <LuExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>

          <ThemeToggle />

          <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface-card py-1.5 pl-1.5 pr-1.5 shadow-soft">
            <Avatar name={principal?.displayName} seed={principal?.uid} size={32} />
            <span className="hidden min-w-0 max-w-[140px] flex-col leading-tight sm:flex">
              <span className="truncate text-xs font-bold text-ink">{principal?.displayName}</span>
              <span className="truncate text-[11px] text-ink-subtle">Administrator</span>
            </span>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="grid h-8 w-8 place-items-center rounded-xl text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger-ink"
            >
              <LuLogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <FilterBar filters={filters} onChange={setFilters} />

        {report.error ? (
          <p className="mb-6 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger-ink" role="alert">
            {report.error}
          </p>
        ) : null}

        {/* ---- headline figures ---- */}
        <section
          className={`mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}
        >
          <StatTile
            hero
            label="Attendance rate"
            value={rate == null ? '—' : `${Math.round(rate * 100)}%`}
            caption={
              rate == null
                ? 'No roster data for this range'
                : `${totals.present} of ${totals.expected} expected shifts had a punch`
            }
            tone="brand"
            icon={LuUsers}
          />
          <StatTile
            label="Late arrivals"
            value={totals.late}
            caption={
              totals.present
                ? `${Math.round((totals.late / totals.present) * 100)}% of shifts worked`
                : 'No shifts in range'
            }
            tone={totals.late ? 'warn' : 'default'}
            icon={LuCircleAlert}
          />
          <StatTile
            label="Overtime hours"
            value={toDecimalHours(totals.overtimeMinutes)}
            caption={`${totals.overtimeClaims} ${totals.overtimeClaims === 1 ? 'claim' : 'claims'} · ${formatDuration(totals.overtimeMinutes)}`}
            tone={totals.overtimeMinutes ? 'ot' : 'default'}
            icon={LuTimer}
          />
        </section>

        {/* ---- charts ---- */}
        <section className="mb-6 grid gap-4 lg:grid-cols-3">
          <AttendanceTrendChart daily={daily} className="lg:col-span-2" />
          <OvertimeBreakdownChart
            items={breakdown}
            title="Overtime"
            subtitle={filters.branchId === 'all' ? 'By branch' : `By person · ${branch.shortName}`}
            emptyHint={
              filters.overtimeOnly
                ? 'The overtime-only filter is on and nothing matched.'
                : 'Nobody claimed overtime in this range.'
            }
          />
        </section>

        {/* ---- the log ---- */}
        <AttendanceTable rows={report.rows} loading={loading} timezone={timezone} />
      </main>
    </div>
  );
}
