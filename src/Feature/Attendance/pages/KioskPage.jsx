import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LuUsers, LuTimer, LuCircleCheck, LuTriangleAlert } from 'react-icons/lu';

import KioskShell from '../components/kiosk/KioskShell';
import StaffCard from '../components/kiosk/StaffCard';
import PunchDialog from '../components/kiosk/PunchDialog';
import StaffSignInDialog from '../components/kiosk/StaffSignInDialog';
import StaffDashboard from '../components/kiosk/StaffDashboard';
import Spinner from '../components/ui/Spinner';
import { useBranchTheme, HOUSE_THEME } from '../theme/BranchThemeProvider';
import { useGeoFence } from '../hooks/useGeoFence';
import { useNow } from '../hooks/useNow';
import { useBranch } from '../config/BranchesProvider';
import { useFirebaseUser } from '../hooks/useFirebaseUser';
import { subscribeBranchStaff } from '../services/staff.service';
import { STAFF_ROLE_ORDER, roleLabel } from '../config/roles';
import { subscribeDayBoard } from '../services/attendance.service';
import { readKioskSession, closeKioskSession, touchKioskSession } from '../services/kioskSession';
import { lockKiosk } from '../services/verification.service';
import { businessDayKey, minutesBetween, ATTENDANCE_STATUS } from '../lib/time';

/**
 * The shop-floor screen. One tablet, the whole roster, tap your name.
 *
 * Everything on this page is live: the roster, today's punches and the location
 * fix all stream, so two people clocking in on two devices see each other's
 * state immediately and nobody double-punches.
 */
export default function KioskPage() {
  const { t } = useTranslation();
  const { branchId } = useParams();
  const navigate = useNavigate();
  const { setBranch } = useBranchTheme();

  /* Live config: an owner changing the shift end must reach this tablet
     without a redeploy. */
  const branch = useBranch(branchId);
  /* Every read below requires an identity. Holding the subscriptions until
     Firebase has restored one is what stops a reload from burning them on an
     unauthenticated request that rules refuse permanently. */
  const { ready: authReady, uid } = useFirebaseUser();
  const now = useNow(30_000);
  const dayKey = useMemo(
    () => (branch ? businessDayKey(now, branch.timezone) : null),
    [branch, now],
  );

  const [staff, setStaff] = useState(null);
  const [logs, setLogs] = useState([]);
  const [selected, setSelected] = useState(null);
  /* Tapping a name now asks for that person's PIN first; `session` is who
     proved it, and the PIN they proved. It is state, never storage: the whole
     point is that it does not survive walking away from the tablet. */
  const [signingIn, setSigningIn] = useState(null);
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  /* Firestore's own sentence for the failure, kept alongside the translated
     one. For a missing index that sentence carries the console URL that
     creates it, which is the entire fix — paraphrasing it away leaves the
     reader with a problem and no link. */
  const [loadErrorDetail, setLoadErrorDetail] = useState(null);

  const geo = useGeoFence(branch, { enabled: Boolean(branch) });

  /* ---- kiosk session guard ---- */
  useEffect(() => {
    const session = readKioskSession();
    if (!session || session.expired || session.branchId !== branchId) {
      navigate('/attendance/kiosk', { replace: true });
    }
  }, [branchId, navigate, now]);

  /* Any interaction pushes back the idle lock. */
  useEffect(() => {
    const touch = () => touchKioskSession();
    window.addEventListener('pointerdown', touch);
    return () => window.removeEventListener('pointerdown', touch);
  }, []);

  useEffect(() => {
    setBranch(branch?.theme ?? HOUSE_THEME);
  }, [branch, setBranch]);

  /* ---- live data ---- */
  useEffect(() => {
    if (!branchId) return undefined;
    if (!authReady) return undefined;
    if (!uid) {
      /* Auth has settled and there is nobody. The stored kiosk session has
         outlived the Firebase one, so the fix is to unlock again — not to go
         looking at security rules, which is where the old message sent them. */
      setStaff([]);
      setLoadError('errors.kioskSessionExpired');
      setLoadErrorDetail(null);
      return undefined;
    }
    return subscribeBranchStaff(branchId, setStaff, (error) => {
      setStaff([]);
      /* A key, not the sentence, so it re-renders in whichever language the
         reader picks next. "Missing or insufficient permissions" is Firebase's
         own wording and says nothing about the cause: the tablet IS signed in,
         the rules simply were never deployed for these collections.

         The roster query filters on branchId and active and orders by name,
         which Firestore cannot serve without the composite index declared in
         firestore.indexes.json. Until that is deployed it answers
         `failed-precondition`, and treating anything-but-permission-denied as
         "no error" rendered a real, fixable failure as the benign "nobody has
         been added yet" hint — advice for a problem the reader does not have. */
      setLoadError(
        error?.code === 'permission-denied'
          ? 'errors.rulesNotDeployed'
          : error?.code === 'failed-precondition'
            ? 'errors.indexMissing'
            : null,
      );
      setLoadErrorDetail(error?.code ? `${error.code}: ${error.message ?? ''}` : null);
    });
    /* `uid` is a dependency rather than a guard alone: when the session lands a
       moment after mount this effect re-runs and subscribes again, which is the
       whole recovery. */
  }, [branchId, authReady, uid]);

  useEffect(() => {
    if (!branchId || !dayKey || !uid) return undefined;
    return subscribeDayBoard(branchId, dayKey, setLogs, () => setLogs([]));
  }, [branchId, dayKey, uid]);

  const logsById = useMemo(() => {
    const map = new Map();
    for (const log of logs) map.set(log.staffId, log);
    return map;
  }, [logs]);

  /* Highest rank first, same order the admin Team view uses. `staff` is
     already role-then-name sorted, so this only partitions it into visible
     groups rather than re-sorting. */
  const roleTiers = useMemo(() => {
    const roster = staff ?? [];
    return [...STAFF_ROLE_ORDER]
      .reverse()
      .map((role) => ({ role, people: roster.filter((person) => person.role === role) }))
      .filter((tier) => tier.people.length > 0);
  }, [staff]);

  const summary = useMemo(() => {
    const roster = staff ?? [];
    let onShift = 0;
    let finished = 0;
    let late = 0;
    let overtimeMinutes = 0;

    for (const person of roster) {
      const log = logsById.get(person.id);
      if (!log?.checkIn?.at) continue;
      if (log.checkOut?.at) {
        finished += 1;
        overtimeMinutes += log.minutes?.overtime ?? 0;
      } else {
        onShift += 1;
      }
      if (log.status === ATTENDANCE_STATUS.LATE) late += 1;
    }

    return {
      headcount: roster.length,
      onShift,
      finished,
      late,
      notIn: roster.length - onShift - finished,
      overtimeMinutes,
    };
  }, [staff, logsById]);

  const lock = useCallback(async () => {
    closeKioskSession();
    /* Also drop the branch-scoped Firebase token, or the tablet keeps its
       Firestore read access after the screen says it is locked. */
    await lockKiosk();
    navigate('/attendance/kiosk', { replace: true });
  }, [navigate]);

  if (!branch) {
    return (
      <div className="grid min-h-dvh place-items-center bg-surface px-6 text-center">
        <div>
          <p className="text-lg font-bold text-ink">{t('kiosk.unknownBranch')}</p>
          <button
            type="button"
            onClick={() => navigate('/attendance/kiosk')}
            className="mt-4 rounded-2xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-brand-on"
          >
            {t('kiosk.chooseAnother')}
          </button>
        </div>
      </div>
    );
  }

  const selectedLog = selected ? logsById.get(selected.id) ?? null : null;

  return (
    <KioskShell branch={branch} geo={geo} onLock={lock}>
      {/* ---- at-a-glance strip ---- */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile icon={LuUsers} label={t('kiosk.onRoster')} value={summary.headcount} />
        <Tile icon={LuCircleCheck} label={t('kiosk.onShiftNow')} value={summary.onShift} tone="ok" />
        <Tile icon={LuTriangleAlert} label={t('kiosk.lateToday')} value={summary.late} tone={summary.late ? 'warn' : null} />
        <Tile
          icon={LuTimer}
          label={t('kiosk.overtimeToday')}
          value={summary.overtimeMinutes ? `${Math.round((summary.overtimeMinutes / 60) * 10) / 10}h` : '0h'}
          tone={summary.overtimeMinutes ? 'ot' : null}
        />
      </section>

      <h2 className="mb-3 px-1 text-sm font-bold tracking-tight text-ink">
        {summary.onShift ? t('kiosk.tapYourName') : t('kiosk.tapYourNameIn')}
      </h2>

      {staff === null ? (
        <div className="py-20">
          <Spinner size={26} label={t('kiosk.loadingRoster')} />
        </div>
      ) : staff.length === 0 ? (
        <div className="card card-pad text-center">
          <p className="text-sm font-semibold text-ink">{t('kiosk.noStaff')}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {t(loadError ?? 'kiosk.noStaffHint')}
          </p>
          {loadError && loadErrorDetail ? (
            <p className="mx-auto mt-2 max-w-prose break-words text-[11px] leading-relaxed text-ink-subtle">
              {loadErrorDetail}
            </p>
          ) : null}
          {loadError ? (
            <Link
              to="/attendance/diagnostics"
              className="mt-3 inline-block text-xs font-bold text-brand-ink hover:underline"
            >
              {t('kiosk.runDiagnostics')}
            </Link>
          ) : null}
        </div>
      ) : (
        /* Grouped by seniority the moment the roster loads, highest rank
           first — the same tiers and order the admin Team view uses, so a
           person's place in the hierarchy reads the same everywhere. `staff`
           already arrives sorted role-then-name; this only adds the visible
           section headers on top of an order that was already there. */
        <div className="space-y-6">
          {roleTiers.map(({ role, people }) => (
            <section key={role}>
              <p className="mb-2.5 flex items-center gap-2 px-1">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
                  {roleLabel(role, t)}
                </span>
                <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10px] font-bold text-ink-subtle tabular">
                  {people.length}
                </span>
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {people.map((person, index) => {
                  const log = logsById.get(person.id) ?? null;
                  const elapsed =
                    log?.checkIn?.at && !log?.checkOut?.at
                      ? minutesBetween(log.checkIn.at, now)
                      : null;
                  return (
                    <div
                      key={person.id}
                      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                      className="animate-fade-up"
                    >
                      <StaffCard
                        staff={person}
                        log={log}
                        timezone={branch.timezone}
                        elapsedMinutes={elapsed}
                        onSelect={setSigningIn}
                        disabled={geo.pending}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <StaffSignInDialog
        open={Boolean(signingIn)}
        onClose={() => setSigningIn(null)}
        staff={signingIn}
        log={signingIn ? (logsById.get(signingIn.id) ?? null) : null}
        branch={branch}
        onVerified={(pin, overtime) => {
          setSession({ staff: signingIn, pin, overtime });
          setSigningIn(null);
        }}
      />

      {session ? (
        <StaffDashboard
          staff={session.staff}
          branch={branch}
          log={logsById.get(session.staff.id) ?? null}
          onPunch={() => setSelected(session.staff)}
          onClose={() => {
            setSession(null);
            setSelected(null);
          }}
        />
      ) : null}

      <PunchDialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        staff={selected}
        log={selectedLog}
        branch={branch}
        geo={geo}
        preVerifiedPin={session && selected && session.staff.id === selected.id ? session.pin : null}
        initialOvertime={Boolean(session && selected && session.staff.id === selected.id && session.overtime)}
        /* Straight back to the shared roster once the punch lands: a personal
           screen left open on the counter is somebody's hours facing the shop. */
        onSubmitted={() => setSession(null)}
      />
    </KioskShell>
  );
}

const TONES = {
  ok: 'text-ok-ink bg-ok-soft',
  warn: 'text-warn-ink bg-warn-soft',
  ot: 'text-ot-ink bg-ot-soft',
};

function Tile({ icon: Icon, label, value, tone }) {
  return (
    <div className="glass glass-sheen rounded-3xl p-4 shadow-soft">
      <span
        className={`mb-3 grid h-9 w-9 place-items-center rounded-xl ${TONES[tone] ?? 'bg-surface-sunken text-ink-subtle'}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="text-2xl font-bold leading-none tracking-tight text-ink">{value}</p>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</p>
    </div>
  );
}
