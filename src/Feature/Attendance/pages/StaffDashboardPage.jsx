import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LuArrowLeft, LuCalendarCheck, LuClock, LuTimer, LuLogOut, LuChevronDown,
} from 'react-icons/lu';

import Avatar from '../components/ui/Avatar';
import Spinner from '../components/ui/Spinner';
import StatusPill from '../components/ui/StatusPill';
import ThemeToggle from '../components/ui/ThemeToggle';
import Segmented from '../components/ui/Segmented';
import PinPad from '../components/kiosk/PinPad';

import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';
import { getBranch } from '../config/branches';
import { roleLabel } from '../config/roles';
import { subscribeBranchStaff } from '../services/staff.service';
import { verifyStaffPin, fetchStaffSummary } from '../services/staffSummary.service';
import { readKioskSession } from '../services/kioskSession';
import { resolveRange, RANGE_PRESETS } from '../hooks/useAttendanceReport';
import { formatDayLabel, formatClock, formatDuration } from '../lib/time';

/**
 * A staff member's own record, opened with their personal PIN.
 *
 * Three numbers, because those are the three people actually ask about: how
 * many days was I here, how many minutes was I late, and how many hours of
 * overtime am I owed. Everything else is detail behind them.
 *
 * Deliberately shows only the signed-in person. A shop-floor tablet is a shared
 * screen — someone reading their own hours should not have a colleague's
 * lateness sitting next to it.
 */

const STEP = { WHO: 'who', PIN: 'pin', SUMMARY: 'summary' };

export default function StaffDashboardPage() {
  const navigate = useNavigate();
  const { setBranch } = useBranchTheme();

  const session = useMemo(() => readKioskSession(), []);
  const branch = useMemo(() => (session ? getBranch(session.branchId) : null), [session]);

  const [staff, setStaff] = useState(null);
  const [selected, setSelected] = useState(null);
  const [step, setStep] = useState(STEP.WHO);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const [range, setRange] = useState('mtd');
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!session || session.expired) navigate('/attendance/kiosk', { replace: true });
  }, [session, navigate]);

  useEffect(() => setBranch(branch?.theme ?? HOUSE_THEME), [branch, setBranch]);

  useEffect(() => {
    if (!branch) return undefined;
    return subscribeBranchStaff(branch.id, setStaff, () => setStaff([]));
  }, [branch]);

  const window = useMemo(
    () => resolveRange(range, { timeZone: branch?.timezone ?? 'Asia/Yangon' }),
    [range, branch],
  );

  /* Load the figures once identity is established, and again on range change. */
  useEffect(() => {
    if (step !== STEP.SUMMARY || !selected || !branch) return undefined;
    let cancelled = false;
    setSummary(null);

    fetchStaffSummary({
      branchId: branch.id,
      staffId: selected.id,
      fromKey: window.fromKey,
      toKey: window.toKey,
    })
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        if (!cancelled) setSummary({ error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [step, selected, branch, window.fromKey, window.toKey]);

  /* Called straight from the keypad, not from an effect watching `pin` — see
     the note in KioskGatePage for why that shape strands the spinner. */
  const submitPin = useCallback(
    async (value) => {
      if (!branch || !selected || busyRef.current) return;

      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await verifyStaffPin({
          branchId: branch.id,
          staffId: selected.id,
          pin: value,
        });

        if (result.ok) {
          setStep(STEP.SUMMARY);
          setPin('');
          return;
        }
        setPin('');
        setError(
          result.reason === 'rate-limited'
            ? 'Too many tries. Wait a minute.'
            : result.reason === 'unavailable'
              ? 'Cannot reach the server.'
              : 'That PIN was not recognised.',
        );
      } catch (unexpected) {
        setPin('');
        setError(unexpected?.message ?? 'Something went wrong. Try again.');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [branch, selected],
  );

  const onPinChange = useCallback(
    (next) => {
      setError(null);
      setPin(next);
      if (next.length === 4) submitPin(next);
    },
    [submitPin],
  );

  const signOut = () => {
    setSelected(null);
    setSummary(null);
    setPin('');
    setStep(STEP.WHO);
  };

  if (!branch) return <Spinner className="min-h-dvh" size={28} label="Loading" />;

  return (
    <div className="min-h-dvh bg-surface bg-aurora">
      <header className="sticky top-0 z-30 glass glass-sheen border-x-0 border-t-0">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(`/attendance/kiosk/${branch.id}`)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface-card text-ink-subtle transition-colors hover:text-ink"
            aria-label="Back to the kiosk"
          >
            <LuArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight tracking-tight text-ink">
              My records
            </p>
            <p className="truncate text-xs text-ink-subtle">{branch.name}</p>
          </div>
          <ThemeToggle />
          {step === STEP.SUMMARY ? (
            <button
              type="button"
              onClick={signOut}
              aria-label="Close my records"
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface-card text-ink-subtle transition-colors hover:text-danger-ink"
            >
              <LuLogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-6">
        {step === STEP.WHO ? (
          <>
            <h2 className="mb-3 px-1 text-sm font-bold tracking-tight text-ink">
              Who are you?
            </h2>
            {staff === null ? (
              <div className="py-16"><Spinner size={26} label="Loading the roster…" /></div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {staff.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => { setSelected(person); setStep(STEP.PIN); }}
                      className="flex w-full items-center gap-4 rounded-3xl border border-line bg-surface-card p-4 text-left shadow-soft transition-all duration-300 ease-expo hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-lift tap-none"
                    >
                      <Avatar name={person.name} seed={person.id} size={46} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-ink">{person.name}</span>
                        <span className="block truncate text-xs text-ink-subtle">
                          {roleLabel(person.role)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}

        {step === STEP.PIN ? (
          <div className="mx-auto max-w-sm">
            <div className="mb-6 flex flex-col items-center text-center">
              <Avatar name={selected.name} seed={selected.id} size={64} />
              <p className="mt-3 text-lg font-bold tracking-tight text-ink">{selected.name}</p>
              <p className="text-xs text-ink-subtle">Enter your PIN to see your own records</p>
            </div>

            <div className="glass glass-sheen rounded-4xl p-6 shadow-float">
              {busy ? (
                <div className="py-16"><Spinner size={26} label="Checking…" /></div>
              ) : (
                <PinPad value={pin} onChange={onPinChange} length={4} error={Boolean(error)} />
              )}
            </div>

            {error ? (
              <p className="mt-4 text-center text-sm font-semibold text-danger-ink" role="alert">{error}</p>
            ) : null}

            <button
              type="button"
              onClick={signOut}
              className="mt-6 w-full text-center text-xs font-semibold text-ink-subtle hover:text-ink"
            >
              That is not me
            </button>
          </div>
        ) : null}

        {step === STEP.SUMMARY && selected ? (
          <PersonalSummary
            person={selected}
            branch={branch}
            summary={summary}
            range={range}
            onRangeChange={setRange}
            rangeLabel={window.label}
          />
        ) : null}
      </main>
    </div>
  );
}

/* ─────────────────────────── the three figures ────────────────────────── */

function PersonalSummary({ person, branch, summary, range, onRangeChange, rangeLabel }) {
  const [showDays, setShowDays] = useState(false);

  return (
    <div className="animate-fade-up">
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={person.name} seed={person.id} size={56} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold tracking-tight text-ink">{person.name}</p>
          <p className="truncate text-xs text-ink-subtle">
            {roleLabel(person.role)} · {branch.shortName}
          </p>
        </div>
        <Segmented
          size="sm"
          label="Period"
          options={RANGE_PRESETS}
          value={range}
          onChange={onRangeChange}
        />
      </div>

      {!summary ? (
        <div className="py-16"><Spinner size={26} label="Working out your hours…" /></div>
      ) : summary.error ? (
        <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger-ink">
          Could not load your records. Try again in a moment.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Figure
              icon={LuCalendarCheck}
              label="Days present"
              value={summary.presentDays}
              caption={rangeLabel}
              tone="brand"
            />
            <Figure
              icon={LuClock}
              label="Late"
              value={summary.lateMinutes}
              unit="min"
              caption={
                summary.lateDays
                  ? `across ${summary.lateDays} ${summary.lateDays === 1 ? 'day' : 'days'}`
                  : 'never late — nice'
              }
              tone={summary.lateMinutes ? 'warn' : 'ok'}
            />
            <Figure
              icon={LuTimer}
              label="Overtime"
              value={summary.overtimeHours}
              unit={summary.overtimeHours === 1 ? 'hour' : 'hours'}
              caption={
                summary.overtimeMinutes
                  ? `${formatDuration(summary.overtimeMinutes)} worked, paid in whole hours`
                  : 'no overtime claimed'
              }
              tone={summary.overtimeHours ? 'ot' : 'default'}
            />
          </div>

          {summary.rows?.length ? (
            <section className="mt-6">
              <button
                type="button"
                onClick={() => setShowDays((value) => !value)}
                aria-expanded={showDays}
                className="flex w-full items-center justify-between rounded-3xl border border-line bg-surface-card px-5 py-4 text-left shadow-soft"
              >
                <span className="text-sm font-bold tracking-tight text-ink">
                  Day by day ({summary.rows.length})
                </span>
                <LuChevronDown
                  className={`h-4 w-4 text-ink-subtle transition-transform duration-300 ${showDays ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              {showDays ? (
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface-card">
                  {summary.rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                      <span className="w-28 shrink-0 text-sm font-semibold text-ink">
                        {formatDayLabel(row.dayKey)}
                      </span>
                      <span className="text-xs text-ink-muted tabular">
                        {row.checkIn?.at ? formatClock(row.checkIn.at, row.timezone) : '—'}
                        {' → '}
                        {row.checkOut?.at ? formatClock(row.checkOut.at, row.timezone) : '—'}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        {(row.minutes?.overtime ?? 0) > 0 ? (
                          <StatusPill
                            size="sm"
                            status="overtime"
                            label={`+${row.minutes.overtimeHours ?? Math.ceil(row.minutes.overtime / 60)}h`}
                          />
                        ) : null}
                        <StatusPill size="sm" status={row.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {summary.unverified ? (
            <p className="mt-6 rounded-2xl bg-warn-soft px-4 py-3 text-xs leading-relaxed text-warn-ink">
              Development mode: these figures were read without verifying your PIN on the server.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

const TONES = {
  brand: 'text-brand-ink',
  ok: 'text-ok-ink',
  warn: 'text-warn-ink',
  ot: 'text-ot-ink',
  default: 'text-ink',
};

function Figure({ icon: Icon, label, value, unit, caption, tone = 'default' }) {
  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        <Icon className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
      </div>
      <p className={`mt-3 text-4xl font-bold leading-none tracking-tight ${TONES[tone]}`}>
        {value}
        {unit ? <span className="ml-1.5 text-base font-semibold text-ink-subtle">{unit}</span> : null}
      </p>
      <p className="mt-2 text-xs text-ink-muted">{caption}</p>
    </div>
  );
}
