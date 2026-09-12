import { useMemo, useState } from 'react';
import { LuChevronRight, LuFingerprint, LuUserPlus } from 'react-icons/lu';

import Avatar from '../ui/Avatar';
import StatusPill from '../ui/StatusPill';
import { STAFF_ROLE_ORDER, roleLabel } from '../../config/roles';
import { BRANCHES } from '../../config/branches';
import { formatClock } from '../../lib/time';

/**
 * The roster drawn as a hierarchy: Supervisor > Sales Leader > Sales Executive
 * > Sales Associate, nested under each branch.
 *
 * ONE THING TO BE CLEAR ABOUT: this is a *seniority* tree, not a reporting
 * tree. Nesting an Associate under a Leader here does not mean that Leader is
 * their manager — it means Associate is the tier below Leader. The data model
 * has no `reportsTo` field, so drawing real reporting lines would be inventing
 * them. If who-reports-to-whom matters later, add that field and this component
 * can switch to it; until then the nesting says what it actually knows.
 *
 * Tiers with nobody in them are skipped rather than drawn empty — a shop with
 * no Sales Executive should not look like it has a hole in its org chart.
 */

const TIERS = [...STAFF_ROLE_ORDER].reverse(); // supervisor first

export default function OrgTree({ staff, logs = [], branchIds, onSelect, onAdd, timezone }) {
  const byBranch = useMemo(() => {
    const map = new Map(branchIds.map((id) => [id, []]));
    for (const person of staff) {
      if (map.has(person.branchId)) map.get(person.branchId).push(person);
    }
    return map;
  }, [staff, branchIds]);

  const logByStaff = useMemo(() => {
    const map = new Map();
    for (const log of logs) map.set(log.staffId, log);
    return map;
  }, [logs]);

  return (
    <div className="space-y-4">
      {[...byBranch.entries()].map(([branchId, people]) => (
        <BranchTree
          key={branchId}
          branchId={branchId}
          people={people}
          logByStaff={logByStaff}
          onSelect={onSelect}
          onAdd={onAdd}
          timezone={timezone}
        />
      ))}
    </div>
  );
}

function BranchTree({ branchId, people, logByStaff, onSelect, onAdd, timezone }) {
  const [open, setOpen] = useState(true);
  const branch = BRANCHES[branchId];

  const tiers = useMemo(
    () =>
      TIERS.map((role) => ({
        role,
        people: people
          .filter((person) => person.role === role)
          .sort((a, b) => String(a.name).localeCompare(String(b.name))),
      })).filter((tier) => tier.people.length > 0),
    [people],
  );

  return (
    /* data-branch scopes the token palette to this subtree, so each branch's
       card wears its own colours even when all three are on screen together. */
    <section data-branch={branch?.theme} className="card overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-line bg-brand-600/[0.06] px-5 py-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <LuChevronRight
            className={`h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-300 ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <span className="h-8 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold tracking-tight text-ink">
              {branch?.name ?? branchId}
            </span>
            <span className="block text-xs text-ink-subtle">
              {people.length} {people.length === 1 ? 'person' : 'people'} ·{' '}
              {tiers.length} {tiers.length === 1 ? 'tier' : 'tiers'}
            </span>
          </span>
        </button>

        {onAdd ? (
          <button
            type="button"
            onClick={() => onAdd(branchId)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl bg-brand-600 px-3 py-2 text-xs font-bold text-brand-on shadow-soft transition-transform hover:scale-105"
          >
            <LuUserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </button>
        ) : null}
      </header>

      {open ? (
        <div className="p-5">
          {tiers.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-subtle">
              Nobody on this branch yet.
            </p>
          ) : (
            <Tier tiers={tiers} depth={0} logByStaff={logByStaff} onSelect={onSelect} timezone={timezone} />
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Renders one tier and recurses into the next, indenting as it goes.
 *
 * The connector is a single left border on the nested container plus a short
 * horizontal stub per row — cheaper and more robust than drawing SVG paths,
 * and it reflows correctly when a long name wraps.
 */
function Tier({ tiers, depth, logByStaff, onSelect, timezone }) {
  if (depth >= tiers.length) return null;
  const { role, people } = tiers[depth];

  return (
    <div className={depth === 0 ? '' : 'relative ml-4 border-l border-line pl-5 sm:ml-6 sm:pl-7'}>
      <p className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
          {roleLabel(role)}
        </span>
        <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10px] font-bold text-ink-subtle tabular">
          {people.length}
        </span>
      </p>

      <ul className="mb-4 space-y-2">
        {people.map((person) => (
          <li key={person.id} className="relative">
            {depth > 0 ? (
              <span
                aria-hidden="true"
                className="absolute -left-5 top-1/2 h-px w-4 bg-line sm:-left-7 sm:w-6"
              />
            ) : null}
            <PersonRow
              person={person}
              log={logByStaff.get(person.id)}
              onSelect={onSelect}
              timezone={timezone}
            />
          </li>
        ))}
      </ul>

      <Tier tiers={tiers} depth={depth + 1} logByStaff={logByStaff} onSelect={onSelect} timezone={timezone} />
    </div>
  );
}

function PersonRow({ person, log, onSelect, timezone }) {
  const Wrapper = onSelect ? 'button' : 'div';

  return (
    <Wrapper
      {...(onSelect ? { type: 'button', onClick: () => onSelect(person) } : {})}
      className={`flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-card px-3 py-2.5 text-left transition-all duration-200 ${
        onSelect ? 'hover:border-brand-500/40 hover:shadow-soft tap-none' : ''
      }`}
    >
      <Avatar name={person.name} seed={person.id} size={36} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-ink">{person.name}</span>
          {person.hasBiometrics ? (
            <LuFingerprint className="h-3 w-3 shrink-0 text-brand-ink/60" aria-label="Fingerprint enrolled" />
          ) : null}
        </span>
        {person.employeeCode ? (
          <span className="block truncate text-[11px] text-ink-subtle tabular">{person.employeeCode}</span>
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {log?.checkIn?.at ? (
          <span className="hidden text-[11px] font-medium text-ink-muted tabular sm:inline">
            {formatClock(log.checkIn.at, log.timezone ?? timezone)}
          </span>
        ) : null}
        {log ? (
          <StatusPill size="sm" status={log.checkOut?.at ? log.status : 'incomplete'} />
        ) : (
          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
            No punch
          </span>
        )}
      </span>
    </Wrapper>
  );
}

