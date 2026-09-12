import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuChevronLeft, LuChevronRight, LuInfo } from 'react-icons/lu';

import Avatar from '../ui/Avatar';
import Spinner from '../ui/Spinner';
import { useBranches } from '../../config/BranchesProvider';
import { roleLabel, ROLE_META } from '../../config/roles';
import { fetchMonthlySummary, workingDaysInMonth } from '../../services/monthly.service';
import { formatMonth } from '../../i18n/months';
import { businessDayKey } from '../../lib/time';

/**
 * One month, every employee, three numbers each.
 *
 * Deliberately not a chart and not a table. The question this answers is
 * "how did each person do this month" — it is read one person at a time, and a
 * card per person answers it in one glance where a 12-row × 6-column table
 * makes you track across a line.
 *
 * Three figures only: present, absent, overtime. Late days are shown as a
 * footnote on the card rather than a fourth number, because four equal-weight
 * figures stop being scannable and lateness is the least consequential of them.
 */

const monthKey = (date, timeZone) => businessDayKey(date, timeZone).slice(0, 7);

const shiftMonth = (month, by) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * @param load  optional replacement for the Firestore read, given the same
 *              arguments and returning the same row shape. The preview passes
 *              its own so it renders this component against its own fixture
 *              instead of the stub's — same reduction, same cards, no network.
 */
export default function MonthlySummary({
  branchIds,
  roster,
  timeZone = 'Asia/Yangon',
  load = fetchMonthlySummary,
}) {
  const { t, i18n } = useTranslation();
  const { get } = useBranches();

  const thisMonth = monthKey(new Date(), timeZone);
  const [month, setMonth] = useState(thisMonth);
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    Promise.resolve(load({ branchIds, month, roster, timeZone }))
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branchIds, month, roster, timeZone, load]);

  const expectedDays = useMemo(
    () => workingDaysInMonth(month, { timeZone }).length,
    [month, timeZone],
  );

  /* Grouped by branch, then by seniority — the same order as the tree, so the
     two views do not present the same people in two different sequences. */
  const grouped = useMemo(() => {
    const map = new Map(branchIds.map((id) => [id, []]));
    for (const row of rows ?? []) {
      if (map.has(row.branchId)) map.get(row.branchId).push(row);
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        const rank = (ROLE_META[a.role]?.order ?? 99) - (ROLE_META[b.role]?.order ?? 99);
        return rank !== 0 ? rank : String(a.staffName).localeCompare(String(b.staffName));
      });
    }
    return map;
  }, [rows, branchIds]);

  return (
    <section className="pt-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-bold tracking-tight text-ink">{t('monthly.title')}</h2>
          <p className="mt-1 text-xs text-ink-muted">
            {t('monthly.workingDays', { count: expectedDays })}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface-card p-1 shadow-soft">
          <button
            type="button"
            onClick={() => setMonth((current) => shiftMonth(current, -1))}
            aria-label={t('monthly.previousMonth')}
            className="grid h-8 w-8 place-items-center rounded-xl text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <LuChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span className="min-w-[9rem] text-center text-sm font-bold text-ink">
            {formatMonth(month, i18n.resolvedLanguage)}
          </span>
          <button
            type="button"
            onClick={() => setMonth((current) => shiftMonth(current, 1))}
            disabled={month >= thisMonth}
            aria-label={t('monthly.nextMonth')}
            className="grid h-8 w-8 place-items-center rounded-xl text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-30"
          >
            <LuChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {rows === null ? (
        <div className="py-20">
          <Spinner size={26} label={t('common.loading')} />
        </div>
      ) : rows.length === 0 ? (
        <p className="card card-pad text-center text-sm text-ink-muted">{t('monthly.noData')}</p>
      ) : (
        <div className="space-y-6">
          {[...grouped.entries()].map(([branchId, people]) =>
            people.length ? (
              <div key={branchId} data-branch={get(branchId)?.theme}>
                <h3 className="mb-3 flex items-center gap-2 px-1">
                  <span className="h-4 w-1.5 rounded-full bg-brand-600" aria-hidden="true" />
                  <span className="text-sm font-bold tracking-tight text-ink">
                    {get(branchId)?.name ?? branchId}
                  </span>
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {people.map((person) => (
                    <EmployeeCard key={person.staffId} person={person} />
                  ))}
                </div>
              </div>
            ) : null,
          )}
        </div>
      )}

      {/* The caveat belongs on screen, not only in the docs: absent days are
          derived from Mon–Sat, so a legitimate day off reads as an absence. */}
      <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-ink-subtle">
        <LuInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t('monthly.caveat')}</span>
      </p>
    </section>
  );
}

function EmployeeCard({ person }) {
  const { t } = useTranslation();
  const perfect = person.absentDays === 0 && person.presentDays > 0;

  return (
    <article className="card card-pad">
      <header className="mb-4 flex items-center gap-3">
        <Avatar name={person.staffName} seed={person.staffId} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-tight text-ink">{person.staffName}</p>
          <p className="truncate text-xs text-ink-subtle">{roleLabel(person.role, t)}</p>
        </div>
        {perfect ? (
          <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[10px] font-bold text-ok-ink">
            {t('monthly.perfect')}
          </span>
        ) : null}
      </header>

      <dl className="grid grid-cols-3 gap-2">
        <Figure
          label={t('monthly.presentDays')}
          value={person.presentDays}
          tone="ok"
        />
        <Figure
          label={t('monthly.absentDays')}
          value={person.absentDays}
          tone={person.absentDays > 0 ? 'danger' : 'muted'}
        />
        <Figure
          label={t('monthly.overtimeHours')}
          value={person.overtimeHours}
          tone={person.overtimeHours > 0 ? 'ot' : 'muted'}
        />
      </dl>

      {person.lateDays > 0 ? (
        <p className="mt-3 text-[11px] font-medium text-warn-ink">
          {t('monthly.lateDays')}: {person.lateDays} · {person.lateMinutes} {t('common.minutes')}
        </p>
      ) : null}
    </article>
  );
}

const TONES = {
  ok: 'text-ok-ink',
  danger: 'text-danger-ink',
  ot: 'text-ot-ink',
  muted: 'text-ink-subtle',
};

function Figure({ label, value, tone }) {
  return (
    <div className="rounded-2xl bg-surface-sunken/60 px-3 py-3 text-center">
      <dd className={`text-2xl font-bold leading-none tracking-tight ${TONES[tone]}`}>{value}</dd>
      <dt className="mt-1.5 text-[10px] font-semibold leading-tight text-ink-subtle">{label}</dt>
    </div>
  );
}
