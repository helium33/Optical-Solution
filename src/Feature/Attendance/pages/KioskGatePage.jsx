import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LuGlasses, LuArrowRight, LuArrowLeft, LuUsers } from 'react-icons/lu';

import PinPad from '../components/kiosk/PinPad';
import BranchLogo from '../components/kiosk/BranchLogo';
import OvertimeToggle from '../components/kiosk/OvertimeToggle';
import BranchHierarchyDialog from '../components/kiosk/BranchHierarchyDialog';
import ThemeToggle from '../components/ui/ThemeToggle';
import LanguageToggle from '../components/ui/LanguageToggle';
import Spinner from '../components/ui/Spinner';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';
import { useBranches } from '../config/BranchesProvider';
import {
  prepareStaffPinCheck,
  matchStaffPin,
  loadStoredDirectory,
  ensureKioskIdentity,
} from '../services/verification.service';
import { openKioskSession } from '../services/kioskSession';
import { ADMIN_SEQUENCE } from '../services/adminReveal';
import { watchRoster, watchDayBoard } from '../services/liveBoard';
import {
  readFailedWrites,
  clearFailedWrites,
  WRITE_FAILED_EVENT,
} from '../services/writeQueue';
import { useFirebaseUser } from '../hooks/useFirebaseUser';
import { useNow } from '../hooks/useNow';
import { businessDayKey } from '../lib/time';
import { DEV_MODE } from '../config/devMode';

/**
 * Kiosk sign-in: pick the shop, then type your OWN PIN.
 *
 * There is no branch PIN. A person's four digits take them straight to their
 * own screen — see verification.service for why the shared shop code went.
 *
 * Two steps rather than one because picking the branch is what switches the
 * whole theme — the moment a staff member taps "Pwint" the screen becomes a
 * Pwint screen, and by the time they reach the keypad they already know the
 * tablet is set to the right shop. It also decides which geofence applies.
 */

/**
 * How old the PIN directory can be before the first keypress refreshes it.
 *
 * A refresh never makes anyone wait: the PIN is checked against what the
 * tablet already holds, and the fresh copy lands in the background. This only
 * decides how often that background fetch happens — a queue of people
 * clocking in at opening time shares one.
 */
const DIRECTORY_TTL_MS = 60_000;

/**
 * Which shop this tablet is in, remembered.
 *
 * A shop tablet does not move between shops. Asking which shop it is in after
 * every single punch cost a tap, and threw away the PIN data the keypad had
 * ready — the next person waited for it all to be fetched again.
 */
const REMEMBERED_SHOP = 'attendance:kioskShop';
const rememberShop = (id) => {
  try {
    if (id) localStorage.setItem(REMEMBERED_SHOP, id);
    else localStorage.removeItem(REMEMBERED_SHOP);
  } catch {
    /* Not remembered; the picker shows instead. */
  }
};
const rememberedShop = () => {
  try {
    return localStorage.getItem(REMEMBERED_SHOP);
  } catch {
    return null;
  }
};

/**
 * Wake the location radio, if permission is already granted.
 *
 * The punch needs a GPS fix, and a cold GPS indoors can take many seconds.
 * Asking for one at the first keypress means it is usually ready by the time
 * the person reaches the Clock in button; the punch screen then gets it from
 * the browser's cache instead of starting from cold. Never asked when the
 * permission is undecided — a permission prompt in the middle of typing a PIN
 * would be worse than the wait it saves.
 */
function warmUpLocation() {
  if (DEV_MODE || !navigator.geolocation || !navigator.permissions?.query) return;
  navigator.permissions
    .query({ name: 'geolocation' })
    .then((status) => {
      if (status.state !== 'granted') return;
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
      );
    })
    .catch(() => {});
}
export default function KioskGatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { branchId: branchParam } = useParams();
  const { setBranch } = useBranchTheme();

  const { branches: BRANCH_LIST, get } = useBranches();
  const [selected, setSelected] = useState(() => {
    if (branchParam) return branchParam;
    const remembered = rememberedShop();
    return BRANCH_LIST.some((entry) => entry.id === remembered) ? remembered : null;
  });
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [hierarchyOpen, setHierarchyOpen] = useState(false);
  const [overtime, setOvertime] = useState(false);
  /* A ref, not the state, guards re-entry: state is a render behind. */
  const busyRef = useRef(false);
  /* Punches the server refused after the person had already left — see
     writeQueue. Shown here because this is the screen everyone returns to. */
  const [failedWrites, setFailedWrites] = useState(readFailedWrites);
  useEffect(() => {
    const update = () => setFailedWrites(readFailedWrites());
    window.addEventListener(WRITE_FAILED_EVENT, update);
    return () => window.removeEventListener(WRITE_FAILED_EVENT, update);
  }, []);
  /** The best PIN directory this tablet has for the chosen shop, any age. */
  const directoryRef = useRef(null);
  /** { branchId, promise } of a refresh in flight, so callers share it. */
  const refreshRef = useRef(null);
  /** The shop on screen right now, for refreshes that land after a change. */
  const shopRef = useRef(null);

  const branch = useMemo(() => (selected ? get(selected) : null), [selected, get]);
  shopRef.current = branch?.id ?? null;

  /* Theme follows the selection, and resets to neutral when backing out. */
  useEffect(() => {
    setBranch(branch?.theme ?? HOUSE_THEME);
  }, [branch, setBranch]);

  /**
   * Fetch a fresh PIN directory in the background; share one if in flight.
   *
   * Nobody waits on this unless the tablet has never had a directory for this
   * shop, or a PIN missed — see submit. Everything else just uses what the
   * tablet already holds and lets this land when it lands.
   */
  const refresh = useCallback(() => {
    if (!branch) return Promise.resolve(null);
    const inFlight = refreshRef.current;
    if (inFlight && inFlight.branchId === branch.id) return inFlight.promise;

    const branchId = branch.id;
    const entry = { branchId, promise: null };
    entry.promise = prepareStaffPinCheck(branchId)
      .then((result) => {
        /* Kept only if the keypad is still on the shop it was fetched for. */
        if (result.ok && shopRef.current === branchId) directoryRef.current = result;
        return result;
      })
      .catch(() => ({ ok: false, reason: 'unavailable' }))
      .finally(() => {
        if (refreshRef.current === entry) refreshRef.current = null;
      });
    refreshRef.current = entry;
    return entry.promise;
  }, [branch]);

  /* A brand-new tablet's one sign-in starts while the shop is being chosen. */
  useEffect(() => {
    ensureKioskIdentity();
  }, []);

  /* The moment a shop is chosen: what the tablet already holds, at once, and
     a fresh copy behind it. */
  useEffect(() => {
    if (!branch) {
      directoryRef.current = null;
      return;
    }
    directoryRef.current = loadStoredDirectory(branch.id);
    refresh();
  }, [branch, refresh]);

  /* Keep the staff screen's data live from here, so it opens with it. */
  const { uid } = useFirebaseUser();
  const minuteTick = useNow(60_000);
  const todayKey = branch ? businessDayKey(minuteTick, branch.timezone) : null;
  useEffect(() => {
    if (!branch || !uid || !todayKey) return undefined;
    const ignore = () => {};
    const stopRoster = watchRoster(branch.id, ignore, ignore);
    const stopBoard = watchDayBoard(branch.id, todayKey, ignore, ignore);
    return () => {
      stopRoster();
      stopBoard();
    };
  }, [branch, uid, todayKey]);

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
        /* What the tablet already holds, whatever its age. Only a tablet
           that has never fetched this shop's directory waits for one. */
        const held = directoryRef.current?.branchId === branch.id ? directoryRef.current : null;
        const directory = held ?? (await refresh());
        let result = directory?.ok ? await matchStaffPin(directory, value) : directory;

        /* A miss gets one fresh look before it is called wrong. The likeliest
           reason a right PIN misses is that an admin set or changed it after
           the copy this tablet holds — and telling someone their brand-new
           PIN is wrong is the worst first experience of it. Only a miss pays
           for the round trip; a match never waits. */
        if (!result?.ok && result?.reason === 'wrong-pin' && Date.now() - directory.at > 3_000) {
          const fresh = await refresh();
          if (fresh?.ok) result = await matchStaffPin(fresh, value);
        }

        if (result?.ok) {
          openKioskSession(branch.id, { ttlMinutes: 840 });
          navigate(`/attendance/kiosk/${branch.id}`, {
            replace: true,
            /* The person, not just their id: the staff screen opens with
               them on its first render instead of fetching the roster again
               to find out who that id is. */
            state: { staffId: result.staff.id, staff: result.staff, pin: value, overtime },
          });
          return;
        }

        setPin('');
        setError(errorKeyFor(result?.reason));
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
    [branch, navigate, overtime, refresh],
  );

  const onPinChange = useCallback(
    (next) => {
      setError(null);
      setPin(next);
      /* First digit: refresh in the background if what we hold is getting
         old, and wake the GPS for the punch that is about to follow. */
      if (next.length === 1) {
        const held = directoryRef.current;
        if (!held || Date.now() - held.at > DIRECTORY_TTL_MS) refresh();
        warmUpLocation();
      }
      /* The reserved admin sequence is never a PIN. SecretAdminDoor is already
         navigating away; submitting it as well would flash "that is not the
         PIN" on the way out, which is exactly what the reveal looked like
         before. It is refused at assignment, so this can never swallow a real
         person's PIN. */
      if (next === ADMIN_SEQUENCE) return;
      if (next.length === 4) submit(next);
    },
    [submit, refresh],
  );

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-surface bg-aurora px-4 py-10">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          {/* Once a shop is chosen its own mark replaces the house glasses, so
              the keypad is visibly that shop's and not a generic one. */}
          {branch ? (
            <BranchLogo branch={branch} size={56} className="mx-auto mb-4 shadow-glow" />
          ) : (
            <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-3xl bg-brand-600 text-brand-on shadow-glow">
              <LuGlasses className="h-6 w-6" aria-hidden="true" />
            </span>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-ink">{t('kiosk.brand')}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {branch ? t('kiosk.enterOwnPin', { branch: branch.shortName }) : t('kiosk.whichShop')}
          </p>
        </div>

        {failedWrites.length ? (
          <div className="mb-6 rounded-3xl bg-danger-soft p-4" role="alert">
            <p className="text-sm font-bold text-danger-ink">{t('kiosk.failedWritesTitle')}</p>
            <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-danger-ink/85">
              {failedWrites.map((entry) => (
                <li key={entry.at + entry.what}>
                  {t('kiosk.failedWritesItem', {
                    what: entry.what,
                    time: new Date(entry.at).toLocaleTimeString(),
                    code: entry.code,
                  })}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                clearFailedWrites();
                setFailedWrites([]);
              }}
              className="mt-2 text-xs font-bold text-danger-ink underline underline-offset-2"
            >
              {t('kiosk.failedWritesDismiss')}
            </button>
          </div>
        ) : null}

        {!branch ? (
          <div className="space-y-3">
            {BRANCH_LIST.map((entry, index) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setSelected(entry.id);
                  rememberShop(entry.id);
                }}
                style={{ animationDelay: `${index * 70}ms` }}
                className="group flex w-full animate-fade-up items-center gap-4 rounded-3xl border border-line bg-surface-card p-5 text-left shadow-soft transition-all duration-300 ease-expo hover:-translate-y-0.5 hover:shadow-lift tap-none"
              >
                <BranchLogo branch={entry} size={52} />
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
                <Spinner size={28} label={t('kiosk.checkingPin')} />
              </div>
            ) : (
              <>
                {/* ---- OVERTIME: above the keypad, decided before the PIN ----
                    Nobody has said who they are yet, so there is no shift to
                    measure — the switch records the intent and the figure is
                    worked out once the PIN names the person. */}
                <div className="mb-5">
                  <OvertimeToggle
                    checked={overtime}
                    onChange={setOvertime}
                    unknownEligibility
                  />
                </div>

                <PinPad value={pin} onChange={onPinChange} length={4} error={Boolean(error)} />
                {error ? (
                  <div className="mt-5 text-center">
                    <p className="text-sm font-semibold text-danger-ink" role="alert">
                      {t(error)}
                    </p>
                    {/* Both mean the server side of the PIN check could not be
                        reached at all — a genuinely wrong PIN never lands
                        here, so a diagnostics link is never shown for one. */}
                    {error === 'errors.noServer' || error === 'errors.notDeployed' ? (
                      <Link
                        to="/attendance/diagnostics"
                        className="mt-1.5 inline-block text-xs font-bold text-brand-ink hover:underline"
                      >
                        {t('kiosk.runDiagnostics')}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
                {/* Above "choose a different shop", because it answers the
                    question someone actually has at a locked keypad — "is this
                    my branch, and who is on it?" — without being a way back
                    out of the screen. */}
                <button
                  type="button"
                  onClick={() => setHierarchyOpen(true)}
                  className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface-card/70 px-4 py-3 text-sm font-bold text-ink shadow-soft transition-all duration-300 ease-expo hover:-translate-y-0.5 hover:shadow-lift tap-none"
                >
                  <LuUsers className="h-4 w-4 text-brand-ink" aria-hidden="true" />
                  {t('kiosk.viewBranch')}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    rememberShop(null);
                    setPin('');
                    setError(null);
                  }}
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 text-xs font-semibold text-ink-subtle transition-colors hover:text-ink"
                >
                  <LuArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('kiosk.chooseAnother')}
                </button>
              </>
            )}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-ink-subtle">{t('kiosk.askAdminForPin')}</p>
      </div>

      <BranchHierarchyDialog
        open={hierarchyOpen}
        onClose={() => setHierarchyOpen(false)}
        branch={branch}
      />
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
    case 'sign-in-failed':
      return 'errors.noServer';
    case 'rules-not-published':
      return 'errors.rulesNotPublished';
    case 'domain-not-authorised':
      return 'errors.domainNotAuthorised';
    case 'bad-api-key':
      return 'errors.badApiKey';
    case 'pin-ambiguous':
      return 'errors.pinAmbiguous';
    default:
      return 'errors.wrongPin';
  }
}

