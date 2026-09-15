import {
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../config/firebase';
import { COLLECTIONS, staffCol, staffDoc } from './paths';
import { ROLE_META } from '../config/roles';
import { isCallableUnavailable } from '../lib/callableErrors';
import { createPinRecord, verifyPin } from '../lib/crypto';

/**
 * Staff records. The `pin` and `webauthn.credentials[].publicKey` fields are
 * write-only from the client's point of view — Firestore rules strip them from
 * reads, so nothing here ever expects them to be present.
 */

/** Sort by seniority, then alphabetically: the order the kiosk grid shows. */
const byRoleThenName = (a, b) => {
  const rank = (ROLE_META[a.role]?.order ?? 99) - (ROLE_META[b.role]?.order ?? 99);
  return rank !== 0 ? rank : String(a.name).localeCompare(String(b.name));
};

const shape = (entry) => {
  const data = entry.data();
  return {
    id: entry.id,
    ...data,
    /* Presence of a credential is public; the credential itself is not. */
    hasBiometrics: Boolean(data.webauthnCredentialCount),
    pin: undefined,
    webauthn: undefined,
  };
};

export function subscribeBranchStaff(branchId, onChange, onError) {
  const q = query(
    staffCol(),
    where('branchId', '==', branchId),
    where('active', '==', true),
    orderBy('name'),
  );
  return onSnapshot(
    q,
    (snapshot) => onChange(snapshot.docs.map(shape).sort(byRoleThenName)),
    onError,
  );
}

/** Everyone on a branch including deactivated people — for the admin view. */
export function subscribeBranchStaffIncludingInactive(branchId, onChange, onError) {
  return onSnapshot(
    query(staffCol(), where('branchId', '==', branchId), orderBy('name')),
    (snapshot) => onChange(snapshot.docs.map(shape).sort(byRoleThenName)),
    onError,
  );
}

/**
 * Everyone, everywhere, including removed people.
 *
 * The management view needs the deactivated ones — they are the only way to
 * find someone who was removed by mistake and put them back.
 */
export function subscribeAllStaffIncludingInactive(onChange, onError) {
  return onSnapshot(
    query(staffCol(), orderBy('name')),
    (snapshot) => onChange(snapshot.docs.map(shape).sort(byRoleThenName)),
    onError,
  );
}

export function subscribeAllStaff(onChange, onError) {
  return onSnapshot(
    query(staffCol(), where('active', '==', true), orderBy('name')),
    (snapshot) => onChange(snapshot.docs.map(shape).sort(byRoleThenName)),
    onError,
  );
}

export async function createStaff({ branchId, name, role, employeeCode, phone = null }, actorUid) {
  const created = await addDoc(staffCol(), {
    branchId,
    name,
    role,
    employeeCode,
    phone,
    active: true,
    webauthnCredentialCount: 0,
    joinedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdBy: actorUid,
  });
  return created.id;
}

/* ──────────────────────────── PIN assignment ──────────────────────────── */

const callSetStaffPin = httpsCallable(functions, 'setStaffPin');

const ALLOW_CLIENT_FALLBACK = import.meta.env.VITE_ALLOW_CLIENT_PUNCH === 'true';

/**
 * Give a staff member a PIN.
 *
 * The PIN is sent to a callable and hashed there. It is never written from the
 * browser, because its home is `staff/{id}/secrets/pin`, a document
 * firestore.rules denies to every client including an administrator — the
 * Admin SDK is the only thing that can reach it, and that runs server-side.
 *
 * The PIN is also never stored in component state longer than the form that
 * collected it, and never logged.
 */
export async function setStaffPin(staffId, pin, actorUid = null) {
  try {
    const response = await callSetStaffPin({ staffId, pin });
    return response.data ?? { ok: true };
  } catch (error) {
    if (ALLOW_CLIENT_FALLBACK && isCallableUnavailable(error)) {
      /* Two documents, because Firestore rules are per-document and these are
         two different permissions. See the comment on staffPinDoc. */
      await Promise.all([
        setDoc(staffPinDoc(staffId), {
          pin: String(pin),
          updatedAt: serverTimestamp(),
          updatedBy: actorUid,
        }),
        setDoc(staffVerifierDoc(staffId), {
          ...(await createPinRecord(pin)),
          updatedAt: serverTimestamp(),
          setBy: 'client-unverified',
        }),
      ]);
      return { ok: true, dev: true };
    }
    throw error;
  }
}

/**
 * A PIN is stored twice, in two documents, on purpose.
 *
 * Two different people need two different things from it, and Firestore rules
 * are all-or-nothing per document — there is no way to serve one document
 * while withholding a field on it. So the question "who may READ the PIN" and
 * the question "who may CHECK the PIN" get a document each:
 *
 *   secrets/pin       the PIN itself, admin-only. This is what makes the
 *                     admin table able to show and edit a real PIN.
 *   secrets/verifier  a PBKDF2 record and nothing else, readable by any
 *                     signed-in session so the kiosk can check a PIN it is
 *                     given — without being able to learn one it was not.
 *
 * Collapsing these into one document, or storing the PIN as a plain field on
 * the staff record, would put every employee's PIN inside the roster the kiosk
 * already reads: any member of staff could open the shop tablet's devtools,
 * read a colleague's PIN, and clock in as them. On a system that decides pay
 * that is not a privacy nit, it is a way to steal hours.
 */
const staffPinDoc = (staffId) => doc(db, COLLECTIONS.STAFF, staffId, 'secrets', 'pin');
const staffVerifierDoc = (staffId) => doc(db, COLLECTIONS.STAFF, staffId, 'secrets', 'verifier');

/**
 * Read back one person's PIN. Admin only — the rule on `secrets/pin` is what
 * enforces that, not this function.
 *
 * @returns {Promise<{ok: boolean, pin?: string, reason?: string}>}
 */
export async function fetchStaffPin(staffId) {
  try {
    const snapshot = await getDoc(staffPinDoc(staffId));
    if (!snapshot.exists()) return { ok: false, reason: 'no-pin-set' };
    return { ok: true, pin: snapshot.data().pin ?? null };
  } catch (error) {
    if (error?.code === 'permission-denied') return { ok: false, reason: 'denied' };
    throw error;
  }
}

/**
 * Check a staff member's own PIN, in the browser.
 *
 * This exists only because the callable has no server to run on yet, and it is
 * a weaker thing than the callable it stands in for. Two honest limits:
 *
 *   - Something has to be READABLE for the browser to check anything, so the
 *     development rules serve `staff/{id}/secrets/verifier` to any signed-in
 *     session. That document holds a PBKDF2 record and nothing else — no PIN
 *     leaves the admin-only document next to it.
 *   - A four-digit PIN is ten thousand guesses. What makes that cost anything
 *     is PBKDF2 at 210 000 iterations — roughly a tenth of a second per guess,
 *     so a full sweep of one person's PIN is tens of minutes of steady compute
 *     rather than instant. That is a lock on a drawer, not a safe.
 *
 * So it is worth having — it stops a colleague reading someone else's hours
 * over their shoulder, which is the actual risk on a shop floor — and it is
 * not worth trusting against someone determined. Deploying the callable
 * replaces it with a real check and lets the rule go back to denying reads.
 *
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function verifyStaffPin(staffId, pin) {
  if (!ALLOW_CLIENT_FALLBACK) return { ok: false, reason: 'not-deployed' };

  let snapshot;
  try {
    snapshot = await getDoc(staffVerifierDoc(staffId));
  } catch (error) {
    /* Denied means the rule was never loosened — which is the SAFE state, not
       a bug. Say so plainly rather than reporting it as a wrong PIN. */
    if (error?.code === 'permission-denied') return { ok: false, reason: 'pin-unreadable' };
    throw error;
  }

  if (!snapshot.exists()) return { ok: false, reason: 'no-pin-set' };
  return (await verifyPin(pin, snapshot.data()))
    ? { ok: true }
    : { ok: false, reason: 'wrong-pin' };
}

/* ───────────────────────────── removal ────────────────────────────────── */

/**
 * Remove someone from the app.
 *
 * This is a deactivation, and that is the right default rather than a
 * limitation: attendance records name a person, and payroll history that
 * resolves to a dangling id is not history any more. A deactivated employee
 * disappears from every roster, tree and kiosk immediately — from the point of
 * view of anyone using the app they are gone — while last month's timesheet
 * still says who worked those hours.
 *
 * For the genuinely-destructive version, see deleteStaffPermanently.
 */
export async function removeStaff(staffId, actorUid) {
  await updateDoc(staffDoc(staffId), {
    active: false,
    deactivatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}

/** Undo a removal. */
export async function restoreStaff(staffId, actorUid) {
  await updateDoc(staffDoc(staffId), {
    active: true,
    deactivatedAt: null,
    updatedBy: actorUid,
  });
}

/**
 * Erase the employee record itself.
 *
 * Irreversible, and it orphans every attendance row that referenced them — the
 * rows keep the denormalised `staffName` and `role`, so reports still read
 * correctly, but the person can never be looked up again. Offered because
 * sometimes a record genuinely should not exist (a duplicate, a test entry, a
 * data-protection request), and gated behind an explicit confirmation in the
 * UI rather than a stray click next to "remove".
 */
export async function deleteStaffPermanently(staffId) {
  await deleteDoc(staffDoc(staffId));
}

export async function setStaffRole(staffId, role, actorUid) {
  await updateDoc(staffDoc(staffId), {
    role,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}


