import { useTranslation } from 'react-i18next';
import { LuTimer, LuCheck } from 'react-icons/lu';

import Segmented from '../ui/Segmented';
import { RANGE_PRESETS } from '../../hooks/useAttendanceReport';
import { useBranches } from '../../config/BranchesProvider';
import { STAFF_ROLE_ORDER, roleLabel } from '../../config/roles';

/**
 * One filter row, above everything it scopes.
 *
 * Deliberately not per-chart: if two charts on a dashboard can disagree about
 * the date range, the reader has to check which one they are looking at before
 * they can trust a number, and that cost is paid on every single read.
 *
 * Date range comes first — it is the control every reader reaches for.
 *
 * `compact` drops the two controls that only scope the reports (date range and
 * the overtime switch). A view with its own time control — the monthly cards —
 * must not also carry a date range that changes nothing: an inert control is
 * read as a broken one.
 */
export default function FilterBar({ filters, onChange, compact = false }) {
  const { t } = useTranslation();
  const { branches } = useBranches();
  const set = (patch) => onChange({ ...filters, ...patch });

  const roleOptions = STAFF_ROLE_ORDER.slice()
    .reverse()
    .map((role) => ({ value: role, label: roleLabel(role, t) }));

  return (
    <div className="glass glass-sheen sticky top-0 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-3 border-x-0 border-t-0 px-4 py-3 sm:-mx-6 sm:px-6">
      {compact ? null : (
        <Segmented
          label={t('admin.dateRange')}
          size="sm"
          options={RANGE_PRESETS.map((preset) => ({
            value: preset.value,
            label: t(`admin.range.${preset.value}`),
          }))}
          value={filters.range}
          onChange={(range) => set({ range })}
        />
      )}

      <Chips
        label={t('admin.branch')}
        options={[
          { value: 'all', label: t('admin.allBranches') },
          ...branches.map((b) => ({ value: b.id, label: b.shortName })),
        ]}
        value={filters.branchId}
        onChange={(branchId) => set({ branchId })}
      />

      <select
        aria-label={t('admin.role')}
        value={filters.role ?? 'all'}
        onChange={(event) => set({ role: event.target.value === 'all' ? null : event.target.value })}
        className="rounded-2xl border border-line bg-surface-card px-3 py-2 text-xs font-semibold text-ink shadow-soft transition-colors hover:border-brand-500/40"
      >
        <option value="all">{t('admin.allRoles')}</option>
        {roleOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {/* Overtime is a filter, not a series, so it gets its own switch rather
          than a fourth value crammed into the role dropdown. */}
      {compact ? null : (
        <button
          type="button"
          role="switch"
          aria-checked={filters.overtimeOnly}
          onClick={() => set({ overtimeOnly: !filters.overtimeOnly })}
          className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs font-semibold transition-all duration-300 ${
            filters.overtimeOnly
              ? 'border-ot/40 bg-ot-soft text-ot-ink shadow-glow-ot'
              : 'border-line bg-surface-card text-ink-muted shadow-soft hover:border-ot/30'
          }`}
        >
          {filters.overtimeOnly ? (
            <LuCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <LuTimer className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {t('admin.overtimeOnly')}
        </button>
      )}
    </div>
  );
}

function Chips({ label, options, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={`rounded-2xl border px-3 py-2 text-xs font-semibold transition-all duration-300 ${
              active
                ? 'border-transparent bg-brand-600 text-brand-on shadow-soft'
                : 'border-line bg-surface-card text-ink-muted shadow-soft hover:border-brand-500/40 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
