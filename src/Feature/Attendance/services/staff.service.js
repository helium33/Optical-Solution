import {
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { staffCol, staffDoc } from './paths';
import { ROLE_META } from '../config/roles';

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

export async function setStaffRole(staffId, role, actorUid) {
  await updateDoc(staffDoc(staffId), {
    role,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}

export async function deactivateStaff(staffId, actorUid) {
  /* Never delete: the attendance history must keep resolving to a person. */
  await updateDoc(staffDoc(staffId), {
    active: false,
    deactivatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}
