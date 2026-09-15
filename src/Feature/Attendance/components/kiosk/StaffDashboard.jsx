import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuLogIn, LuLogOut, LuX, LuTimer } from 'react-icons/lu';

import Avatar from '../ui/Avatar';
import Spinner from '../ui/Spinner';
import { roleLabel } from '../../config/roles';
import { queryAttendance, PUNCH } from '../../services/attendance.service';
import {
  businessDayKey,
  formatClock,
  formatDayLabel,
  formatDuration,
  minutesToBilledHours,
} from '../../lib/time';

/* Whole hours, the unit that is paid — the stored figure when the punch
   recorded one, otherwise derived the same way the punch would have. */
const otHours = (row) =>
  row.minutes?.overtimeHours ?? minutesToBilledHours(row.minutes?.overtime ?? 0);

/**
 * One person's own screen, on a tablet the whole shop shares.
 *
 * That last part governs every decision here. It opens only after a PIN has
 * been checked, it shows exactly one person, and it closes itself: a dashboard
 * left open on the counter is somebody's pay history facing the street. The
 * idle timer is the feature, not a nicety — the earlier design avoided a
 * personal view precisely because a shared surface forgets to log out.
 *
 * Clock In and Clock Out live at the top because they are why anyone opened
 * it. The month below them is the answer to "was I paid for that late
 * Tuesday", which is the other reason.
 */

/** Long enough to read a month, short enough that walking away is safe. */
const IDLE_MS = 60_000;

export default function StaffDashboard({ staff, branch, log, onPunch, onClose }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState(null);

  const monthKey = useMemo(
    () => businessDayKey(new Date(), branch.timezone).slice(0, 7),
    [branch.timezone],
  );

  /* Any touch pushes the timer back; silence closes the screen. */
  useEffect(() => {
    let timer = window.setTimeout(onClose, IDLE_MS);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(onClose, IDLE_MS);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    queryAttendance({
      branchIds: [branch.id],
      fromKey: `${monthKey}-01`,
      toKey: `${monthKey}-31`,
    })
      /* Filtered here rather than in the query: adding staffId to the where
         clause would need a composite index that does not exist, and a single
         branch-month is a few dozen rows. */
      .then((all) => {
        if (!cancelled) setRows(all.filter((row) => row.staffId === staff.id));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [branch.id, monthKey, staff.id, log]);

  /* Same derivation PunchDialog uses, so the button here and the dialog it
     opens can never disagree about which punch is next. */
  const isIn = Boolean(log?.checkIn?.at) && !log?.checkOut?.at;

  const totals = useMemo(() => {
    const list = rows ?? [];
    return {
      days: list.filter((row) => row.checkIn?.at).length,
      overtimeHours: list.reduce(
        (sum, row) => sum + (row.minutes?.overtimeHours ?? minutesToBilledHours(row.minutes?.overtime ?? 0)),
        0,
      ),
      lateMinutes: list.reduce((sum, row) => sum + (row.minutes?.late ?? 0), 0),
    };
  }, [rows]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-surface">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <header className="mb-6 flex items-center gap-3">
          <Avatar name={staff.name} seed={staff.id} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold tracking-tight text-ink">{staff.name}</p>
            <p className="truncate text-xs text-ink-subtle">
              {roleLabel(staff.role, t)} · {branch.shortName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-line text-ink-muted transition-colors hover:text-ink"
          >
            <LuX className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        {/* ---- today ---- */}
        <section className="card card-pad mb-4">
          <p className="eyebrow mb-3">{t('staffDash.today')}</p>
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <Cell
              label={t('punch.checkedIn')}
              value={log?.checkIn?.at ? formatClock(log.checkIn.at, branch.timezone) : '—'}
            />
            <Cell
              label={t('kiosk.clockOut')}
              value={log?.checkOut?.at ? formatClock(log.checkOut.at, branch.timezone) : '—'}
            />
            <Cell
              label={t('punch.worked')}
              value={log?.minutes?.worked ? formatDuration(log.minutes.worked) : '—'}
            />
          </div>

          <button
            type="button"
            onClick={() => onPunch(isIn ? PUNCH.CHECK_OUT : PUNCH.CHECK_IN)}
            className={`flex w-full items-center justify-center gap-2.5 rounded-2xl px-4 py-4 text-base font-bold shadow-soft transition-all duration-300 ease-expo hover:-translate-y-0.5 hover:shadow-lift tap-none ${
              isIn ? 'bg-ot text-white' : 'bg-brand-600 text-brand-on'
            }`}
          >
            {isIn ? (
              <LuLogOut className="h-5 w-5" aria-hidden="true" />
            ) : (
              <LuLogIn className="h-5 w-5" aria-hidden="true" />
            )}
            {isIn ? t('kiosk.clockOut') : t('kiosk.clockIn')}
          </button>
        </section>

        {/* ---- this month ---- */}
        <section className="card card-pad">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="eyebrow">{t('staffDash.thisMonth')}</p>
            {rows ? (
              <p className="flex items-center gap-2 text-xs text-ink-subtle">
                <span>{t('staffDash.daysWorked', { count: totals.days })}</span>
                {totals.overtimeHours > 0 ? (
                  <span className="font-bold text-ot-ink">
                    <LuTimer className="mb-0.5 mr-1 inline h-3 w-3" aria-hidden="true" />
                    {totals.overtimeHours} {t('common.hours')}
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>

          {rows === null ? (
            <div className="py-10">
              <Spinner size={24} label={t('common.loading')} />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">{t('staffDash.noRecords')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[21rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <Th align="left">{t('staffDash.day')}</Th>
                    <Th>{t('punch.checkedIn')}</Th>
                    <Th>{t('kiosk.clockOut')}</Th>
                    <Th>{t('punch.worked')}</Th>
                    <Th>{t('monthly.overtime')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-line/60 last:border-0">
                      <td className="px-2 py-2.5 text-left text-xs font-semibold text-ink">
                        {formatDayLabel(row.dayKey)}
                      </td>
                      <Td>{row.checkIn?.at ? formatClock(row.checkIn.at, branch.timezone) : '—'}</Td>
                      <Td>{row.checkOut?.at ? formatClock(row.checkOut.at, branch.timezone) : '—'}</Td>
                      <Td>{row.minutes?.worked ? formatDuration(row.minutes.worked) : '—'}</Td>
                      <Td tone={otHours(row) > 0 ? 'ot' : 'muted'}>{otHours(row) || '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-ink-subtle">{t('staffDash.autoClose')}</p>
      </div>
    </div>
  );
}

function Cell({ label, value }) {
  return (
    <div className="rounded-2xl bg-surface-sunken/60 px-2 py-3">
      <p className="text-base font-bold tracking-tight text-ink tabular">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold text-ink-subtle">{label}</p>
    </div>
  );
}

function Th({ children, align = 'right' }) {
  return (
    <th
      scope="col"
      className={`px-2 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-subtle ${
        align === 'left' ? 'text-left' : 'text-right'
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, tone = 'ink' }) {
  return (
    <td
      className={`tabular px-2 py-2.5 text-right text-sm ${
        tone === 'ot' ? 'font-bold text-ot-ink' : tone === 'muted' ? 'text-ink-subtle' : 'text-ink'
      }`}
    >
      {children}
    </td>
  );
}
