import { useTranslation } from 'react-i18next';
import { LuFingerprint, LuArrowRight } from 'react-icons/lu';

import Avatar from '../ui/Avatar';
import StatusPill from '../ui/StatusPill';
import { ATTENDANCE_STATUS, formatClock, formatDuration } from '../../lib/time';
import { roleLabel } from '../../config/roles';

/**
 * One person on the kiosk roster.
 *
 * The card's whole job is to answer "am I in or out?" from arm's length, so
 * state is carried by the pill and the elapsed figure, and the action verb
 * changes with it. Three states: not in yet, on shift, done for the day.
 */
export default function StaffCard({ staff, log, timezone, elapsedMinutes, onSelect, disabled }) {
  const { t } = useTranslation();
  const checkedIn = Boolean(log?.checkIn?.at);
  const checkedOut = Boolean(log?.checkOut?.at);
  const done = checkedIn && checkedOut;

  const action = done ? null : checkedIn ? t('kiosk.clockOut') : t('kiosk.clockIn');

  return (
    <button
      type="button"
      onClick={() => onSelect(staff)}
      disabled={disabled || done}
      className={`group relative flex w-full items-center gap-4 overflow-hidden rounded-3xl border p-4 text-left transition-all duration-300 ease-expo tap-none ${
        done
          ? 'border-line bg-surface-sunken/60 opacity-70'
          : 'border-line bg-surface-card shadow-soft hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-lift active:translate-y-0'
      } disabled:cursor-default disabled:hover:translate-y-0 disabled:hover:shadow-soft`}
    >
      {/* Brand wash that blooms on hover — motion that says "pressable". */}
      {!done ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-brand-500/0 via-brand-500/0 to-brand-500/0 opacity-0 transition-opacity duration-400 group-hover:from-brand-500/[0.07] group-hover:to-accent-500/[0.07] group-hover:opacity-100"
        />
      ) : null}

      <Avatar name={staff.name} seed={staff.id} size={52} />

      <span className="relative min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-bold tracking-tight text-ink">{staff.name}</span>
          {staff.hasBiometrics ? (
            <LuFingerprint className="h-3.5 w-3.5 shrink-0 text-brand-ink/60" aria-label={t('kiosk.fingerprintEnrolled')} />
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs font-medium text-ink-subtle">
          {roleLabel(staff.role, t)}
        </span>

        <span className="mt-2 flex flex-wrap items-center gap-2">
          {checkedIn ? (
            <StatusPill
              size="sm"
              status={done ? log.status : ATTENDANCE_STATUS.INCOMPLETE}
              label={done ? undefined : `In ${formatClock(log.checkIn.at, timezone)}`}
            />
          ) : (
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              {t('kiosk.notClockedIn')}
            </span>
          )}

          {checkedIn && !done && elapsedMinutes != null ? (
            <span className="text-[11px] font-semibold text-ink-muted tabular">
              {t('kiosk.soFar', { duration: formatDuration(elapsedMinutes) })}
            </span>
          ) : null}

          {done && (log.minutes?.overtime ?? 0) > 0 ? (
            <StatusPill size="sm" status="overtime" label={`+${formatDuration(log.minutes.overtime)}`} />
          ) : null}
        </span>
      </span>

      {action ? (
        <span className="relative flex shrink-0 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-2 text-xs font-bold text-brand-on shadow-soft transition-transform duration-300 group-hover:scale-105">
          {action}
          <LuArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      ) : (
        <span className="relative shrink-0 text-xs font-semibold text-ink-subtle tabular">
          {formatDuration(log.minutes?.worked ?? 0)}
        </span>
      )}
    </button>
  );
}
