import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { LuGlasses, LuArrowRight, LuArrowLeft } from 'react-icons/lu';

import PinPad from '../components/kiosk/PinPad';
import ThemeToggle from '../components/ui/ThemeToggle';
import Spinner from '../components/ui/Spinner';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';
import { BRANCH_LIST, getBranch } from '../config/branches';
import { unlockKiosk } from '../services/verification.service';
import { openKioskSession } from '../services/kioskSession';

/**
 * Kiosk unlock: pick the shop, then enter the branch PIN.
 *
 * Two steps rather than one because picking the branch is what switches the
 * whole theme — the moment a staff member taps "Pwint" the screen becomes a
 * Pwint screen, and by the time they reach the keypad they already know the
 * tablet is set to the right shop. That is a lot more reassuring than a
 * correctly-themed screen appearing after a correct PIN.
 */
export default function KioskGatePage() {
  const navigate = useNavigate();
  const { branchId: branchParam } = useParams();
  const { setBranch } = useBranchTheme();

  const [selected, setSelected] = useState(branchParam ?? null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const branch = useMemo(() => (selected ? getBranch(selected) : null), [selected]);

  /* Theme follows the selection, and resets to neutral when backing out. */
  useEffect(() => {
    setBranch(branch?.theme ?? HOUSE_THEME);
  }, [branch, setBranch]);

  useEffect(() => {
    if (!branch || pin.length !== 4 || busy) return;

    let cancelled = false;
    setBusy(true);
    setError(null);

    unlockKiosk(branch.id, pin)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          openKioskSession(branch.id, { ttlMinutes: result.ttlMinutes });
          navigate(`/attendance/kiosk/${branch.id}`, { replace: true });
          return;
        }
        setPin('');
        setError(
          result.reason === 'rate-limited'
            ? 'Too many attempts. Wait a minute before trying again.'
            : result.reason === 'unavailable'
              ? 'Cannot reach the server. Check the connection.'
              : 'That is not the PIN for this branch.',
        );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pin, branch, busy, navigate]);

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-surface bg-aurora px-4 py-10">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-brand-600 text-brand-on shadow-glow">
            <LuGlasses className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Optical Solution</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {branch ? `Unlock the ${branch.shortName} kiosk` : 'Which shop is this tablet in?'}
          </p>
        </div>

        {!branch ? (
          <div className="space-y-3">
            {BRANCH_LIST.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelected(entry.id)}
                style={{ animationDelay: `${index * 70}ms` }}
                className="group flex w-full animate-fade-up items-center gap-4 rounded-3xl border border-line bg-surface-card p-5 text-left shadow-soft transition-all duration-300 ease-expo hover:-translate-y-0.5 hover:shadow-lift tap-none"
              >
                <BranchSwatch theme={entry.theme} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold tracking-tight text-ink">{entry.name}</span>
                  <span className="block text-xs text-ink-subtle">
                    {entry.city} · {entry.shift.start}–{entry.shift.end}
                  </span>
                </span>
                <LuArrowRight
                  className="h-5 w-5 text-ink-subtle transition-transform duration-300 group-hover:translate-x-1"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="animate-fade-up glass glass-sheen rounded-4xl p-6 shadow-float sm:p-8">
            {busy ? (
              <div className="py-16">
                <Spinner size={28} label="Unlocking…" />
              </div>
            ) : (
              <>
                <PinPad value={pin} onChange={(next) => { setError(null); setPin(next); }} length={4} error={Boolean(error)} />
                {error ? (
                  <p className="mt-5 text-center text-sm font-semibold text-danger-ink" role="alert">
                    {error}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => { setSelected(null); setPin(''); setError(null); }}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 text-xs font-semibold text-ink-subtle transition-colors hover:text-ink"
                >
                  <LuArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Choose a different shop
                </button>
              </>
            )}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-ink-subtle">
          Staff do not need an account. Ask a supervisor for the branch PIN.
        </p>
      </div>
    </div>
  );
}

/** A miniature of each branch's palette, so the choice is visual. */
function BranchSwatch({ theme }) {
  return (
    <span
      data-branch={theme}
      className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-600 shadow-soft"
    >
      <span className="h-4 w-4 rounded-full bg-accent-500 ring-2 ring-brand-on/30" />
    </span>
  );
}
