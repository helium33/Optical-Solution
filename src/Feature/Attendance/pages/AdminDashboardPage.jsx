import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LuGlasses, LuLogOut, LuUsers, LuTimer, LuCircleAlert, LuExternalLink,
  LuNetwork,
} from 'react-icons/lu';

import ThemeToggle from '../components/ui/ThemeToggle';
import LanguageToggle from '../components/ui/LanguageToggle';
import Avatar from '../components/ui/Avatar';
import FilterBar from '../components/dashboard/FilterBar';
import StatTile from '../components/dashboard/StatTile';
import AttendanceTrendChart from '../components/dashboard/AttendanceTrendChart';
import OvertimeBreakdownChart from '../components/dashboard/OvertimeBreakdownChart';
import AttendanceTable from '../components/dashboard/AttendanceTable';
import OrgTree from '../components/dashboard/OrgTree';
import AddStaffDialog from '../components/dashboard/AddStaffDialog';
import StaffDetailDialog from '../components/dashboard/StaffDetailDialog';
import BranchSettingsDialog from '../components/dashboard/BranchSettingsDialog';
import MonthlySummary from '../components/dashboard/MonthlySummary';
import Segmented from '../components/ui/Segmented';

import { useAuth } from '../auth/AuthProvider';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';
import { useAttendanceReport, resolveRange } from '../hooks/useAttendanceReport';
import { subscribeAllStaffIncludingInactive } from '../services/staff.service';
import { BRANCHES, BRANCH_IDS } from '../config/branches';
import { useBranches } from '../config/BranchesProvider';
import { formatDuration, toDecimalHours, businessDayKey } from '../lib/time';

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
  const { t } = useTranslation();
  const { principal, signOut } = useAuth();
  const { setBranch } = useBranchTheme();

  const [filters, setFilters] = useState({
    range: '30d',
    branchId: 'all',
    role: null,
    overtimeOnly: false,
  });
  const [roster, setRoster] = useState([]);
  const [view, setView] = useState('overview');
  const [addingTo, setAddingTo] = useState(null);
  const [detailFor, setDetailFor] = useState(null);
  const [settingsFor, setSettingsFor] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const { get: getBranch, branches: branchList } = useBranches();
  const branch = filters.branchId === 'all' ? null : getBranch(filters.branchId);
  const timezone = branch?.timezone ?? 'Asia/Yangon';

  /* Short names, from live config rather than the compiled-in defaults, so a
     branch renamed in the settings dialog is renamed in the header too. */
  const allBranchNames = useMemo(
    () => branchList.map((entry) => entry.shortName).join(' · '),
    [branchList],
  );

  /* The dashboard wears the branch it is filtered to. */
  useEffect(() => {
    setBranch(branch?.theme ?? HOUSE_THEME);
  }, [branch, setBranch]);

  useEffect(
    () => subscribeAllStaffIncludingInactive(setRoster, () => setRoster([])),
    [refreshNonce],
  );

  /* Reporting counts active people only; the team view also shows removed
     ones, which is the only way to restore someone taken off by mistake. */
  const activeRoster = useMemo(() => roster.filter((person) => person.active !== false), [roster]);

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
    roster: activeRoster,
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

  /* Today's punches, for the status pill beside each person in the tree. */
  const todayKey = businessDayKey(new Date(), timezone);
  const todayLogs = useMemo(
    () => report.rows.filter((row) => row.dayKey === todayKey),
    [report.rows, todayKey],
  );

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
                {t('admin.title')}
              </h1>
              <p className="truncate text-xs text-ink-subtle">
                {branch ? branch.name : allBranchNames}
                {view === 'overview' ? ` · ${range.label}` : ''}
              </p>
            </div>
          </div>

          {/* Router Link, not an anchor. A raw href is a full page load, which
              404s anywhere the host is not rewriting unknown paths to
              index.html — and never resolves at all under a memory router. */}
          <Link
            to="/attendance/kiosk"
            className="hidden items-center gap-1.5 rounded-2xl border border-line px-3 py-2 text-xs font-semibold text-ink-muted transition-colors hover:text-ink sm:inline-flex"
          >
            {t('admin.openKiosk')}
            <LuExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>

          <Segmented
            size="sm"
            label={t('admin.view')}
            options={[
              { value: 'overview', label: t('admin.reports') },
              { value: 'team', label: t('admin.team') },
              { value: 'monthly', label: t('admin.monthly') },
            ]}
            value={view}
            onChange={setView}
          />

          <LanguageToggle />
          <ThemeToggle />

          <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface-card py-1.5 pl-1.5 pr-1.5 shadow-soft">
            <Avatar name={principal?.displayName} seed={principal?.uid} size={32} />
            <span className="hidden min-w-0 max-w-[140px] flex-col leading-tight sm:flex">
              <span className="truncate text-xs font-bold text-ink">{principal?.displayName}</span>
              <span className="truncate text-[11px] text-ink-subtle">
                {t('roles.admin')}
              </span>
            </span>
            <button
              type="button"
              onClick={signOut}
              aria-label={t('admin.signOut')}
              className="grid h-8 w-8 place-items-center rounded-xl text-ink-subtle transition-colors hover:bg-danger-soft hover:text-danger-ink"
            >
              <LuLogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        {/* The date range and the overtime switch scope the reports only. On
            the team tree and the monthly cards they would be inert controls
            sitting above a month navigator that actually works — two time
            controls disagreeing is worse than one. */}
        <FilterBar filters={filters} onChange={setFilters} compact={view !== 'overview'} />

        {report.error && view === 'overview' ? (
          <p className="mb-6 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger-ink" role="alert">
            {report.error}
          </p>
        ) : null}

        {view === 'team' ? (
          <section className="pt-6">
            <header className="mb-4">
              <h2 className="inline-flex items-center gap-2 text-base font-bold tracking-tight text-ink">
                <LuNetwork className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
                {t('admin.team')}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t('admin.teamIntro')}</p>
            </header>

            <OrgTree
              staff={roster}
              logs={todayLogs}
              branchIds={branchIds}
              timezone={timezone}
              onSelect={setDetailFor}
              onAdd={setAddingTo}
              onSettings={setSettingsFor}
            />
          </section>
        ) : view === 'monthly' ? (
          <MonthlySummary branchIds={branchIds} roster={activeRoster} timeZone={timezone} />
        ) : (
        <>
        {/* ---- headline figures ---- */}
        <section
          className={`mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 ${loading ? 'opacity-60 transition-opacity' : ''}`}
        >
          <StatTile
            hero
            label={t('admin.attendanceRate')}
            value={rate == null ? '—' : `${Math.round(rate * 100)}%`}
            caption={
              rate == null
                ? t('admin.noRosterData')
                : t('admin.shiftsWithPunch', { present: totals.present, expected: totals.expected })
            }
            tone="brand"
            icon={LuUsers}
          />
          <StatTile
            label={t('admin.lateArrivals')}
            value={totals.late}
            caption={
              totals.present
                ? t('admin.shareOfShifts', { percent: Math.round((totals.late / totals.present) * 100) })
                : t('admin.noShiftsInRange')
            }
            tone={totals.late ? 'warn' : 'default'}
            icon={LuCircleAlert}
          />
          <StatTile
            label={t('admin.overtimeHours')}
            value={toDecimalHours(totals.overtimeMinutes)}
            caption={`${t('admin.claims', { count: totals.overtimeClaims })} · ${formatDuration(totals.overtimeMinutes)}`}
            tone={totals.overtimeMinutes ? 'ot' : 'default'}
            icon={LuTimer}
          />
        </section>

        {/* ---- charts ---- */}
        <section className="mb-6 grid gap-4 lg:grid-cols-3">
          <AttendanceTrendChart daily={daily} className="lg:col-span-2" />
          <OvertimeBreakdownChart
            items={breakdown}
            title={t('admin.overtime')}
            subtitle={
              filters.branchId === 'all'
                ? t('admin.byBranch')
                : `${t('admin.byPerson')} · ${branch.shortName}`
            }
            emptyHint={
              filters.overtimeOnly
                ? t('admin.noOvertimeMatched')
                : t('admin.noOvertimeClaimed')
            }
          />
        </section>

        {/* ---- the log ---- */}
        <AttendanceTable rows={report.rows} loading={loading} timezone={timezone} />
        </>
        )}
      </main>

      <AddStaffDialog
        open={Boolean(addingTo)}
        branchId={addingTo}
        actor={principal}
        onClose={() => setAddingTo(null)}
        onAdded={() => setRefreshNonce((n) => n + 1)}
      />

      <BranchSettingsDialog
        open={Boolean(settingsFor)}
        branch={settingsFor}
        actor={principal}
        onClose={() => setSettingsFor(null)}
      />

      <StaffDetailDialog
        open={Boolean(detailFor)}
        person={detailFor}
        actor={principal}
        onClose={() => setDetailFor(null)}
        onChanged={() => {
          setRefreshNonce((n) => n + 1);
          report.refresh();
        }}
      />
    </div>
  );
}
