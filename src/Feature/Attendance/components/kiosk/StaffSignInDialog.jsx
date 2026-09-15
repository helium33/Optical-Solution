import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Modal from '../ui/Modal';
import PinPad from './PinPad';
import OvertimeToggle from './OvertimeToggle';
import Spinner from '../ui/Spinner';
import Avatar from '../ui/Avatar';
import { roleLabel } from '../../config/roles';
import { verifyStaffPin } from '../../services/staff.service';
import { ADMIN_SEQUENCE } from '../../services/adminReveal';
import { useNow } from '../../hooks/useNow';
import { computeWorkSession } from '../../lib/time';

/**
 * Prove who you are before your own records open.
 *
 * This is the only gate in front of one person's hours on a tablet the whole
 * shop shares, so it checks the PIN for real rather than accepting any four
 * digits the way the punch fallback does. What "for real" means without a
 * server is set out in verifyStaffPin: a PBKDF2 record the browser reads and
 * compares itself.
 *
 * The verified PIN is handed back to the caller. That is deliberate: the punch
 * that follows still has to present credentials, and asking the same person
 * for the same four digits twice in ten seconds is the kind of friction that
 * gets a kiosk abandoned. It lives in memory for the length of the session and
 * is never stored.
 */

const REASON_KEYS = {
  'wrong-pin': 'errors.wrongPin',
  'no-pin-set': 'errors.noPinSet',
  'pin-unreadable': 'errors.pinUnreadable',
  'not-deployed': 'errors.pinUnreadable',
};

export default function StaffSignInDialog({ open, onClose, staff, log, branch, onVerified }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [overtime, setOvertime] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    if (!open) return;
    setPin('');
    setError(null);
    setBusy(false);
    setOvertime(false);
  }, [open, staff?.id]);

  /* This keypad is now the first one a staff member meets, so the overtime
     decision belongs here: the requirement has always been that it is made
     BEFORE the PIN, and the PIN typed here is what commits the whole
     sequence. The claim rides along to the punch rather than being asked for
     a second time on the next screen.

     Only on the way out — there is no overtime to claim on a clock-in. */
  const isCheckOut = Boolean(log?.checkIn?.at) && !log?.checkOut?.at;
  const shift = log?.shiftSnapshot ?? branch?.shift;

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

  const submit = useCallback(
    async (value) => {
      setBusy(true);
      setError(null);
      try {
        const result = await verifyStaffPin(staff.id, value);
        if (result.ok) {
          onVerified?.(value, overtime);
          return;
        }
        setPin('');
        setError(t(REASON_KEYS[result.reason] ?? 'errors.generic'));
      } catch {
        setPin('');
        setError(t('errors.generic'));
      } finally {
        setBusy(false);
      }
    },
    [staff, onVerified, overtime, t],
  );

  const onPinChange = useCallback(
    (next) => {
      setError(null);
      setPin(next);
      if (next === ADMIN_SEQUENCE) return;
      if (next.length === 4) submit(next);
    },
    [submit],
  );

  if (!staff) return null;

  return (
    <Modal open={open} onClose={onClose} title={t('staffAuth.title')} size="sm">
      <div className="mb-5 flex items-center gap-3">
        <Avatar name={staff.name} seed={staff.id} size={44} />
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold tracking-tight text-ink">{staff.name}</p>
          <p className="truncate text-xs text-ink-subtle">{roleLabel(staff.role, t)}</p>
        </div>
      </div>

      {busy ? (
        <div className="py-12">
          <Spinner size={26} label={t('staffAuth.checking')} />
        </div>
      ) : (
        <>
          {/* ---- OVERTIME: directly above the keypad, decided before the PIN ---- */}
          {isCheckOut ? (
            <div className="mb-5">
              <OvertimeToggle
                checked={overtime}
                onChange={setOvertime}
                eligibleMinutes={eligibility?.overtime.eligibleMinutes ?? 0}
                billedHours={eligibility?.overtimeHours ?? 0}
                reason={eligibility?.overtime.reason ?? null}
                graceMinutes={shift?.overtimeGraceMinutes}
                capMinutes={shift?.maxOvertimeMinutes}
              />
            </div>
          ) : null}

          <PinPad value={pin} onChange={onPinChange} length={4} error={Boolean(error)} />
          {error ? (
            <p className="mt-4 text-center text-sm font-semibold text-danger-ink" role="alert">
              {error}
            </p>
          ) : (
            <p className="mt-4 text-center text-xs text-ink-subtle">{t('staffAuth.ownRecordsOnly')}</p>
          )}
        </>
      )}
    </Modal>
  );
}
