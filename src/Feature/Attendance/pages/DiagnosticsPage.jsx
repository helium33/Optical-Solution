import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { collection, deleteDoc, doc, getDocs, limit, query, setDoc } from 'firebase/firestore';
import { LuCircleCheck, LuCircleX, LuLoaderCircle, LuTriangleAlert } from 'react-icons/lu';

import { auth, db } from '../config/firebase';
import { COLLECTIONS } from '../services/paths';
import { ADMIN_EMAILS, isAllowlistedAdmin } from '../auth/admins';

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

export default function DiagnosticsPage() {
  const [authState, setAuthState] = useState({ status: 'checking' });
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [writeCheck, setWriteCheck] = useState(null);
  const [writeRunning, setWriteRunning] = useState(false);

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
   * Writes and immediately deletes one throwaway document at
   * `staff/__diagnostics_probe__`. Manual, not automatic like the read
   * checks: those only ever read one document and discard it, this touches
   * real data. The document ID makes it unmistakable if it were ever left
   * behind, and the delete runs even when create succeeded but something
   * else in the app is watching the collection — cleanup is not optional.
   */
  const runWriteCheck = async () => {
    setWriteRunning(true);
    const ref = doc(db, COLLECTIONS.STAFF, '__diagnostics_probe__');
    let create = null;
    let del = null;
    try {
      await setDoc(ref, { diagnosticProbe: true, at: Date.now() });
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

      {/* ---- live write ---- */}
      <Section
        title="4. Can this identity write as an admin?"
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
          deletes one throwaway document at <code>staff/__diagnostics_probe__</code>; nothing
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
                    document may still exist at <code>staff/__diagnostics_probe__</code>; delete it
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
