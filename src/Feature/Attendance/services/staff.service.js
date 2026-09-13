import {
  addDoc,
  deleteDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../config/firebase';
import { staffCol, staffDoc } from './paths';
import { ROLE_META } from '../config/roles';
import { isCallableUnavailable } from '../lib/callableErrors';

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
export async function setStaffPin(staffId, pin) {
  try {
    const response = await callSetStaffPin({ staffId, pin });
    return response.data ?? { ok: true };
  } catch (error) {
    if (ALLOW_CLIENT_FALLBACK && isCallableUnavailable(error)) {
      console.warn(
        '[attendance] setStaffPin is not deployed. The employee was created but has NO PIN, ' +
          'so they cannot clock in yet. Set it with `npm run seed:pins -- --staff`.',
      );
      return { ok: false, reason: 'not-deployed' };
    }
    throw error;
  }
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


