import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuEye, LuEyeOff, LuPencil } from 'react-icons/lu';

import Avatar from '../ui/Avatar';
import { useBranches } from '../../config/BranchesProvider';
import { roleLabel } from '../../config/roles';
import { fetchStaffPin } from '../../services/staff.service';

/**
 * Employee management: every person, their PIN, and a way to edit both.
 *
 * PINs are fetched one at a time, when an eye is clicked, rather than loaded
 * with the table. Two reasons, and neither is laziness: a PIN read is a read
 * of a document the rules restrict to administrators, so not making it is the
 * difference between "the admin looked up one PIN" and "every PIN in the shop
 * was pulled into a browser tab because someone opened a screen"; and a table
 * that renders PINs by default puts them on a laptop in a shop where other
 * people walk past.
 */
export default function EmployeeTable({ staff, onEdit }) {
  const { t } = useTranslation();
  const { get } = useBranches();
  const [pins, setPins] = useState({});

  const toggle = useCallback(async (staffId) => {
    if (pins[staffId]) {
      setPins((current) => {
        const next = { ...current };
        delete next[staffId];
        return next;
      });
      return;
    }
    setPins((current) => ({ ...current, [staffId]: { loading: true } }));
    const result = await fetchStaffPin(staffId).catch(() => ({ ok: false, reason: 'error' }));
    setPins((current) => ({
      ...current,
      [staffId]: result.ok ? { value: result.pin } : { reason: result.reason },
    }));
  }, [pins]);

  if (!staff.length) {
    return <p className="card card-pad text-center text-sm text-ink-muted">{t('admin.noStaffYet')}</p>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[38rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <Th align="left">{t('admin.colName')}</Th>
            <Th align="left">{t('admin.colRole')}</Th>
            <Th align="left">{t('admin.colBranch')}</Th>
            <Th align="left">{t('admin.colPin')}</Th>
            <Th align="right">{t('admin.colActions')}</Th>
          </tr>
        </thead>
        <tbody>
          {staff.map((person) => {
            const shown = pins[person.id];
            return (
              <tr key={person.id} className="border-b border-line/60 last:border-0">
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={person.name} seed={person.id} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{person.name}</span>
                      {person.employeeCode ? (
                        <span className="block truncate text-[11px] text-ink-subtle">
                          {person.employeeCode}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-ink-muted">{roleLabel(person.role, t)}</td>
                <td className="px-3 py-2.5 text-xs text-ink-muted">
                  {get(person.branchId)?.shortName ?? person.branchId}
                </td>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => toggle(person.id)}
                    className="inline-flex items-center gap-2 rounded-xl border border-line px-2.5 py-1.5 text-xs font-bold text-ink-muted transition-colors hover:text-ink"
                    aria-label={shown ? t('admin.hidePin') : t('admin.showPin')}
                  >
                    {shown ? (
                      <LuEyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <LuEye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span className="tabular">
                      {!shown
                        ? '••••'
                        : shown.loading
                          ? '…'
                          : shown.value
                            ? shown.value
                            : shown.reason === 'denied'
                              ? t('admin.pinDenied')
                              : t('admin.pinNoneSet')}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => onEdit(person)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-surface-sunken px-3 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-brand-600 hover:text-brand-on"
                  >
                    <LuPencil className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('common.edit')}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = 'left' }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-subtle ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  );
}
