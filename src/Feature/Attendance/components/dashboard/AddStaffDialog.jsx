import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LuUserPlus, LuTriangleAlert, LuCircleCheck } from 'react-icons/lu';

import Modal from '../ui/Modal';
import Spinner from '../ui/Spinner';
import { BRANCH_LIST, BRANCHES } from '../../config/branches';
import { STAFF_ROLE_ORDER, ROLE_META, roleLabel } from '../../config/roles';
import { createStaff, setStaffPin } from '../../services/staff.service';
import { ADMIN_SEQUENCE } from '../../services/adminReveal';

/**
 * Add an employee.
 *
 * The PIN is collected here and sent straight to the callable that hashes it.
 * It is held in component state only as long as this form is open, is never
 * written to the staff document, and is never logged. Two fields rather than
 * one, because a mistyped PIN is discovered by an employee who cannot clock in
 * on their first morning — long after anyone remembers what was typed.
 */

const TIERS = [...STAFF_ROLE_ORDER].reverse();

export default function AddStaffDialog({ open, onClose, branchId, actor, onAdded }) {
  const [form, setForm] = useState({
    name: '',
    branchId: branchId ?? BRANCH_LIST[0].id,
    role: STAFF_ROLE_ORDER[0],
    employeeCode: '',
    pin: '',
    pinConfirm: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /* Tracked separately from the message so the UI can offer a targeted next
     step for a permission failure specifically, rather than a link that would
     be equally wrong for "the PIN service isn't deployed" or "you're offline". */
  const [errorCode, setErrorCode] = useState(null);
  const [pinWarning, setPinWarning] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: '',
      branchId: branchId ?? BRANCH_LIST[0].id,
      role: STAFF_ROLE_ORDER[0],
      employeeCode: '',
      pin: '',
      pinConfirm: '',
    });
    setError(null);
    setPinWarning(null);
  }, [open, branchId]);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const problems = useMemo(() => {
    const list = [];
    if (!form.name.trim()) list.push('Name is required.');
    if (!/^\d{4}$/.test(form.pin)) list.push('The PIN must be exactly 4 digits.');
    else if (form.pin === ADMIN_SEQUENCE) {
      /* This one is reserved: it is the sequence that reveals the administrator
         sign-in, and it is listened for on every screen. Issued as a personal
         PIN, this person would open the admin door every time they clocked in. */
      list.push('That PIN is reserved by the system. Choose another.');
    } else if (form.pin !== form.pinConfirm) list.push('The two PINs do not match.');
    return list;
  }, [form]);

  const submit = async (event) => {
    event.preventDefault();
    if (problems.length) {
      setError(problems[0]);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const staffId = await createStaff(
        {
          branchId: form.branchId,
          name: form.name.trim(),
          role: form.role,
          employeeCode: form.employeeCode.trim() || null,
        },
        actor?.uid,
      );

      const result = await setStaffPin(staffId, form.pin, actor?.uid);
      if (!result.ok && result.reason === 'not-deployed') {
        /* Whether this actually blocks anyone from clocking in depends
           entirely on VITE_ALLOW_CLIENT_PUNCH. When it's on, submitPunch's
           own client-side fallback never checks the PIN at all — any 4
           digits work — so the PIN this person just typed already works,
           right now, at the kiosk; the seed:pins/Admin-SDK step only matters
           once the real server exists and starts checking it for real. The
           OLD wording here ("cannot clock in yet") was true only in that
           later, not-yet-reached state, and sent someone straight to a
           service-account download for a problem they did not have. */
        setPinWarning(
          import.meta.env.VITE_ALLOW_CLIENT_PUNCH === 'true'
            ? `${form.name.trim()} was added and can already clock in and out at the kiosk with ` +
                'any 4-digit PIN — that check is not switched on yet while the system is being ' +
                `set up. Once it is, run this once to give ${form.name.trim()} a fixed PIN: ` +
                'npm run seed:pins -- --staff'
            : `${form.name.trim()} was added, but the PIN could not be set because the server ` +
                'function is not deployed. Set it with: npm run seed:pins -- --staff',
        );
        onAdded?.(staffId);
        setBusy(false);
        return;
      }

      onAdded?.(staffId);
      onClose?.();
    } catch (submitError) {
      /* "Missing or insufficient permissions" is Firebase's sentence and it
         names nothing an operator can act on. On this form it has one cause
         worth naming: the attendance rules have not been published, so the
         staff write (or the PIN write next to it) is refused. */
      setError(
        submitError?.code === 'permission-denied'
          ? 'Firestore refused the write. The attendance security rules have not been ' +
              'published yet: run `npm run merge:rules`, paste firestore.rules.merged into ' +
              'Firebase Console → Firestore → Rules, and click Publish.'
          : (submitError?.message ?? 'Could not add that employee.'),
      );
      setErrorCode(submitError?.code ?? null);
    } finally {
      setBusy(false);
    }
  };

  if (pinWarning) {
    return (
      <Modal open={open} onClose={onClose} title="Employee added" size="md">
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl bg-warn-soft p-4">
            <LuTriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-warn-ink">{pinWarning}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-brand-on shadow-soft"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an employee"
      subtitle={BRANCHES[form.branchId]?.name}
      size="md"
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" htmlFor="staff-name">
          <input
            id="staff-name"
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            autoComplete="off"
            placeholder="Aye Aye Mon"
            className={inputClass}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Branch" htmlFor="staff-branch">
            <select
              id="staff-branch"
              value={form.branchId}
              onChange={(event) => set({ branchId: event.target.value })}
              className={inputClass}
            >
              {BRANCH_LIST.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Role" htmlFor="staff-role">
            <select
              id="staff-role"
              value={form.role}
              onChange={(event) => set({ role: event.target.value })}
              className={inputClass}
            >
              {TIERS.map((role) => (
                <option key={role} value={role}>{ROLE_META[role].label}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Employee code" htmlFor="staff-code" optional>
          <input
            id="staff-code"
            value={form.employeeCode}
            onChange={(event) => set({ employeeCode: event.target.value })}
            autoComplete="off"
            placeholder="WIN-014"
            className={inputClass}
          />
        </Field>

        <fieldset className="rounded-3xl border border-line bg-surface-sunken/50 p-4">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
            Personal PIN
          </legend>
          <p className="mb-3 text-xs leading-relaxed text-ink-muted">
            Four digits, used to clock in and to open their own records. It is hashed on the
            server — nobody, including you, can read it back afterwards.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              id="staff-pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={form.pin}
              onChange={(event) => set({ pin: event.target.value.replace(/\D/g, '') })}
              autoComplete="new-password"
              placeholder="PIN"
              className={inputClass}
            />
            <input
              id="staff-pin-confirm"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={form.pinConfirm}
              onChange={(event) => set({ pinConfirm: event.target.value.replace(/\D/g, '') })}
              autoComplete="new-password"
              placeholder="Repeat PIN"
              className={inputClass}
            />
          </div>
          {form.pin && form.pinConfirm && form.pin === form.pinConfirm && /^\d{4}$/.test(form.pin) ? (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-ok-ink">
              <LuCircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> PINs match
            </p>
          ) : null}
        </fieldset>

        {error ? (
          <div className="rounded-2xl bg-danger-soft px-4 py-3" role="alert">
            <p className="text-sm font-medium text-danger-ink">{error}</p>
            {errorCode === 'permission-denied' ? (
              <Link
                to="/attendance/diagnostics"
                className="mt-1.5 inline-block text-xs font-bold text-danger-ink underline underline-offset-2"
              >
                Find out why →
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-ink-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || problems.length > 0}
            className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-brand-on shadow-soft transition-all disabled:opacity-40"
          >
            {busy ? <Spinner size={16} className="text-current" /> : <LuUserPlus className="h-4 w-4" aria-hidden="true" />}
            Add {form.name.trim() ? form.name.trim().split(' ')[0] : 'employee'}
          </button>
        </div>

        <p className="text-center text-[11px] text-ink-subtle">
          They will appear on the {roleLabel(form.role)} tier at{' '}
          {BRANCHES[form.branchId]?.shortName}.
        </p>
      </form>
    </Modal>
  );
}

const inputClass =
  'w-full rounded-2xl border border-line bg-surface-card px-3.5 py-2.5 text-sm text-ink shadow-soft transition-colors placeholder:text-ink-subtle focus:border-brand-500/50';

function Field({ label, htmlFor, optional, children }) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
          {label}
        </span>
        {optional ? <span className="text-[11px] text-ink-subtle">optional</span> : null}
      </span>
      {children}
    </label>
  );
}
