import { useTranslation } from 'react-i18next';
import { LuChevronDown, LuLock } from 'react-icons/lu';

import Modal from '../ui/Modal';
import { STAFF_ROLE_ORDER, ROLE_META, roleLabel } from '../../config/roles';

/**
 * The branch's role ladder, opened from the unlock screen.
 *
 * It shows the STRUCTURE — Supervisor down to Sales Associate — and not the
 * people in it, and that is a constraint rather than a simplification: the
 * roster is what the branch PIN protects, and this dialog opens before the PIN
 * has been entered. Listing names here would hand the roster to anyone holding
 * the tablet, which is the one thing the lock exists to prevent. The names are
 * one screen away, behind the PIN, grouped by these same tiers.
 *
 * Highest rank first, top to bottom, because that is the direction the
 * hierarchy is read in and the same order the roster and the admin Team view
 * use — a person's place in the shop should look identical everywhere.
 */

const TIERS = [...STAFF_ROLE_ORDER].reverse();

export default function BranchHierarchyDialog({ open, onClose, branch }) {
  const { t } = useTranslation();
  if (!branch) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('hierarchy.title')}
      subtitle={`${branch.name} · ${branch.shift.start}–${branch.shift.end}`}
      size="md"
    >
      <ol className="space-y-1">
        {TIERS.map((role, index) => (
          <li key={role}>
            <div className="flex items-center gap-3.5 rounded-3xl border border-line bg-surface-card p-4 shadow-soft">
              <span
                aria-hidden="true"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand-600 text-[13px] font-bold tracking-wide text-brand-on shadow-soft"
              >
                {ROLE_META[role].abbr}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold tracking-tight text-ink">
                  {roleLabel(role, t)}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                  {t(`hierarchy.role.${role}`)}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-surface-sunken px-2.5 py-1 text-[11px] font-bold text-ink-subtle tabular">
                {index + 1}
              </span>
            </div>

            {index < TIERS.length - 1 ? (
              <div className="grid place-items-center py-0.5" aria-hidden="true">
                <LuChevronDown className="h-4 w-4 text-ink-subtle" />
              </div>
            ) : null}
          </li>
        ))}
      </ol>

      <p className="mt-5 flex items-start gap-2 rounded-2xl bg-surface-sunken/60 px-4 py-3 text-xs leading-relaxed text-ink-muted">
        <LuLock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t('hierarchy.namesAfterUnlock')}</span>
      </p>
    </Modal>
  );
}
