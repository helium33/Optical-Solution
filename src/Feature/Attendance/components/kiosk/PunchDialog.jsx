import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LuFingerprint, LuCheck, LuTriangleAlert } from 'react-icons/lu';

import Modal from '../ui/Modal';
import Spinner from '../ui/Spinner';
import Avatar from '../ui/Avatar';
import StatusPill from '../ui/StatusPill';
import PinPad from './PinPad';
import OvertimeToggle from './OvertimeToggle';
import { usePolicyText } from '../../i18n/policyText';
import { useWebAuthn } from '../../hooks/useWebAuthn';
import { useNow } from '../../hooks/useNow';
import { submitPunch, PUNCH, AUTH_METHOD } from '../../services/attendance.service';
import { INTENT, ACCESS } from '../../lib/accessPolicy';
import { BYPASS_TAG } from '../../config/devMode';
import { ADMIN_SEQUENCE } from '../../services/adminReveal';
import { computeWorkSession, formatClock, formatDuration, ATTENDANCE_STATUS } from '../../lib/time';
import { roleLabel } from '../../config/roles';

/**
 * Clock in / clock out.
 *
 * ONE SCREEN, and the order on it is the point.
 *
 *   who you are  ->  what it will record  ->  OVERTIME  ->  prove it is you
 *
 * The overtime switch sits directly above the keypad because it has to be
 * decided *before* the PIN is entered: entering the PIN is the commit, and by
 * then the claim is already part of the payload. Putting it on an earlier
 * screen, or below the keypad, invites someone to type four digits and then
 * discover the choice they needed to make.
 *
 * There is no staff dashboard. A successful punch shows a confirmation and
 * returns to the roster by itself — a shop tablet is a shared surface, and
 * leaving a person's hours on screen for the next member of staff to read is
 * not a feature.
 *
 * "What it will record" is shown for BOTH directions, not just check-out:
 * clocking in previews the scheduled start and whether this is on time or
 * late, using the exact same computeWorkSession() the server scores it with,
 * so the number a person sees here is never a rough estimate that could then
 * disagree with what actually gets recorded. Clocking out adds a fourth cell
 * for overtime the moment it becomes eligible, so the figure is visible at a
 * glance rather than only after opening the toggle below it.
 */

const STEP = { ENTRY: 'entry', WORKING: 'working', DONE: 'done' };

/** How long the confirmation stays up before the kiosk resets itself. */
const SUCCESS_MS = 2800;

export default function PunchDialog({ open, onClose, staff, log, branch, geo, onSubmitted }) {
  const { t } = useTranslation();
  const isCheckOut = Boolean(log?.checkIn?.at) && !log?.checkOut?.at;
  const kind = isCheckOut ? PUNCH.CHECK_OUT : PUNCH.CHECK_IN;

  const now = useNow(1000);
  const webauthn = useWebAuthn();

  const [step, setStep] = useState(STEP.ENTRY);
  const [pin, setPin] = useState('');
  const [overtime, setOvertime] = useState(false);
  const [error, setError] = useState(null);
  /* Whether `error` means the server side of the punch could not be reached
     at all, as opposed to a rejection FROM a server that IS there (a wrong
     PIN, a rate limit) — only the former is worth a diagnostics link. */
  const [errorUnreachable, setErrorUnreachable] = useState(false);
  /* Frozen at send time: `isCheckOut` is derived from the log and flips the
     instant the punch lands, which would relabel the confirmation. */
  const [submitted, setSubmitted] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStep(STEP.ENTRY);
    setPin('');
    setOvertime(false);
    setError(null);
    setErrorUnreachable(false);
    setSubmitted(null);
  }, [open, staff?.id]);

  const shift = log?.shiftSnapshot ?? branch?.shift;

  /** What this punch will record, recomputed every tick. */
  const preview = useMemo(() => {
    if (!isCheckOut || !log?.checkIn?.at || !branch) return null;
    return computeWorkSession({
      checkInAt: log.checkIn.at,
      checkOutAt: now,
      shift,
      timeZone: branch.timezone,
      overtimeRequested: overtime,
      now,
    });
  }, [isCheckOut, log, branch, shift, now, overtime]);

  /**
   * The check-in equivalent of `preview` above: what clocking in RIGHT NOW
   * would record. checkOutAt is set to the same instant as checkInAt purely
   * so computeWorkSession scores lateness against a closed, not an open,
   * session — workedMinutes from this call is meaningless and unused; only
   * scheduledStart and status are read. Same function the server uses to
   * decide LATE vs ON_TIME, so this can never show "on time" for a punch the
   * server is about to record as late.
   */
  const checkInPreview = useMemo(() => {
    if (isCheckOut || !branch) return null;
    return computeWorkSession({ checkInAt: now, checkOutAt: now, shift, timeZone: branch.timezone, now });
  }, [isCheckOut, branch, shift, now]);

  /* Eligibility ignores the toggle, or turning it off would report "no
     overtime available" and it could never be turned back on. */
  const eligibility = useMemo(() => {
    if (!isCheckOut || !log?.checkIn?.at || !branch) return null;
    return computeWorkSession({
      checkInAt: log.checkIn.at,
      checkOutAt: now,
      shift,
      timeZone: branch.timezone,
      overtimeRequested: true,
      now,
    });
  }, [isCheckOut, log, branch, shift, now]);

  /**
   * Claiming overtime exempts the clock-out from the shop-network check — the
   * router is often off by the time a late shift ends. The geofence still
   * applies in full.
   */
  const intent = !isCheckOut
    ? INTENT.CHECK_IN
    : overtime
      ? INTENT.OVERTIME_CHECK_OUT
      : INTENT.CHECK_OUT;

  const policy = geo.evaluateFor ? geo.evaluateFor(intent) : geo.policy;
  const policyText = usePolicyText(policy);
  const blocked = policy.access !== ACCESS.ALLOWED;

  const actionLabel = isCheckOut ? t('kiosk.clockOut') : t('kiosk.clockIn');

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
          locationBypass: geo.bypassed ? BYPASS_TAG : null,
        });

        setSubmitted({
          kind,
          isCheckOut,
          workedMinutes: response?.computed?.workedMinutes ?? preview?.workedMinutes ?? null,
          overtimeHours: response?.computed?.overtimeHours ?? preview?.overtimeHours ?? 0,
          at: new Date(),
        });
        setStep(STEP.DONE);
        onSubmitted?.(response);
      } catch (submitError) {
        const described = describeError(submitError, t);
        setError(described.message);
        setErrorUnreachable(described.unreachable);
        setStep(STEP.ENTRY);
        setPin('');
      }
    },
    [kind, branch, staff, overtime, geo, preview, intent, isCheckOut, onSubmitted, t],
  );

  const pinLength = branch?.staffPinLength ?? 4;

  const onPinChange = useCallback(
    (next) => {
      setError(null);
      setErrorUnreachable(false);
      setPin(next);
      /* Reserved: SecretAdminDoor is already navigating away. */
      if (next === ADMIN_SEQUENCE) return;
      if (next.length === pinLength) send({ method: AUTH_METHOD.PIN, pin: next });
    },
    [pinLength, send],
  );

  const onBiometric = useCallback(async () => {
    setError(null);
    try {
      const assertion = await webauthn.verify(staff);
      await send({ method: AUTH_METHOD.BIOMETRIC, assertion });
    } catch (biometricError) {
      setError(biometricError.message);
    }
  }, [webauthn, staff, send]);

  /* The kiosk resets itself. Nobody should have to dismiss a confirmation. */
  useEffect(() => {
    if (step !== STEP.DONE) return undefined;
    const timer = setTimeout(() => onClose?.(), SUCCESS_MS);
    return () => clearTimeout(timer);
  }, [step, onClose]);

  if (!staff || !branch) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === STEP.DONE ? null : actionLabel}
      subtitle={step === STEP.DONE ? null : formatClock(now, branch.timezone, { seconds: true })}
      size="md"
    >
      {step === STEP.DONE && submitted ? (
        <SuccessPanel staff={staff} branch={branch} submitted={submitted} />
      ) : (
        <div className="space-y-4">
          {/* ---- who ---- */}
          <div className="flex items-center gap-4 rounded-3xl border border-line bg-surface-sunken/60 p-4">
            <Avatar name={staff.name} seed={staff.id} size={52} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold tracking-tight text-ink">{staff.name}</p>
              <p className="truncate text-xs font-medium text-ink-subtle">
                {roleLabel(staff.role, t)} · {branch.shortName}
              </p>
            </div>
            {isCheckOut && preview ? (
              <div className="shrink-0 text-right">
                <p className="eyebrow">{t('punch.worked')}</p>
                <p className="text-lg font-bold tracking-tight text-ink tabular">
                  {formatDuration(preview.workedMinutes)}
                </p>
              </div>
            ) : null}
          </div>

          {/* ---- what it will record ---- */}
          {isCheckOut && preview ? (
            <dl className={`grid gap-2 text-center ${eligibility?.overtime.eligibleMinutes > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              <Cell label={t('punch.checkedIn')} value={formatClock(log.checkIn.at, branch.timezone)} />
              <Cell label={t('punch.shiftEnds')} value={formatClock(preview.scheduledEnd, branch.timezone)} />
              <Cell label={t('punch.break')} value={formatDuration(preview.breakMinutes)} />
              {eligibility?.overtime.eligibleMinutes > 0 ? (
                <Cell
                  label={t('punch.overtimeAvailable')}
                  value={formatDuration(eligibility.overtime.eligibleMinutes)}
                  tone="ot"
                />
              ) : null}
            </dl>
          ) : null}

          {/* ---- what it will record, on check-IN ---- */}
          {!isCheckOut && checkInPreview ? (
            <dl className="grid grid-cols-2 gap-2 text-center">
              <Cell
                label={t('punch.scheduledStart')}
                value={formatClock(checkInPreview.scheduledStart, branch.timezone)}
              />
              <div className="rounded-2xl bg-surface-sunken/60 px-2 py-2.5">
                <dt className="eyebrow">{t('punch.status')}</dt>
                <dd className="mt-1 flex justify-center">
                  <StatusPill
                    size="sm"
                    status={checkInPreview.status}
                    label={
                      checkInPreview.status === ATTENDANCE_STATUS.LATE
                        ? t('punch.lateBy', { duration: formatDuration(checkInPreview.lateMinutes) })
                        : t('punch.onTime')
                    }
                  />
                </dd>
              </div>
            </dl>
          ) : null}

          {/* ---- OVERTIME: directly above the keypad, decided before the PIN ---- */}
          {isCheckOut ? (
            <OvertimeToggle
              checked={overtime}
              onChange={setOvertime}
              eligibleMinutes={eligibility?.overtime.eligibleMinutes ?? 0}
              billedHours={eligibility?.overtimeHours ?? 0}
              reason={eligibility?.overtime.reason ?? null}
              graceMinutes={shift?.overtimeGraceMinutes}
              capMinutes={shift?.maxOvertimeMinutes}
              disabled={blocked || step === STEP.WORKING}
            />
          ) : null}

          {/* ---- location gate ---- */}
          {blocked ? (
            <div className="flex items-start gap-3 rounded-2xl bg-danger-soft p-4">
              <LuTriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-danger-ink">{policyText.title}</p>
                {policyText.detail ? (
                  <p className="mt-1 text-xs leading-relaxed text-danger-ink/80">
                    {policyText.detail}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl bg-danger-soft px-4 py-3" role="alert">
              <p className="text-sm font-medium text-danger-ink">{error}</p>
              {errorUnreachable ? (
                <Link
                  to="/attendance/diagnostics"
                  className="mt-1.5 inline-block text-xs font-bold text-danger-ink underline underline-offset-2"
                >
                  {t('kiosk.runDiagnostics')}
                </Link>
              ) : null}
            </div>
          ) : null}

          {/* ---- prove it is you ---- */}
          {step === STEP.WORKING ? (
            <div className="py-10">
              <Spinner size={28} label={t('punch.recording', { action: actionLabel.toLowerCase() })} />
            </div>
          ) : (
            <>
              {webauthn.available && staff.hasBiometrics ? (
                <button
                  type="button"
                  disabled={blocked || webauthn.busy}
                  onClick={onBiometric}
                  className="flex w-full items-center gap-4 rounded-3xl bg-brand-600 p-4 text-left text-brand-on shadow-glow transition-all duration-300 ease-expo hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none tap-none"
                >
                  <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/15">
                    {webauthn.busy ? (
                      <Spinner size={20} className="text-white" />
                    ) : (
                      <>
                        <span className="absolute inset-0 animate-ring rounded-2xl bg-white/20" aria-hidden="true" />
                        <LuFingerprint className="relative h-5 w-5" aria-hidden="true" />
                      </>
                    )}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-bold tracking-tight">
                      {t('punch.useFingerprint')}
                    </span>
                    <span className="block text-xs opacity-80">
                      {t('punch.fastestWay', { action: actionLabel.toLowerCase() })}
                    </span>
                  </span>
                </button>
              ) : null}

              <div>
                <p className="mb-4 text-center text-sm font-semibold text-ink-muted">
                  {t('punch.enterPinTo', { action: actionLabel.toLowerCase() })}
                </p>
                <PinPad
                  value={pin}
                  onChange={onPinChange}
                  length={pinLength}
                  disabled={blocked}
                  error={Boolean(error)}
                />
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

const Cell = ({ label, value, tone }) => (
  <div className={`rounded-2xl px-2 py-2.5 ${tone === 'ot' ? 'bg-ot-soft' : 'bg-surface-sunken/60'}`}>
    <dt className="eyebrow">{label}</dt>
    <dd className={`mt-0.5 text-sm font-bold tabular ${tone === 'ot' ? 'text-ot-ink' : 'text-ink'}`}>
      {value}
    </dd>
  </div>
);

function SuccessPanel({ staff, branch, submitted }) {
  const { t } = useTranslation();
  const { isCheckOut, workedMinutes, overtimeHours, at } = submitted;
  const firstName = String(staff.name).split(' ')[0];

  return (
    <div className="py-4 text-center animate-scale-in">
      <div className="relative mx-auto grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 animate-ring rounded-full bg-ok/30" aria-hidden="true" />
        <span
          className="absolute inset-0 animate-ring rounded-full bg-ok/20"
          style={{ animationDelay: '0.4s' }}
          aria-hidden="true"
        />
        <span className="relative grid h-24 w-24 place-items-center rounded-full bg-ok text-white shadow-lift">
          <LuCheck className="h-11 w-11" strokeWidth={3} aria-hidden="true" />
        </span>
      </div>

      <p className="mt-6 text-2xl font-bold tracking-tight text-ink text-balance">
        {isCheckOut
          ? t('punch.goodEvening', { name: firstName })
          : t('punch.welcomeIn', { name: firstName })}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {isCheckOut ? t('punch.clockedOutAt') : t('punch.clockedInAt')}{' '}
        <strong className="font-bold text-ink tabular">{formatClock(at, branch.timezone)}</strong>
      </p>

      {isCheckOut && workedMinutes != null ? (
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-sunken/70 px-4 py-3">
            <p className="eyebrow">{t('punch.hoursToday')}</p>
            <p className="mt-1 text-xl font-bold tracking-tight text-ink tabular">
              {formatDuration(workedMinutes)}
            </p>
          </div>
          <div className={`rounded-2xl px-4 py-3 ${overtimeHours > 0 ? 'bg-ot-soft' : 'bg-surface-sunken/70'}`}>
            <p className="eyebrow">{t('overtime.title')}</p>
            <p
              className={`mt-1 text-xl font-bold tracking-tight tabular ${
                overtimeHours > 0 ? 'text-ot-ink' : 'text-ink-subtle'
              }`}
            >
              {overtimeHours > 0 ? `${overtimeHours} ${t('common.hours')}` : t('common.none')}
            </p>
          </div>
        </div>
      ) : null}

      {/* The kiosk goes back by itself — this says so rather than leaving
          someone waiting, or worse, tapping around on a shared screen. */}
      <p className="mt-6 text-xs text-ink-subtle">{t('punch.returningToKiosk')}</p>
    </div>
  );
}

/**
 * A KNOWN, EXPECTED rejection FROM a function that ran — as opposed to the
 * function never having run at all. This is a denylist rather than an
 * allowlist of "unavailable" codes on purpose: `isCallableUnavailable()`
 * covers the shapes seen so far (not-found, internal, unavailable, prefixed
 * or bare), but a genuine raw network failure reaches this catch with NO
 * `.code` at all, matching none of them — and that is the single most likely
 * real cause of "cannot reach the server," not another disguise of "not
 * deployed." Starting from "what does a real rejection look like" and
 * treating everything else as unreachable covers that case along with any
 * future error shape neither list has seen yet, rather than adding one more
 * code at a time forever.
 */
function describeError(error, t) {
  const code = error?.code ?? '';

  if (code === 'functions/permission-denied' || code === 'permission-denied') {
    return { message: t('errors.wrongPin'), unreachable: false };
  }
  if (code === 'functions/resource-exhausted') {
    return { message: t('errors.tooManyAttempts'), unreachable: false };
  }
  if (code === 'functions/failed-precondition' || code === 'failed-precondition') {
    return { message: error.message ?? t('errors.generic'), unreachable: false };
  }

  return { message: t('errors.noServer'), unreachable: true };
}
