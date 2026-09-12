import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LuGlasses, LuArrowRight, LuArrowLeft } from 'react-icons/lu';

import PinPad from '../components/kiosk/PinPad';
import ThemeToggle from '../components/ui/ThemeToggle';
import LanguageToggle from '../components/ui/LanguageToggle';
import Spinner from '../components/ui/Spinner';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';
import { useBranches } from '../config/BranchesProvider';
import { unlockKiosk } from '../services/verification.service';
import { openKioskSession } from '../services/kioskSession';
import { ADMIN_SEQUENCE } from '../services/adminReveal';

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { branchId: branchParam } = useParams();
  const { setBranch } = useBranchTheme();

  const [selected, setSelected] = useState(branchParam ?? null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  /* A ref, not the state, guards re-entry: state is a render behind. */
  const busyRef = useRef(false);

  const { branches: BRANCH_LIST, get } = useBranches();
  const branch = useMemo(() => (selected ? get(selected) : null), [selected, get]);

  /* Theme follows the selection, and resets to neutral when backing out. */
  useEffect(() => {
    setBranch(branch?.theme ?? HOUSE_THEME);
  }, [branch, setBranch]);

  /**
   * Submit the moment the fourth digit lands.
   *
   * Called straight from the keypad's change handler rather than from an
   * effect watching `pin`. The effect version had `busy` in its dependency
   * list, so `setBusy(true)` re-ran it, and the re-run's cleanup cancelled the
   * request that was still in flight — the promise resolved into a dead
   * closure that neither navigated nor cleared the spinner, and the screen sat
   * on "Unlocking…" forever.
   *
   * It only showed up against a real backend. With an instant in-memory stub
   * the promise resolves in a microtask, before React has re-rendered and run
   * the cleanup, so the bug hid completely in the preview.
   *
   * An explicit call has no dependency array to get wrong.
   */
  const submit = useCallback(
    async (value) => {
      if (!branch || busyRef.current) return;

      busyRef.current = true;
      setBusy(true);
      setError(null);

      try {
        const result = await unlockKiosk(branch.id, value);

        if (result.ok) {
          openKioskSession(branch.id, { ttlMinutes: result.ttlMinutes });
          navigate(`/attendance/kiosk/${branch.id}`, { replace: true });
          return;
        }

        setPin('');
        setError(errorKeyFor(result.reason));
      } catch {
        setPin('');
        setError('errors.generic');
      } finally {
        /* Always runs, whatever happened. The spinner cannot outlive the
           request any more. */
        busyRef.current = false;
        setBusy(false);
      }
    },
    [branch, navigate],
  );

  const onPinChange = useCallback(
    (next) => {
      setError(null);
      setPin(next);
      /* The reserved admin sequence is never a PIN. SecretAdminDoor is already
         navigating away; submitting it as well would flash "that is not the
         PIN" on the way out, which is exactly what the reveal looked like
         before. It is refused at assignment, so this can never swallow a real
         person's PIN. */
      if (next === ADMIN_SEQUENCE) return;
      if (next.length === 4) submit(next);
    },
    [submit],
  );

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-surface bg-aurora px-4 py-10">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-brand-600 text-brand-on shadow-glow">
            <LuGlasses className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t('kiosk.brand')}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {branch ? t('kiosk.unlock', { branch: branch.shortName }) : t('kiosk.whichShop')}
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
                <Spinner size={28} label={t('kiosk.unlocking')} />
              </div>
            ) : (
              <>
                <PinPad value={pin} onChange={onPinChange} length={4} error={Boolean(error)} />
                {error ? (
                  <p className="mt-5 text-center text-sm font-semibold text-danger-ink" role="alert">
                    {t(error)}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => { setSelected(null); setPin(''); setError(null); }}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 text-xs font-semibold text-ink-subtle transition-colors hover:text-ink"
                >
                  <LuArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('kiosk.chooseAnother')}
                </button>
              </>
            )}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-ink-subtle">{t('kiosk.askSupervisor')}</p>
      </div>
    </div>
  );
}

/**
 * Turn a refusal into something the person in front of the tablet can act on.
 *
 * "Cannot reach the server" is useless when the real answer is "nobody has
 * deployed the function that checks PINs yet" — so that case says so, and says
 * what to do about it.
 *
 * Returns a translation key rather than a sentence: the message is held in
 * state, and a sentence frozen at failure time would stay in the old language
 * after the reader switches to the one they can read.
 */
function errorKeyFor(reason) {
  switch (reason) {
    case 'rate-limited':
      return 'errors.tooManyAttempts';
    case 'anonymous-disabled':
      return 'errors.anonymousDisabled';
    case 'not-deployed':
      return 'errors.notDeployed';
    case 'timeout':
      return 'errors.timeout';
    case 'unavailable':
      return 'errors.noServer';
    default:
      return 'errors.wrongBranchPin';
  }
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
