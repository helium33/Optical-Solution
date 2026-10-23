import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, limit, query, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { LuCircleCheck, LuCircleX, LuLoaderCircle, LuTriangleAlert } from 'react-icons/lu';

import { auth, db, functions } from '../config/firebase';
import { COLLECTIONS } from '../services/paths';
import { ADMIN_EMAILS, isAllowlistedAdmin } from '../auth/admins';
import { BRANCH_IDS } from '../config/branches';
import { ROLES } from '../config/roles';
import { isCallableUnavailable } from '../lib/callableErrors';
import { DEV_FALLBACK, unlockWithStaffPin } from '../services/verification.service';

/**
 * `/attendance/diagnostics` — no gate, reachable by anyone with the URL.
 *
 * Exists because "Missing or insufficient permissions" gives an operator
 * nothing to act on, and telling them what to check by chat has already
 * failed to resolve this once. This page runs the actual checks instead of
 * describing them: which project the bundle is pointed at, what identity the
 * browser is holding right now, and a live read against every collection the
 * kiosk needs — each with the exact Firestore error code, not a paraphrase.
 *
 * Reading the roster is one rule (`signedIn()`); adding a staff member is a
 * completely different one (`isAdmin()`), evaluated against the SAME token by
 * a rule that never runs unless a write is attempted. A roster that loads
 * proves nothing about whether "Add staff" will work — they can fail
 * independently, and the generic error looks identical either way. Section 4
 * runs the actual write, gated behind a manual button because — unlike the
 * read checks — it touches real data (a synthetic document it deletes again
 * immediately after).
 *
 * The read checks request one document from each collection and report
 * success/failure, never the document itself.
 */

const CHECKED_COLLECTIONS = [
  { key: COLLECTIONS.BRANCHES, label: 'branches', why: 'the kiosk branch picker' },
  { key: COLLECTIONS.STAFF, label: 'staff', why: 'the kiosk roster' },
  { key: COLLECTIONS.ATTENDANCE, label: 'attendance', why: "today's punches" },
  { key: COLLECTIONS.ATTENDANCE_MONTHLY, label: 'attendanceMonthly', why: 'the admin Monthly tab' },
];

/**
 * Cloud Functions this app calls, none of them deployed yet. Every payload is
 * nonsense on purpose — a branch/staff id that cannot exist — so even a real,
 * deployed function has nothing to act on: this only ever proves whether the
 * request reaches a function at all, never a real PIN check or punch.
 *
 * Four "Missing or insufficient permissions." / "Cannot reach the server"
 * reports running through this exact conversation each turned out to be the
 * same root cause — nothing deployed — surfacing as a different error code
 * every time (`functions/not-found`, `functions/internal`, a bare
 * `unavailable`, ...). Guessing one code at a time does not scale. This
 * section shows the RAW code and message for each callable directly, so the
 * next shape is read off the screen instead of described secondhand.
 */
const CHECKED_CALLABLES = [
  { name: 'submitPunch', payload: { kind: 'check_in', branchId: 'diagnostics-probe', staffId: 'diagnostics-probe' }, why: 'a verified clock-in/out' },
  { name: 'setStaffPin', payload: { staffId: 'diagnostics-probe', pin: '0000' }, why: 'giving a new employee a PIN' },
  { name: 'beginWebAuthnRegistration', payload: { staffId: 'diagnostics-probe' }, why: 'enrolling a fingerprint' },
  { name: 'beginWebAuthnAuthentication', payload: { staffId: 'diagnostics-probe' }, why: 'clocking in with a fingerprint' },
];

/**
 * Every server the kiosk needs, and nothing it does not.
 *
 * Firebase Auth's two hosts and Firestore are the whole dependency list now:
 * PIN checks, punches and PIN changes in a build with VITE_ALLOW_CLIENT_PUNCH
 * no longer touch Cloud Functions, and the shop-Wi-Fi IP lookup is off. Cloud
 * Functions is still probed, labelled as unused, so a VPN comparison can show
 * whether it was ever the blocked one.
 */
const REACHABILITY_TARGETS = [
  { host: window.location.host, url: '/manifest.webmanifest', why: 'this site itself' },
  { host: 'identitytoolkit.googleapis.com', url: 'https://identitytoolkit.googleapis.com/', why: 'Firebase sign-in (the kiosk session)' },
  { host: 'securetoken.googleapis.com', url: 'https://securetoken.googleapis.com/', why: 'keeping that session signed in' },
  { host: 'firestore.googleapis.com', url: 'https://firestore.googleapis.com/', why: 'staff, PINs and every punch' },
  { host: 'cloudfunctions.net', url: `https://${import.meta.env.VITE_FIREBASE_REGION || 'asia-southeast1'}-${import.meta.env.VITE_FIREBASE_PROJECT_ID || 'x'}.cloudfunctions.net/`, why: 'Cloud Functions — not used by this build', unused: true },
];

export default function DiagnosticsPage() {
  const [authState, setAuthState] = useState({ status: 'checking' });
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [writeCheck, setWriteCheck] = useState(null);
  const [writeRunning, setWriteRunning] = useState(false);
  const [callableResults, setCallableResults] = useState(null);
  const [callableRunning, setCallableRunning] = useState(false);
  const [testBranch, setTestBranch] = useState(BRANCH_IDS[0]);
  const [testPin, setTestPin] = useState('');
  const [unlockTesting, setUnlockTesting] = useState(false);
  const [unlockResult, setUnlockResult] = useState(null);
  const [reachResults, setReachResults] = useState(null);
  const [reachRunning, setReachRunning] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) {
          setAuthState({ status: 'signed-out' });
          return;
        }
        const token = await user.getIdTokenResult().catch(() => null);
        setAuthState({
          status: 'signed-in',
          uid: user.uid,
          isAnonymous: user.isAnonymous,
          claims: token?.claims ?? {},
        });
      }),
    [],
  );

  const runChecks = useCallback(async () => {
    setRunning(true);
    const next = [];
    for (const { key, label, why } of CHECKED_COLLECTIONS) {
      try {
        await getDocs(query(collection(db, key), limit(1)));
        next.push({ label, why, ok: true });
      } catch (error) {
        next.push({
          label,
          why,
          ok: false,
          code: error?.code ?? 'unknown',
          message: error?.message ?? String(error),
        });
      }
    }
    setResults(next);
    setRunning(false);
  }, []);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  /**
   * Calls every callable this app uses, with a payload that cannot match a
   * real record even on a fully deployed backend. Automatic, like the read
   * checks: a request that can never touch real data needs no confirmation
   * button, and this is the single check most worth seeing without an extra
   * click — every "Cannot reach the server" / "Missing or insufficient
   * permissions" report so far has traced back to one of these being
   * unreachable, in a different disguise each time.
   */
  const runCallableChecks = useCallback(async () => {
    setCallableRunning(true);
    const next = [];
    for (const { name, payload, why } of CHECKED_CALLABLES) {
      try {
        /* Capped well below the SDK's 70-second default. Where the host is
           unreachable the request hangs rather than failing, and four of
           these in a row at the default was five minutes of spinner. */
        const response = await httpsCallable(functions, name, { timeout: 8_000 })(payload);
        next.push({ name, why, ok: true, data: response?.data });
      } catch (error) {
        next.push({
          name,
          why,
          ok: false,
          code: error?.code ?? 'unknown',
          message: error?.message ?? String(error),
          recognizedAsUnavailable: isCallableUnavailable(error),
        });
      }
    }
    setCallableResults(next);
    setCallableRunning(false);
  }, []);

  /* Only automatic when the app actually uses Functions. With
     VITE_ALLOW_CLIENT_PUNCH on, nothing in the app calls them — opening this
     page would otherwise be the ONLY thing sending requests to
     cloudfunctions.net, and on a connection where that host is blocked it
     would sit spinning over a dependency that does not exist. */
  useEffect(() => {
    if (!DEV_FALLBACK) runCallableChecks();
  }, [runCallableChecks]);

  /**
   * Writes and immediately deletes one throwaway document at
   * `staff/diagnostics-probe`. Manual, not automatic like the read
   * checks: those only ever read one document and discard it, this touches
   * real data. The document ID makes it unmistakable if it were ever left
   * behind, and the delete runs even when create succeeded but something
   * else in the app is watching the collection — cleanup is not optional.
   * Do not wrap this id in double underscores (`__like_this__`): Firestore
   * reserves that exact pattern and rejects it with `invalid-argument`
   * before rules are even evaluated — which is what the previous id did,
   * silently breaking this whole check against the real project.
   *
   * The payload matters. `firestore.rules` (the production ruleset, unlike
   * the development one) gates a staff create on
   * `isAdmin() && staffShapeIsValid()` — TWO conditions, not one — and an
   * earlier version of this probe wrote `{ diagnosticProbe: true }`, which
   * satisfies neither `branchId is string` nor `role in [...]` nor
   * `active is bool`. That is a shape failure, not an admin failure, but
   * Firestore reports both as the identical "permission-denied": this check
   * was giving a real admin a false "you are not an admin" under the rules
   * that matter most. The fields below are exactly what "Add staff" itself
   * writes, so this now tests the same two-part gate Add Staff does, not a
   * stricter one.
   */
  const runWriteCheck = async () => {
    setWriteRunning(true);
    const ref = doc(db, COLLECTIONS.STAFF, 'diagnostics-probe');
    let create = null;
    let del = null;
    try {
      await setDoc(ref, {
        branchId: BRANCH_IDS[0],
        name: 'Diagnostics probe',
        role: ROLES.SALES_ASSOCIATE,
        active: true,
      });
      create = { ok: true };
    } catch (error) {
      create = { ok: false, code: error?.code ?? 'unknown', message: error?.message ?? String(error) };
    }
    if (create.ok) {
      try {
        await deleteDoc(ref);
        del = { ok: true };
      } catch (error) {
        del = { ok: false, code: error?.code ?? 'unknown', message: error?.message ?? String(error) };
      }
    }
    setWriteCheck({ create, delete: del });
    setWriteRunning(false);
  };

  const signInAndRetry = async () => {
    try {
      await signInAnonymously(auth);
    } catch {
      /* surfaced via authState/onAuthStateChanged already */
    }
    runChecks();
  };

  /**
   * Runs the same staff-PIN check the kiosk keypad runs, with whatever branch
   * and PIN the operator types here, and shows what came back — and how long
   * each half took, since "it is slow" needs a number to be fixed.
   *
   * Says WHETHER a PIN matches, never WHO it matches. This page has no gate,
   * and its promise at the top is no staff names. The kiosk itself is the way
   * to see whose screen a PIN opens.
   *
   * Side-effecting, like section 5: it may sign this browser into an anonymous
   * session, replacing whatever identity section 2 shows.
   */
  const runUnlockTest = async () => {
    setUnlockTesting(true);
    setUnlockResult(null);
    try {
      const result = await unlockWithStaffPin(testBranch, testPin);
      setUnlockResult(result);
    } catch (error) {
      setUnlockResult({ ok: false, reason: 'exception', message: error?.message ?? String(error) });
    } finally {
      setUnlockTesting(false);
    }
  };

  /**
   * Can this connection reach each server the kiosk depends on?
   *
   * Answers "does it only work on a VPN" with evidence instead of guesses: run
   * it once with the VPN off and once with it on, and the difference is the
   * blocked host. `no-cors` because these are cross-origin endpoints that do
   * not send CORS headers to an arbitrary page — the response is opaque, but
   * an opaque response still proves a connection was made, and that is all
   * this asks. A network error or a hang is the answer worth having.
   */
  const runReachability = async () => {
    setReachRunning(true);
    setReachResults(null);
    const probe = async ({ host, url, why, unused = false }) => {
      const started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
        return { host, why, unused, ok: true, ms: Math.round(performance.now() - started) };
      } catch (error) {
        return {
          host,
          why,
          unused,
          ok: false,
          ms: Math.round(performance.now() - started),
          timedOut: error?.name === 'AbortError',
        };
      } finally {
        clearTimeout(timer);
      }
    };
    /* In parallel: a blocked host that hangs should not hold up the others. */
    setReachResults(await Promise.all(REACHABILITY_TARGETS.map(probe)));
    setReachRunning(false);
  };

  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || '(not set)';
  const anyDenied = results?.some((r) => !r.ok && r.code === 'permission-denied');
  const allOk = results?.every((r) => r.ok);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-ink">
      <h1 className="mb-1 text-xl font-bold tracking-tight">Attendance diagnostics</h1>
      <p className="mb-8 text-ink-subtle">
        Live checks against your actual Firebase project — no guessing, no chat instructions to
        re-type. Reads nothing but existence: never staff names, PINs or punches.
      </p>

      {/* ---- which project ---- */}
      <Section title="1. Which Firebase project is this bundle pointed at?">
        <KeyValue k="VITE_FIREBASE_PROJECT_ID" v={projectId} />
        {/* Google sign-in only works from a host on Firebase's authorised
            list, and the commonest reason it is not on the list is that the
            real host is not the one the reader assumed — a deploy preview, a
            www prefix, a custom domain. Print it rather than ask. */}
        <KeyValue k="this page's address" v={typeof window === 'undefined' ? '—' : window.location.hostname} />
        <p className="mt-2 text-xs text-ink-subtle">
          Open Firebase Console and confirm the project selector in the top-left reads exactly
          this. A rules change published to the wrong project changes nothing here.
        </p>
      </Section>

      {/* ---- identity ---- */}
      <Section title="2. What identity does this browser hold?">
        {authState.status === 'checking' ? (
          <Row icon={<LuLoaderCircle className="h-4 w-4 animate-spin" />} tone="pending">
            Checking…
          </Row>
        ) : authState.status === 'signed-out' ? (
          <>
            <Row icon={<LuCircleX className="h-4 w-4" />} tone="bad">
              Not signed in at all
            </Row>
            <p className="mt-2 text-xs text-ink-subtle">
              Every rule below requires <code>request.auth != null</code>. Nothing can succeed
              until this says signed in. Click the button below — if it fails, the message names
              the real cause instead of &ldquo;permission denied&rdquo; downstream of it.
            </p>
            <button
              type="button"
              onClick={signInAndRetry}
              className="mt-3 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-brand-on"
            >
              Sign in anonymously and re-run
            </button>
          </>
        ) : (
          <>
            <Row icon={<LuCircleCheck className="h-4 w-4" />} tone="good">
              Signed in — {authState.isAnonymous ? 'anonymous session' : 'named account'}
            </Row>
            <KeyValue k="uid" v={authState.uid} />
            <KeyValue k="isAnonymous" v={String(authState.isAnonymous)} />
            <KeyValue
              k="token claims"
              v={Object.keys(authState.claims).length ? JSON.stringify(authState.claims) : '(none)'}
            />
            {authState.isAnonymous ? (
              <p className="mt-2 text-xs text-ink-subtle">
                An anonymous session carries no claims — this is expected before the Cloud
                Functions exist. The development rules must grant access on{' '}
                <code>signedIn()</code> alone, not on any claim, or every read below will be
                denied regardless of what the rules for <code>staff</code> say.
              </p>
            ) : (
              <AdminVerdict claims={authState.claims} />
            )}
          </>
        )}
      </Section>

      {/* ---- live reads ---- */}
      <Section
        title="3. Can this identity actually read each collection?"
        action={
          <button
            type="button"
            onClick={runChecks}
            disabled={running}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {running ? 'Running…' : 'Re-run'}
          </button>
        }
      >
        {!results ? (
          <Row icon={<LuLoaderCircle className="h-4 w-4 animate-spin" />} tone="pending">
            Running…
          </Row>
        ) : (
          <div className="space-y-3">
            {results.map((r) => (
              <div key={r.label}>
                <Row icon={r.ok ? <LuCircleCheck className="h-4 w-4" /> : <LuCircleX className="h-4 w-4" />} tone={r.ok ? 'good' : 'bad'}>
                  <code className="font-semibold">{r.label}</code>
                  <span className="text-ink-subtle"> — used by {r.why}</span>
                </Row>
                {!r.ok ? (
                  <p className="ml-6 mt-1 text-xs text-danger-ink/85">
                    <code>{r.code}</code>: {r.message}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ---- live callables ---- */}
      <Section
        title="4. Are the callable functions reachable?"
        action={
          <button
            type="button"
            onClick={runCallableChecks}
            disabled={callableRunning}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {callableRunning ? 'Running…' : callableResults ? 'Re-run' : 'Check anyway'}
          </button>
        }
      >
        {DEV_FALLBACK ? (
          <p className="mb-3 rounded-xl bg-ok-soft px-3 py-2 text-xs leading-relaxed text-ok-ink">
            <strong>Not used by this build.</strong> <code>VITE_ALLOW_CLIENT_PUNCH</code> is on, so
            the PIN check, every punch and every PIN change go straight to Firestore and never
            call a Cloud Function. Nothing below affects the kiosk; it only runs if you press the
            button.
          </p>
        ) : null}
        <p className="mb-3 text-xs leading-relaxed text-ink-subtle">
          Every payload names a branch/employee id that cannot exist, so even a
          fully deployed, correctly working backend has nothing to act on here
          — this only shows whether the request reaches a function at all, in
          whatever shape a request-to-nothing actually comes back as. None of
          your callables are deployed yet, so every row below is expected
          to fail; what matters is the exact code.
        </p>
        {!callableResults && !callableRunning && DEV_FALLBACK ? null : !callableResults ? (
          <Row icon={<LuLoaderCircle className="h-4 w-4 animate-spin" />} tone="pending">
            Running…
          </Row>
        ) : (
          <div className="space-y-3">
            {callableResults.map((r) => (
              <div key={r.name}>
                <Row icon={r.ok ? <LuCircleCheck className="h-4 w-4" /> : <LuCircleX className="h-4 w-4" />} tone={r.ok ? 'good' : 'bad'}>
                  <code className="font-semibold">{r.name}</code>
                  <span className="text-ink-subtle"> — used by {r.why}</span>
                </Row>
                {!r.ok ? (
                  <p className="ml-6 mt-1 text-xs text-danger-ink/85">
                    <code>{r.code}</code>: {r.message}
                    {!r.recognizedAsUnavailable ? (
                      <span className="ml-1 font-semibold text-warn-ink">
                        — a new code this app does not yet recognise as &ldquo;not deployed&rdquo;;
                        send this exact line to get it added.
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="ml-6 mt-1 text-xs text-ink-subtle">
                    Reached and responded — this callable IS deployed. Response:{' '}
                    <code>{JSON.stringify(r.data)}</code>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ---- live write ---- */}
      <Section
        title="5. Can this identity write as an admin?"
        action={
          <button
            type="button"
            onClick={runWriteCheck}
            disabled={writeRunning}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {writeRunning ? 'Running…' : writeCheck ? 'Run again' : 'Run write check'}
          </button>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-ink-subtle">
          Reading the roster and adding a staff member are gated by two different rules —{' '}
          <code>signedIn()</code> for the read, <code>isAdmin()</code> for the write — evaluated
          against the same token. Section 3 passing proves nothing about this. Writes and then
          deletes one throwaway document at <code>staff/diagnostics-probe</code>; nothing
          else in your data is touched.
        </p>
        {!writeCheck ? (
          <Row icon={<LuLoaderCircle className="h-4 w-4" />} tone="pending">
            Not run yet
          </Row>
        ) : (
          <div className="space-y-2">
            <Row
              icon={writeCheck.create.ok ? <LuCircleCheck className="h-4 w-4" /> : <LuCircleX className="h-4 w-4" />}
              tone={writeCheck.create.ok ? 'good' : 'bad'}
            >
              create on <code>staff</code>
            </Row>
            {!writeCheck.create.ok ? (
              <p className="ml-6 text-xs text-danger-ink/85">
                <code>{writeCheck.create.code}</code>: {writeCheck.create.message}
              </p>
            ) : null}
            {writeCheck.create.ok ? (
              <>
                <Row
                  icon={writeCheck.delete.ok ? <LuCircleCheck className="h-4 w-4" /> : <LuCircleX className="h-4 w-4" />}
                  tone={writeCheck.delete.ok ? 'good' : 'bad'}
                >
                  cleanup delete
                </Row>
                {!writeCheck.delete.ok ? (
                  <p className="ml-6 text-xs text-danger-ink/85">
                    <code>{writeCheck.delete.code}</code>: {writeCheck.delete.message} — the probe
                    document may still exist at <code>staff/diagnostics-probe</code>; delete it
                    by hand from the Firestore console.
                  </p>
                ) : null}
              </>
            ) : null}
            {!writeCheck.create.ok && writeCheck.create.code === 'permission-denied' ? (
              <p className="mt-2 text-xs text-ink-muted">
                This is exactly what &ldquo;Add staff&rdquo; hits. The rules do not consider this
                identity an admin — check section 2 above: is <code>email_verified</code> true, is
                the email on the allowlist, and does it match what is actually published (not just
                what is in this repository)?
              </p>
            ) : null}
          </div>
        )}
      </Section>

      {/* ---- network reachability ---- */}
      <Section
        title="6. Can this connection reach the servers the kiosk needs?"
        action={
          <button
            type="button"
            onClick={runReachability}
            disabled={reachRunning}
            className="rounded-xl border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {reachRunning ? 'Checking…' : reachResults ? 'Re-run' : 'Check'}
          </button>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-ink-subtle">
          If the app only works on a VPN, run this with the VPN <strong>off</strong>, then again
          with it <strong>on</strong>. A row that fails only without the VPN is the server your
          internet provider is blocking. Each check gives up after 8 seconds.
        </p>
        <Row
          icon={DEV_FALLBACK ? <LuCircleCheck className="h-4 w-4" /> : <LuCircleX className="h-4 w-4" />}
          tone={DEV_FALLBACK ? 'good' : 'bad'}
        >
          Cloud Functions are {DEV_FALLBACK ? 'not used' : 'REQUIRED'} by this build
          (<code>VITE_ALLOW_CLIENT_PUNCH</code> is {DEV_FALLBACK ? 'on' : 'off'})
        </Row>
        {!DEV_FALLBACK ? (
          <p className="ml-6 mt-1 text-xs text-ink-muted">
            With this off, every punch goes to a function that has never been deployed. Set{' '}
            <code>VITE_ALLOW_CLIENT_PUNCH=true</code> in the hosting environment variables and
            redeploy.
          </p>
        ) : null}
        {reachResults ? (
          <div className="mt-3 space-y-1.5">
            {reachResults.map((r) => (
              <div key={r.host}>
                <Row
                  icon={
                    r.ok ? (
                      <LuCircleCheck className="h-4 w-4" />
                    ) : r.unused ? (
                      <LuTriangleAlert className="h-4 w-4" />
                    ) : (
                      <LuCircleX className="h-4 w-4" />
                    )
                  }
                  tone={r.ok ? 'good' : r.unused ? 'pending' : 'bad'}
                >
                  <code className="font-semibold">{r.host}</code>
                  <span className="font-normal text-ink-subtle">
                    {' '}— {r.why} ·{' '}
                    {r.ok ? `${r.ms} ms` : r.timedOut ? 'no answer in 8 s' : `failed after ${r.ms} ms`}
                  </span>
                </Row>
              </div>
            ))}
            {reachResults.some((r) => !r.ok && !r.unused) ? (
              <p className="mt-2 text-xs leading-relaxed text-danger-ink/85">
                A server the kiosk needs cannot be reached from this connection. If the same row
                passes with a VPN on, this internet provider is blocking it; the app cannot work
                around a blocked Google server by itself.
              </p>
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-ok-ink">
                Every server the kiosk needs is reachable from this connection.
              </p>
            )}
          </div>
        ) : null}
      </Section>

      {/* ---- live unlock test ---- */}
      <Section title="7. Test a staff PIN">
        <p className="mb-3 text-xs leading-relaxed text-ink-subtle">
          Runs the same check the kiosk keypad runs, for the branch and PIN typed below, and
          shows whether it matches and how long it took. It never shows <em>who</em> a PIN
          belongs to — type it at the kiosk to see that. Not read-only: it may sign this
          browser into an anonymous session, replacing whatever identity section 2 shows.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
              Branch
            </span>
            <select
              value={testBranch}
              onChange={(event) => setTestBranch(event.target.value)}
              className="rounded-xl border border-line bg-surface-card px-3 py-2 text-sm text-ink"
            >
              {BRANCH_IDS.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-ink-subtle">
              PIN
            </span>
            <input
              value={testPin}
              onChange={(event) => setTestPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              placeholder="0000"
              autoComplete="off"
              className="w-24 rounded-xl border border-line bg-surface-card px-3 py-2 text-sm text-ink"
            />
          </label>
          <button
            type="button"
            onClick={runUnlockTest}
            disabled={unlockTesting || testPin.length !== 4}
            className="rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-brand-on disabled:opacity-50"
          >
            {unlockTesting ? 'Testing…' : 'Test PIN'}
          </button>
        </div>
        {unlockResult ? (
          <div className="mt-3">
            <Row
              icon={unlockResult.ok ? <LuCircleCheck className="h-4 w-4" /> : <LuCircleX className="h-4 w-4" />}
              tone={unlockResult.ok ? 'good' : 'bad'}
            >
              {unlockResult.ok ? 'Matches exactly one person at this branch' : (
                <>
                  Refused — reason: <code>{unlockResult.reason ?? 'unknown'}</code>
                </>
              )}
            </Row>
            {unlockResult.timings ? (
              <p className="ml-6 mt-1 text-xs text-ink-subtle">
                Network {unlockResult.timings.networkMs} ms (sign-in, roster, PIN records) ·
                checking {unlockResult.timings.hashingMs} ms across {unlockResult.timings.people}{' '}
                {unlockResult.timings.people === 1 ? 'person' : 'people'}. At the kiosk the network
                part starts as soon as the shop is chosen, so only the checking part is waited for.
              </p>
            ) : null}
            {!unlockResult.ok && unlockResult.message ? (
              <p className="ml-6 mt-1 text-xs text-danger-ink/85">{unlockResult.message}</p>
            ) : null}
            {!unlockResult.ok && unlockResult.reason === 'wrong-pin' ? (
              <p className="ml-6 mt-1 text-xs text-ink-muted">
                Nobody at this branch has this PIN. Set it in the admin dashboard → Employee
                management → Edit — and check the person is at <em>this</em> branch.
              </p>
            ) : null}
            {!unlockResult.ok && unlockResult.reason === 'pin-ambiguous' ? (
              <p className="ml-6 mt-1 text-xs text-ink-muted">
                More than one person at this branch has this PIN, so the kiosk refuses it rather
                than guess. Give one of them a different PIN in Employee management.
              </p>
            ) : null}
            {!unlockResult.ok && unlockResult.reason === 'anonymous-disabled' ? (
              <p className="ml-6 mt-1 text-xs text-ink-muted">
                The kiosk could not start a session, so the PIN was never checked. Firebase
                Console → Authentication → Sign-in method → enable <strong>Anonymous</strong>.
              </p>
            ) : null}
            {!unlockResult.ok && unlockResult.reason === 'sign-in-failed' ? (
              <p className="ml-6 mt-1 text-xs text-ink-muted">
                The kiosk could not start a session, so the PIN was never checked. Run section 6:
                if <code>identitytoolkit.googleapis.com</code> fails there, this connection is
                blocking Firebase sign-in.
              </p>
            ) : null}
            {!unlockResult.ok && unlockResult.reason === 'unavailable' ? (
              <p className="ml-6 mt-1 text-xs text-ink-muted">
                The staff list or PIN records could not be read, so the PIN was never checked.
                Run section 6: if <code>firestore.googleapis.com</code> fails there, this
                connection is blocking it.
              </p>
            ) : null}
            {!unlockResult.ok && unlockResult.reason === 'rules-not-published' ? (
              <p className="ml-6 mt-1 text-xs text-ink-muted">
                Firestore refused to hand over the PIN records. The attendance rules that let a
                kiosk read <code>secrets/verifier</code> have not been published.
              </p>
            ) : null}
          </div>
        ) : null}
      </Section>

      {/* ---- verdict ---- */}
      {results ? (
        <Section title="Verdict">
          {allOk ? (
            <Row icon={<LuCircleCheck className="h-4 w-4" />} tone="good">
              Every collection is readable with the current identity. If the kiosk still shows an
              error, it is not a rules problem — check <code>.env</code> matches this same project,
              and that <code>npm run dev</code> was restarted after any change to it.
            </Row>
          ) : anyDenied ? (
            <>
              <Row icon={<LuTriangleAlert className="h-4 w-4" />} tone="bad">
                Rules are deployed, but they do not grant this identity read access.
              </Row>
              <ol className="ml-5 mt-2 list-decimal space-y-1 text-xs text-ink-muted">
                <li>
                  Firebase Console → Firestore Database → Rules — confirm you published to{' '}
                  <strong>{projectId}</strong>, the project named in section 1.
                </li>
                <li>
                  Confirm the published rules actually contain a <code>match /staff/&#123;staffId&#125;</code>{' '}
                  block (and one for every collection marked ✗ above). If <code>npm run merge:rules</code>{' '}
                  produced <code>firestore.rules.merged</code>, that file — not the console&apos;s old
                  content — is what needs to be pasted in and published.
                </li>
                <li>Click Publish. The console shows a toast confirming the new rules are live.</li>
                <li>Come back to this page and click &ldquo;Re-run&rdquo; — no redeploy of the app needed.</li>
              </ol>
            </>
          ) : (
            <Row icon={<LuTriangleAlert className="h-4 w-4" />} tone="bad">
              Failing, but not with permission-denied — see the exact code and message above.
              That is a different problem than rules (a missing index, an unreachable project, or
              the collection genuinely not existing yet).
            </Row>
          )}
        </Section>
      ) : null}

      <p className="mt-10 text-center text-xs text-ink-subtle">
        <Link to="/attendance/kiosk" className="font-semibold text-brand-ink hover:underline">
          Back to the kiosk
        </Link>
      </p>
    </div>
  );
}

/**
 * A client-side re-evaluation of `isAdmin()` from `firestore.rules`, so the
 * page can say WHY a write will fail before the write check even runs.
 * `email_verified` is not something devtools can fake for a real Google
 * account, so this reads the token's own claim rather than trusting the SDK
 * user object — the token is what the rules actually see.
 */
function AdminVerdict({ claims }) {
  const email = claims.email ?? null;
  const emailVerified = claims.email_verified === true;
  const onAllowlist = email ? isAllowlistedAdmin(email) : false;
  const hasAdminClaim = claims.admin === true;
  const shouldPass = hasAdminClaim || (emailVerified && onAllowlist);

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface-sunken/50 p-3">
      <p className="mb-2 text-xs font-bold text-ink">
        Does this identity satisfy <code>isAdmin()</code>?
      </p>
      <KeyValue k="email" v={email ?? '(none on this token)'} />
      <KeyValue k="email_verified" v={String(emailVerified)} />
      <KeyValue k="on the admin allowlist" v={onAllowlist ? `yes (${ADMIN_EMAILS.length} addresses)` : 'no'} />
      <KeyValue k="admin custom claim" v={hasAdminClaim ? 'true' : '(not set)'} />
      <Row icon={shouldPass ? <LuCircleCheck className="h-4 w-4" /> : <LuCircleX className="h-4 w-4" />} tone={shouldPass ? 'good' : 'bad'}>
        {shouldPass ? 'Should pass isAdmin() — confirm with section 4 below' : 'Will NOT pass isAdmin() as written in this repo'}
      </Row>
      {!shouldPass && email && !onAllowlist ? (
        <p className="mt-2 text-xs text-ink-subtle">
          This address is not one of the three in{' '}
          <code>src/Feature/Attendance/auth/admins.js</code>. Sign in with an allowlisted account,
          or add this one to that file AND to <code>isAdmin()</code> in the rules — both have to
          agree, and only one of them is enforced by anything.
        </p>
      ) : null}
      {!shouldPass && email && onAllowlist && !emailVerified ? (
        <p className="mt-2 text-xs text-ink-subtle">
          The email is allowlisted but this token says <code>email_verified: false</code>. That is
          unusual for a Google sign-in — sign out and back in, or check nothing intercepted the
          OAuth flow.
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <section className="mb-6 rounded-2xl border border-line bg-surface-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold tracking-tight text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const TONES = {
  good: 'text-ok-ink',
  bad: 'text-danger-ink',
  pending: 'text-ink-subtle',
};

function Row({ icon, tone, children }) {
  return (
    <div className={`flex items-center gap-2 text-sm font-semibold ${TONES[tone]}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

function KeyValue({ k, v }) {
  return (
    <p className="font-mono text-xs text-ink-muted">
      <span className="text-ink-subtle">{k}:</span> {v}
    </p>
  );
}
