import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LuPencil, LuTrash2, LuRotateCcw, LuTriangleAlert, LuTimer, LuCircleCheck,
} from 'react-icons/lu';

import Modal from '../ui/Modal';
import Spinner from '../ui/Spinner';
import Avatar from '../ui/Avatar';
import { roleLabel } from '../../config/roles';
import { useBranches } from '../../config/BranchesProvider';
import { fetchLog, amendPunchTimes } from '../../services/attendance.service';
import { removeStaff, restoreStaff, deleteStaffPermanently } from '../../services/staff.service';
import { businessDayKey, formatClock, formatDuration, formatDayLabel } from '../../lib/time';

/**
 * One employee, from the administrator's side: correct a day's times, or take
 * them off the system.
 *
 * The correction form is deliberately not a free-text timestamp editor. It
 * takes clock times for one named day and hands them to the same calculation a
 * real punch goes through, so an amended day cannot end up with totals that no
 * punch could have produced.
 *
 * A reason is required. The record keeps the previous values alongside it — an
 * attendance log an administrator can silently rewrite is not evidence, and the
 * person whose pay it decides is entitled to see that it changed and why.
 */

const DANGER = { NONE: 'none', REMOVE: 'remove', DELETE: 'delete' };

export default function StaffDetailDialog({ open, onClose, person, actor, onChanged }) {
  const { get } = useBranches();
  const branch = person ? get(person.branchId) : null;
  const timezone = branch?.timezone ?? 'Asia/Yangon';

  const [dayKey, setDayKey] = useState(() => businessDayKey(new Date(), timezone));
  const [log, setLog] = useState(undefined); // undefined = loading, null = none
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [overtime, setOvertime] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [danger, setDanger] = useState(DANGER.NONE);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    if (!open) return;
    setDayKey(businessDayKey(new Date(), timezone));
    setDanger(DANGER.NONE);
    setConfirmText('');
    setReason('');
    setError(null);
    setSaved(false);
  }, [open, person?.id, timezone]);

  /* Load the chosen day and seed the form from it. */
  useEffect(() => {
    if (!open || !person || !branch) return undefined;
    let cancelled = false;
    setLog(undefined);

    fetchLog(branch.id, dayKey, person.id)
      .then((result) => {
        if (cancelled) return;
        setLog(result);
        setCheckIn(result?.checkIn?.at ? formatClock(result.checkIn.at, timezone) : '');
        setCheckOut(result?.checkOut?.at ? formatClock(result.checkOut.at, timezone) : '');
        setOvertime(Boolean(result?.overtime?.claimed));
      })
      .catch(() => {
        if (!cancelled) setLog(null);
      });

    return () => {
      cancelled = true;
    };
  }, [open, person, branch, dayKey, timezone]);

  const dirty = useMemo(() => {
    if (!log) return Boolean(checkIn);
    const originalIn = log.checkIn?.at ? formatClock(log.checkIn.at, timezone) : '';
    const originalOut = log.checkOut?.at ? formatClock(log.checkOut.at, timezone) : '';
    return (
      checkIn !== originalIn ||
      checkOut !== originalOut ||
      overtime !== Boolean(log.overtime?.claimed)
    );
  }, [log, checkIn, checkOut, overtime, timezone]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await amendPunchTimes({
        log,
        branch,
        checkInHHMM: checkIn || null,
        checkOutHHMM: checkOut || null,
        overtimeRequested: overtime,
        actor,
        reason,
      });
      setSaved(true);
      onChanged?.();
      const refreshed = await fetchLog(branch.id, dayKey, person.id);
      setLog(refreshed);
      setReason('');
    } catch (saveError) {
      setError(saveError?.message ?? 'Could not save that correction.');
    } finally {
      setBusy(false);
    }
  }, [log, branch, checkIn, checkOut, overtime, actor, reason, dayKey, person, onChanged]);

  const runDanger = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (danger === DANGER.REMOVE) {
        if (person.active === false) await restoreStaff(person.id, actor?.uid);
        else await removeStaff(person.id, actor?.uid);
      } else if (danger === DANGER.DELETE) {
        await deleteStaffPermanently(person.id);
      }
      onChanged?.();
      onClose?.();
    } catch (dangerError) {
      setError(dangerError?.message ?? 'That did not work.');
    } finally {
      setBusy(false);
    }
  }, [danger, person, actor, onChanged, onClose]);

  if (!person || !branch) return null;

  const inactive = person.active === false;

  return (
    <Modal open={open} onClose={onClose} title={person.name} subtitle={`${roleLabel(person.role)} · ${branch.name}`} size="md">
      <div className="space-y-5">
        <div className="flex items-center gap-4 rounded-3xl border border-line bg-surface-sunken/60 p-4">
          <Avatar name={person.name} seed={person.id} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-ink">{person.employeeCode ?? '—'}</p>
            <p className="text-xs text-ink-subtle">
              {person.hasBiometrics ? 'Fingerprint enrolled' : 'PIN only'}
            </p>
          </div>
          {inactive ? (
            <span className="rounded-full bg-danger-soft px-2.5 py-1 text-[11px] font-bold text-danger-ink">
              Removed
            </span>
          ) : null}
        </div>

        {/* ---- correction ---- */}
        <section>
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
              <LuPencil className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
              Correct a day
            </h3>
            <input
              type="date"
              value={dayKey}
              onChange={(event) => { setDayKey(event.target.value); setSaved(false); }}
              aria-label="Day to correct"
              className="rounded-xl border border-line bg-surface-card px-3 py-1.5 text-xs font-semibold text-ink shadow-soft"
            />
          </header>

          {log === undefined ? (
            <div className="py-8"><Spinner size={22} label="Loading that day…" /></div>
          ) : (
            <div className="space-y-3 rounded-3xl border border-line bg-surface-card p-4">
              {!log ? (
                <p className="rounded-2xl bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn-ink">
                  No record for {formatDayLabel(dayKey)}. A correction can only adjust a day that
                  already has a check-in — create the punch at the kiosk first.
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <TimeField
                  id="edit-in"
                  label="Check in"
                  value={checkIn}
                  original={log?.checkIn?.at ? formatClock(log.checkIn.at, timezone) : null}
                  onChange={(value) => { setCheckIn(value); setSaved(false); }}
                  disabled={!log}
                />
                <TimeField
                  id="edit-out"
                  label="Check out"
                  value={checkOut}
                  original={log?.checkOut?.at ? formatClock(log.checkOut.at, timezone) : null}
                  onChange={(value) => { setCheckOut(value); setSaved(false); }}
                  disabled={!log}
                />
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={overtime}
                disabled={!log}
                onClick={() => { setOvertime((value) => !value); setSaved(false); }}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors disabled:opacity-50 ${
                  overtime ? 'border-ot/40 bg-ot-soft' : 'border-line bg-surface-sunken/50'
                }`}
              >
                <LuTimer className={`h-4 w-4 shrink-0 ${overtime ? 'text-ot-ink' : 'text-ink-subtle'}`} aria-hidden="true" />
                <span className="flex-1 text-xs font-semibold text-ink">Counts as overtime</span>
                <span className={`h-5 w-9 rounded-full transition-colors ${overtime ? 'bg-ot' : 'bg-line-strong'}`}>
                  <span
                    className="block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow-soft transition-transform"
                    style={{ transform: overtime ? 'translate(18px, 2px)' : 'translate(2px, 2px)' }}
                  />
                </span>
              </button>

              {log?.minutes ? (
                <p className="text-[11px] text-ink-muted tabular">
                  Currently: {formatDuration(log.minutes.worked)} worked
                  {log.minutes.overtime ? `, ${log.minutes.overtimeHours ?? Math.ceil(log.minutes.overtime / 60)}h overtime` : ''}
                  {log.minutes.late ? `, ${log.minutes.late} min late` : ''}
                </p>
              ) : null}

              <label htmlFor="edit-reason" className="block">
                <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                  Reason for the change
                </span>
                <input
                  id="edit-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Forgot to clock out — confirmed with supervisor"
                  disabled={!log}
                  className="w-full rounded-2xl border border-line bg-surface-card px-3.5 py-2.5 text-sm text-ink shadow-soft placeholder:text-ink-subtle disabled:opacity-50"
                />
              </label>

              {log?.edited ? (
                <p className="rounded-2xl bg-surface-sunken px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
                  Last edited by {log.edited.byName} — “{log.edited.reason}”
                </p>
              ) : null}

              {error ? (
                <p className="rounded-2xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger-ink" role="alert">
                  {error}
                </p>
              ) : null}

              {saved ? (
                <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok-ink">
                  <LuCircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Saved
                </p>
              ) : null}

              <button
                type="button"
                onClick={save}
                disabled={busy || !log || !dirty || !reason.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 py-3 text-sm font-bold text-brand-on shadow-soft disabled:opacity-40"
              >
                {busy ? <Spinner size={16} className="text-current" /> : null}
                Save correction
              </button>
            </div>
          )}
        </section>

        {/* ---- danger zone ---- */}
        <section className="rounded-3xl border border-danger/25 bg-danger-soft/40 p-4">
          <h3 className="mb-1 text-sm font-bold tracking-tight text-danger-ink">
            {inactive ? 'Restore or erase' : 'Remove from the system'}
          </h3>
          <p className="mb-3 text-xs leading-relaxed text-ink-muted">
            {inactive
              ? 'This person is already removed. They can be brought back, or erased entirely.'
              : 'Removing hides them from every roster and kiosk immediately. Their past attendance records stay intact, which is what keeps last month’s payroll answerable.'}
          </p>

          {danger === DANGER.NONE ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDanger(DANGER.REMOVE)}
                className="inline-flex items-center gap-1.5 rounded-2xl border border-danger/30 bg-surface-card px-3 py-2 text-xs font-bold text-danger-ink"
              >
                {inactive ? <LuRotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> : <LuTrash2 className="h-3.5 w-3.5" aria-hidden="true" />}
                {inactive ? 'Restore' : 'Remove'}
              </button>
              <button
                type="button"
                onClick={() => setDanger(DANGER.DELETE)}
                className="inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-semibold text-ink-subtle hover:text-danger-ink"
              >
                Delete permanently
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2.5 rounded-2xl bg-surface-card p-3">
                <LuTriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-ink">
                  {danger === DANGER.DELETE ? (
                    <>
                      This erases <strong>{person.name}</strong>’s record for good. Their past
                      attendance rows survive and still show their name, but the person can never
                      be looked up again and this cannot be undone. Type their name to confirm.
                    </>
                  ) : inactive ? (
                    <>Bring <strong>{person.name}</strong> back onto the roster?</>
                  ) : (
                    <>Remove <strong>{person.name}</strong> from the roster? This can be undone.</>
                  )}
                </p>
              </div>

              {danger === DANGER.DELETE ? (
                <input
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder={person.name}
                  aria-label={`Type ${person.name} to confirm`}
                  className="w-full rounded-2xl border border-danger/30 bg-surface-card px-3.5 py-2.5 text-sm text-ink"
                />
              ) : null}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setDanger(DANGER.NONE); setConfirmText(''); }}
                  className="flex-1 rounded-2xl border border-line bg-surface-card px-3 py-2.5 text-xs font-semibold text-ink-muted"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={runDanger}
                  disabled={busy || (danger === DANGER.DELETE && confirmText.trim() !== person.name)}
                  className="flex-1 rounded-2xl bg-danger px-3 py-2.5 text-xs font-bold text-white disabled:opacity-40"
                >
                  {danger === DANGER.DELETE ? 'Delete for good' : inactive ? 'Restore' : 'Remove'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function TimeField({ id, label, value, original, onChange, disabled }) {
  const changed = original != null && value !== original;
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">{label}</span>
        {changed ? (
          <span className="text-[11px] font-semibold text-warn-ink tabular">was {original}</span>
        ) : null}
      </span>
      <input
        id={id}
        type="time"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`w-full rounded-2xl border bg-surface-card px-3.5 py-2.5 text-sm text-ink shadow-soft tabular disabled:opacity-50 ${
          changed ? 'border-warn/50' : 'border-line'
        }`}
      />
    </label>
  );
}
