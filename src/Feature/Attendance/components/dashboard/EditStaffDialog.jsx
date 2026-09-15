import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuSave, LuTriangleAlert } from 'react-icons/lu';

import Modal from '../ui/Modal';
import Spinner from '../ui/Spinner';
import { useBranches } from '../../config/BranchesProvider';
import { STAFF_ROLE_ORDER, roleLabel } from '../../config/roles';
import { updateStaffDetails, setStaffPin, fetchStaffPin } from '../../services/staff.service';
import { ADMIN_SEQUENCE } from '../../services/adminReveal';

/**
 * Edit one employee: name, role, branch, PIN.
 *
 * The PIN field starts blank and only writes when something is typed, so
 * saving a name change cannot silently re-hash or clear a PIN that was fine.
 * The current PIN is loaded on open so an administrator can see what it is
 * before deciding to change it — that read is admin-only at the rule level,
 * not by this component choosing to be discreet.
 */

const TIERS = [...STAFF_ROLE_ORDER].reverse();

export default function EditStaffDialog({ open, onClose, staff, actor, onSaved }) {
  const { t } = useTranslation();
  const { branches } = useBranches();
  const [form, setForm] = useState({ name: '', role: '', branchId: '', employeeCode: '', pin: '' });
  const [currentPin, setCurrentPin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || !staff) return;
    setForm({
      name: staff.name ?? '',
      role: staff.role ?? TIERS[TIERS.length - 1],
      branchId: staff.branchId ?? '',
      employeeCode: staff.employeeCode ?? '',
      pin: '',
    });
    setError(null);
    setCurrentPin(null);
    fetchStaffPin(staff.id)
      .then((result) => setCurrentPin(result.ok ? result.pin : null))
      .catch(() => setCurrentPin(null));
  }, [open, staff]);

  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  const problem = useMemo(() => {
    if (!form.name.trim()) return t('admin.nameRequired');
    if (form.pin && !/^\d{4}$/.test(form.pin)) return t('admin.pinFourDigits');
    if (form.pin && form.pin === ADMIN_SEQUENCE) return t('admin.pinReserved');
    return null;
  }, [form, t]);

  const submit = async (event) => {
    event.preventDefault();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateStaffDetails(
        staff.id,
        {
          name: form.name.trim(),
          role: form.role,
          branchId: form.branchId,
          employeeCode: form.employeeCode.trim(),
        },
        actor?.uid,
      );
      /* Only when one was actually typed. A blank field means "leave it". */
      if (form.pin) await setStaffPin(staff.id, form.pin, actor?.uid);
      onSaved?.();
      onClose?.();
    } catch (saveError) {
      setError(saveError?.message ?? t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (!staff) return null;

  return (
    <Modal open={open} onClose={onClose} title={t('admin.editEmployee')} subtitle={staff.name} size="md">
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('admin.colName')}>
          <input
            value={form.name}
            onChange={(event) => set({ name: event.target.value })}
            className={inputClass}
            autoComplete="off"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin.colRole')}>
            <select
              value={form.role}
              onChange={(event) => set({ role: event.target.value })}
              className={inputClass}
            >
              {TIERS.map((role) => (
                <option key={role} value={role}>{roleLabel(role, t)}</option>
              ))}
            </select>
          </Field>

          <Field label={t('admin.colBranch')}>
            <select
              value={form.branchId}
              onChange={(event) => set({ branchId: event.target.value })}
              className={inputClass}
            >
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={t('admin.colPin')}>
          <input
            value={form.pin}
            onChange={(event) => set({ pin: event.target.value.replace(/\D/g, '').slice(0, 4) })}
            inputMode="numeric"
            maxLength={4}
            placeholder={currentPin ? t('admin.pinCurrent', { pin: currentPin }) : t('admin.pinNoneSet')}
            autoComplete="off"
            className={inputClass}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-subtle">
            {t('admin.pinLeaveBlank')}
          </p>
        </Field>

        {error ? (
          <div className="flex items-start gap-2 rounded-2xl bg-danger-soft px-4 py-3" role="alert">
            <LuTriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" aria-hidden="true" />
            <p className="text-sm font-medium text-danger-ink">{error}</p>
          </div>
        ) : null}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-line px-4 py-3 text-sm font-semibold text-ink-muted"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-brand-on shadow-soft disabled:opacity-40"
          >
            {busy ? <Spinner size={16} className="text-current" /> : <LuSave className="h-4 w-4" aria-hidden="true" />}
            {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const inputClass =
  'w-full rounded-2xl border border-line bg-surface-card px-3.5 py-2.5 text-sm text-ink shadow-soft transition-colors placeholder:text-ink-subtle focus:border-brand-500/50';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}
