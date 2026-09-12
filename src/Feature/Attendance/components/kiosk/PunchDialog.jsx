import { useCallback, useEffect, useMemo, useState } from 'react';
import { LuFingerprint, LuCheck, LuLock, LuTriangleAlert, LuArrowRight } from 'react-icons/lu';

import Modal from '../ui/Modal';
import Spinner from '../ui/Spinner';
import Avatar from '../ui/Avatar';
import PinPad from './PinPad';
import OvertimeToggle from './OvertimeToggle';
import { useWebAuthn } from '../../hooks/useWebAuthn';
import { useNow } from '../../hooks/useNow';
import { submitPunch, PUNCH, AUTH_METHOD } from '../../services/attendance.service';
import { INTENT, ACCESS } from '../../lib/accessPolicy';
import { BYPASS_TAG } from '../../config/devMode';
import { computeWorkSession, formatClock, formatDuration } from '../../lib/time';
import { roleLabel } from '../../config/roles';

/**
 * Clock in / clock out.
 *
 * The sequence is intentionally: identity LAST. The person first sees who they
 * are, what time it is, how long they have worked and whether they are claiming
 * overtime — and only then proves it is them. Asking for a fingerprint before
 * showing the consequence is how people end up claiming the wrong thing.
 *
 * Overtime state is owned here rather than inside the toggle so it can be sent
 * with the punch in one payload, and so the live preview and the submitted
 * value can never disagree.
 */

const STEP = { REVIEW: 'review', PIN: 'pin', WORKING: 'working', DONE: 'done' };

export default function PunchDialog({ open, onClose, staff, log, branch, geo, onSubmitted }) {
  const isCheckOut = Boolean(log?.checkIn?.at) && !log?.checkOut?.at;
  const kind = isCheckOut ? PUNCH.CHECK_OUT : PUNCH.CHECK_IN;

  const now = useNow(1000);
  const webauthn = useWebAuthn();

  const [step, setStep] = useState(STEP.REVIEW);
  const [pin, setPin] = useState('');
  const [overtime, setOvertime] = useState(false);
  const [error, setError] = useState(null);
  /**
   * What this punch turned out to be, frozen at the moment it was sent.
   *
   * `isCheckOut` below is derived live from the log — which is correct while
   * the dialog is being filled in, and wrong the instant the punch lands:
   * the log gains a checkOut, the derivation flips, and the success panel
   * relabels a clock-out as "Welcome in". The confirmation has to report what
   * happened, not what the current state now implies.
   */
  const [submitted, setSubmitted] = useState(null);

  /* Reset every time the dialog opens for a different person. */
  useEffect(() => {
    if (!open) return;
    setStep(STEP.REVIEW);
    setPin('');
    setOvertime(false);
    setError(null);
    setSubmitted(null);
  }, [open, staff?.id]);

  /**
   * Live preview of what this punch will record. Recomputed on every tick so
   * the overtime figure the person agrees to is the one that gets written.
   */
  const preview = useMemo(() => {
    if (!isCheckOut || !log?.checkIn?.at || !branch) return null;
    return computeWorkSession({
      checkInAt: log.checkIn.at,
      checkOutAt: now,
      shift: log.shiftSnapshot ?? branch.shift,
      timeZone: branch.timezone,
      overtimeRequested: overtime,
      now,
    });
  }, [isCheckOut, log, branch, now, overtime]);

  /* Eligibility must ignore the toggle, or turning it off would report
     "no overtime available" and the switch could never be turned back on. */
  const eligibility = useMemo(() => {
    if (!isCheckOut || !log?.checkIn?.at || !branch) return null;
    return computeWorkSession({
      checkInAt: log.checkIn.at,
      checkOutAt: now,
      shift: log.shiftSnapshot ?? branch.shift,
      timeZone: branch.timezone,
      overtimeRequested: true,
      now,
    });
  }, [isCheckOut, log, branch, now]);

  /**
   * Which checks apply to the punch as it currently stands.
   *
   * Claiming overtime exempts the clock-out from the shop-network check — the
   * router is often off by the time a late shift ends, so the person owed
   * overtime is exactly the one an IP rule would strand. The geofence still
   * applies in full, so "were they at the shop" is still answered, by the
   * stronger of the two signals.
   */
  const intent = !isCheckOut
    ? INTENT.CHECK_IN
    : overtime
      ? INTENT.OVERTIME_CHECK_OUT
      : INTENT.CHECK_OUT;

  const policy = geo.evaluateFor ? geo.evaluateFor(intent) : geo.policy;
  const allowed = policy.access === ACCESS.ALLOWED;

  const send = useCallback(
    async (auth) => {
      setStep(STEP.WORKING);
      setError(null);
      try {
        const response = await submitPunch({
          kind,
          branchId: branch.id,
          staffId: staff.id,
          staff: { name: staff.name, role: staff.role },
          branch: { shift: branch.shift, timezone: branch.timezone },
          overtimeRequested: kind === PUNCH.CHECK_OUT ? overtime : false,
          auth,
          position: geo.position,
          geo: { distance: geo.fence?.distance ?? null, verdict: geo.fence?.verdict ?? null },
          ip: geo.ip,
          intent,
          /* Tagged on the record so a punch made with the fence switched off
             stays identifiable long after the flag is switched back on. */
          locationBypass: geo.bypassed ? BYPASS_TAG : null,
        });
        setSubmitted({
          kind,
          verb: kind === PUNCH.CHECK_OUT ? 'Clock out' : 'Clock in',
          /* Snapshot the figures as agreed, so the confirmation and the
             record can never disagree. */
          workedMinutes: response?.computed?.workedMinutes ?? preview?.workedMinutes ?? null,
          overtimeMinutes: response?.computed?.overtimeMinutes ?? preview?.overtimeMinutes ?? 0,
          at: new Date(),
        });
        setStep(STEP.DONE);
        onSubmitted?.(response);
      } catch (submitError) {
        setError(toMessage(submitError));
        setStep(STEP.PIN);
        setPin('');
      }
    },
    [kind, branch, staff, overtime, geo, preview, intent, onSubmitted],
  );

  const onBiometric = useCallback(async () => {
    setError(null);
    try {
      const assertion = await webauthn.verify(staff);
      await send({ method: AUTH_METHOD.BIOMETRIC, assertion });
    } catch (biometricError) {
      setError(biometricError.message);
      setStep(STEP.PIN);
    }
  }, [webauthn, staff, send]);

  /* Auto-submit on the last digit — nobody should have to press "OK" after
     typing a PIN into a full-width keypad. */
  const pinLength = branch?.staffPinLength ?? 4;
  useEffect(() => {
    if (step === STEP.PIN && pin.length === pinLength) {
      send({ method: AUTH_METHOD.PIN, pin });
    }
  }, [pin, pinLength, step, send]);

  /* Close on its own after a success, so the tablet returns to the roster. */
  useEffect(() => {
    if (step !== STEP.DONE) return undefined;
    const timer = setTimeout(() => onClose?.(), 3200);
    return () => clearTimeout(timer);
  }, [step, onClose]);

  if (!staff || !branch) return null;

  const blocked = !allowed;
  const verb = isCheckOut ? 'Clock out' : 'Clock in';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === STEP.DONE ? null : verb}
      subtitle={step === STEP.DONE ? null : formatClock(now, branch.timezone, { seconds: true })}
      size="md"
    >
      {step === STEP.DONE && submitted ? (
        <SuccessPanel staff={staff} branch={branch} submitted={submitted} />
      ) : (
        <div className="space-y-5">
          {/* ---- who ---- */}
          <div className="flex items-center gap-4 rounded-3xl border border-line bg-surface-sunken/60 p-4">
            <Avatar name={staff.name} seed={staff.id} size={52} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold tracking-tight text-ink">{staff.name}</p>
              <p className="truncate text-xs font-medium text-ink-subtle">
                {roleLabel(staff.role)} · {branch.shortName}
              </p>
            </div>
            {isCheckOut && preview ? (
              <div className="shrink-0 text-right">
                <p className="eyebrow">Worked</p>
                <p className="text-lg font-bold tracking-tight text-ink tabular">
                  {formatDuration(preview.workedMinutes)}
                </p>
              </div>
            ) : null}
          </div>

          {/* ---- shift detail on checkout ---- */}
          {isCheckOut && preview ? (
            <dl className="grid grid-cols-3 gap-2 text-center">
              <Cell label="In" value={formatClock(log.checkIn.at, branch.timezone)} />
              <Cell label="Shift ends" value={formatClock(preview.scheduledEnd, branch.timezone)} />
              <Cell label="Break" value={formatDuration(preview.breakMinutes)} />
            </dl>
          ) : null}

          {/* ---- overtime ---- */}
          {isCheckOut ? (
            <OvertimeToggle
              checked={overtime}
              onChange={setOvertime}
              eligibleMinutes={eligibility?.overtime.eligibleMinutes ?? 0}
              reason={eligibility?.overtime.reason ?? null}
              graceMinutes={(log.shiftSnapshot ?? branch.shift).overtimeGraceMinutes}
              capMinutes={(log.shiftSnapshot ?? branch.shift).maxOvertimeMinutes}
              disabled={blocked || step === STEP.WORKING}
            />
          ) : null}

          {/* ---- location gate ---- */}
          {blocked ? (
            <div className="flex items-start gap-3 rounded-2xl bg-danger-soft p-4">
              <LuTriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-danger-ink">{policy.title}</p>
                {policy.detail ? (
                  <p className="mt-1 text-xs leading-relaxed text-danger-ink/80">{policy.detail}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink" role="alert">
              {error}
            </p>
          ) : null}

          {/* ---- identity ---- */}
          {step === STEP.WORKING ? (
            <div className="py-8">
              <Spinner size={28} label={`Recording your ${isCheckOut ? 'clock-out' : 'clock-in'}…`} />
            </div>
          ) : step === STEP.REVIEW ? (
            <div className="space-y-3">
              {webauthn.available && staff.hasBiometrics ? (
                <button
                  type="button"
                  disabled={blocked || webauthn.busy}
                  onClick={onBiometric}
                  className="group flex w-full items-center gap-4 rounded-3xl bg-brand-600 p-5 text-left text-brand-on shadow-glow transition-all duration-300 ease-expo hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none tap-none"
                >
                  <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15">
                    {webauthn.busy ? (
                      <Spinner size={22} className="text-white" />
                    ) : (
                      <>
                        <span className="absolute inset-0 animate-ring rounded-2xl bg-white/20" aria-hidden="true" />
                        <LuFingerprint className="relative h-6 w-6" aria-hidden="true" />
                      </>
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="block text-[15px] font-bold tracking-tight">Use fingerprint</span>
                    <span className="block text-xs opacity-80">Fastest way to {verb.toLowerCase()}</span>
                  </span>
                  <LuArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" aria-hidden="true" />
                </button>
              ) : null}

              <button
                type="button"
                disabled={blocked}
                onClick={() => setStep(STEP.PIN)}
                className="flex w-full items-center gap-4 rounded-3xl border border-line bg-surface-card p-5 text-left shadow-soft transition-all duration-300 hover:border-brand-500/40 hover:shadow-lift active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 tap-none"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-sunken text-ink-muted">
                  <LuLock className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="flex-1">
                  <span className="block text-[15px] font-bold tracking-tight text-ink">Use my PIN</span>
                  <span className="block text-xs text-ink-subtle">
                    {pinLength} digits, personal to you
                  </span>
                </span>
                <LuArrowRight className="h-5 w-5 text-ink-subtle" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div>
              <p className="mb-5 text-center text-sm font-medium text-ink-muted">
                Enter your personal PIN to {verb.toLowerCase()}
              </p>
              <PinPad
                value={pin}
                onChange={(next) => {
                  setError(null);
                  setPin(next);
                }}
                length={pinLength}
                disabled={blocked}
                error={Boolean(error)}
              />
              {webauthn.available && staff.hasBiometrics ? (
                <button
                  type="button"
                  onClick={() => setStep(STEP.REVIEW)}
                  className="mt-5 w-full text-center text-xs font-semibold text-brand-ink hover:underline"
                >
                  Use fingerprint instead
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

const Cell = ({ label, value }) => (
  <div className="rounded-2xl bg-surface-sunken/60 px-2 py-3">
    <dt className="eyebrow">{label}</dt>
    <dd className="mt-1 text-sm font-bold text-ink tabular">{value}</dd>
  </div>
);

function SuccessPanel({ staff, branch, submitted }) {
  const { verb, workedMinutes: worked, overtimeMinutes: granted, at } = submitted;

  return (
    <div className="py-4 text-center animate-scale-in">
      <div className="relative mx-auto grid h-20 w-20 place-items-center">
        <span className="absolute inset-0 animate-ring rounded-full bg-ok/30" aria-hidden="true" />
        <span className="relative grid h-20 w-20 place-items-center rounded-full bg-ok text-white shadow-lift">
          <LuCheck className="h-9 w-9" strokeWidth={3} aria-hidden="true" />
        </span>
      </div>

      <p className="mt-6 text-2xl font-bold tracking-tight text-ink">
        {verb === 'Clock in' ? 'Welcome in' : 'Have a good evening'}, {staff.name.split(' ')[0]}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {verb === 'Clock in' ? 'Clocked in at' : 'Clocked out at'}{' '}
        <strong className="font-bold text-ink tabular">{formatClock(at, branch.timezone)}</strong>
      </p>

      {worked != null ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-sunken/70 px-4 py-3">
            <p className="eyebrow">Hours today</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-ink tabular">
              {formatDuration(worked)}
            </p>
          </div>
          <div
            className={`rounded-2xl px-4 py-3 ${granted > 0 ? 'bg-ot-soft' : 'bg-surface-sunken/70'}`}
          >
            <p className="eyebrow">Overtime</p>
            <p
              className={`mt-1 text-xl font-bold tracking-tight tabular ${granted > 0 ? 'text-ot-ink' : 'text-ink-subtle'}`}
            >
              {granted > 0 ? formatDuration(granted) : 'None'}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function toMessage(error) {
  const code = error?.code ?? '';
  if (code === 'functions/permission-denied' || code === 'permission-denied') {
    return 'That PIN was not recognised.';
  }
  if (code === 'functions/failed-precondition' || code === 'failed-precondition') {
    return error.message ?? 'That punch does not make sense for the current state.';
  }
  if (code === 'functions/out-of-range') return 'You are outside the shop area.';
  if (code === 'functions/resource-exhausted') {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (code === 'functions/unavailable' || code === 'unavailable') {
    return 'No connection. Your punch will be sent when the network is back.';
  }
  return error?.message ?? 'Could not record that. Try again.';
}
