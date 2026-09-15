import { useTranslation } from 'react-i18next';
import { LuTimer, LuInfo } from 'react-icons/lu';
import { formatDuration } from '../../lib/time';

/**
 * The Overtime switch.
 *
 * It sits directly above the PIN keypad, and that placement is the requirement
 * rather than a layout preference: the claim has to be made *before* the PIN,
 * because entering the PIN is the commit. Anywhere else — an earlier screen, or
 * below the keypad — and someone types four digits before noticing there was a
 * decision to make.
 *
 * So it is built to be seen and hard to miss: full width, its own fixed orange
 * (never the branch accent — overtime means the same thing at every shop), and
 * an instruction naming the order it has to happen in.
 *
 * It also shows the consequence before the punch, in the unit that gets paid:
 * whole hours, rounded up. "You worked 1h 1m past the end" and "paid as 2
 * hours" are different numbers and both belong on screen.
 */

export default function OvertimeToggle({
  checked,
  onChange,
  eligibleMinutes = 0,
  billedHours = 0,
  reason = null,
  graceMinutes = 15,
  capMinutes = null,
  disabled = false,
  /* When identity was already proven, the commit is a confirm button rather
     than the keypad — so the instruction has to name the step that actually
     follows, or it points at a PIN pad that is not on screen. */
  commitsWithoutPin = false,
}) {
  const { t } = useTranslation();

  const eligible = eligibleMinutes > 0;
  const isDisabled = disabled || !eligible;
  const capped = capMinutes != null && eligibleMinutes > capMinutes;

  const explain = () => {
    if (reason === 'not-past-shift-end') return t('overtime.notPastShiftEnd');
    if (reason === 'within-grace-window') return t('overtime.withinGrace', { count: graceMinutes });
    if (reason === 'session-open') return t('overtime.sessionOpen');
    return t('overtime.none');
  };

  return (
    <div
      className={`rounded-3xl border-2 p-1 transition-all duration-400 ease-expo ${
        checked
          ? 'border-ot bg-ot-soft shadow-glow-ot'
          : eligible
            ? 'border-ot/35 bg-ot-soft/40'
            : 'border-line bg-surface-sunken'
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={isDisabled}
        onClick={() => onChange(!checked)}
        className="flex w-full items-center gap-4 rounded-[1.25rem] p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 tap-none"
      >
        <span
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-all duration-400 ease-expo ${
            checked ? 'bg-ot text-white shadow-lift' : 'bg-surface-card text-ot-ink'
          }`}
        >
          <LuTimer className="h-5 w-5" aria-hidden="true" />
        </span>

        <span className="min-w-0 flex-1">
          <span
            className={`block text-[15px] font-bold tracking-tight ${checked ? 'text-ot-ink' : 'text-ink'}`}
          >
            {t('overtime.claim')}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
            {eligible ? (
              <>
                {t('overtime.workedPast', { duration: formatDuration(eligibleMinutes) })}
                {!checked ? (
                  <strong className="ml-1 font-bold text-ot-ink">
                    {t(commitsWithoutPin ? 'overtime.tapBeforeConfirm' : 'overtime.tapBeforePin')}
                  </strong>
                ) : null}
              </>
            ) : (
              explain()
            )}
          </span>
        </span>

        <span
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300 ${
            checked ? 'bg-ot' : 'bg-line-strong'
          }`}
        >
          <span
            className="absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-soft transition-transform duration-300 ease-spring"
            style={{ transform: checked ? 'translateX(24px)' : 'translateX(0)' }}
          />
        </span>
      </button>

      {checked && eligible ? (
        <div className="animate-fade-up px-4 pb-4">
          <div className="flex items-baseline justify-between rounded-2xl bg-surface-card/70 px-4 py-3">
            <span className="eyebrow">{t('overtime.willBeLogged')}</span>
            <span className="text-xl font-bold tracking-tight text-ot-ink tabular">
              {t('overtime.paidInHours', { hours: capped ? Math.ceil(capMinutes / 60) : billedHours })}
            </span>
          </div>
          {capped ? (
            <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-warn-ink">
              <LuInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('overtime.cappedNotice', { cap: formatDuration(capMinutes) })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
