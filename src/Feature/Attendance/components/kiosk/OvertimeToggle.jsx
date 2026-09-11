import { LuTimer, LuInfo } from 'react-icons/lu';
import { formatDuration } from '../../lib/time';

/**
 * The Overtime switch, shown only at clock-out.
 *
 * Requirements it is built around:
 *
 *   - It must be impossible to flip by accident. It is a large, deliberate
 *     target with its own colour (the fixed `ot` orange — never the branch
 *     accent, so it means the same thing at every shop) and it sits apart from
 *     the confirm button rather than beside it.
 *   - It must show the consequence before the punch, not after. The card states
 *     the exact minutes that will be claimed, recalculated live.
 *   - It must explain a refusal. If the shift is not actually over, the switch
 *     is disabled with the reason spelled out, instead of accepting a claim
 *     that the server will silently zero out.
 */

const REASON_COPY = {
  'not-past-shift-end': 'Your shift has not finished yet, so there is no overtime to claim.',
  'within-grace-window': (grace) =>
    `The first ${grace} minutes after the shift end are not counted as overtime.`,
  'session-open': 'Overtime is worked out when you clock out.',
};

export default function OvertimeToggle({
  checked,
  onChange,
  eligibleMinutes = 0,
  reason = null,
  graceMinutes = 15,
  capMinutes = null,
  disabled = false,
}) {
  const eligible = eligibleMinutes > 0;
  const isDisabled = disabled || !eligible;
  const capped = capMinutes != null && eligibleMinutes > capMinutes;
  const claimable = capped ? capMinutes : eligibleMinutes;

  const explain =
    typeof REASON_COPY[reason] === 'function'
      ? REASON_COPY[reason](graceMinutes)
      : REASON_COPY[reason];

  return (
    <div
      className={`rounded-3xl border p-1 transition-all duration-400 ease-expo ${
        checked
          ? 'border-ot/40 bg-ot-soft shadow-glow-ot'
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
            checked ? 'bg-ot text-white shadow-lift' : 'bg-surface-card text-ink-subtle'
          }`}
        >
          <LuTimer className="h-5 w-5" aria-hidden="true" />
        </span>

        <span className="min-w-0 flex-1">
          <span className={`block text-[15px] font-bold tracking-tight ${checked ? 'text-ot-ink' : 'text-ink'}`}>
            Claim overtime
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
            {eligible ? (
              <>
                You worked{' '}
                <strong className="font-bold text-ink tabular">{formatDuration(eligibleMinutes)}</strong>{' '}
                past the end of your shift.
              </>
            ) : (
              explain ?? 'No overtime available for this shift.'
            )}
          </span>
        </span>

        {/* The switch itself. */}
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
            <span className="eyebrow">Will be logged as overtime</span>
            <span className="text-xl font-bold tracking-tight text-ot-ink tabular">
              {formatDuration(claimable)}
            </span>
          </div>
          {capped ? (
            <p className="mt-2 flex items-start gap-2 text-xs leading-relaxed text-warn-ink">
              <LuInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              That is over the {formatDuration(capMinutes)} daily limit, so{' '}
              {formatDuration(capMinutes)} will be recorded and a supervisor will be asked to
              review the rest.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
