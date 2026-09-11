import { getDocs, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { branchDoc, branchesCol } from './paths';
import { BRANCHES, BRANCH_LIST } from '../config/branches';

/**
 * Branch records live in Firestore so an owner can move a shop pin or rotate
 * the kiosk PIN without a deploy. config/branches.js is the seed and the
 * offline fallback — if Firestore is unreachable the kiosk still knows where
 * the shop is and what the shift looks like.
 */

/** Merge a Firestore record over the local fallback, field by field. */
const hydrate = (id, remote) => {
  const local = BRANCHES[id] ?? {};
  if (!remote) return local;
  return {
    ...local,
    ...remote,
    id,
    geofence: { ...local.geofence, ...(remote.geofence ?? {}) },
    network: { ...local.network, ...(remote.network ?? {}) },
    shift: { ...local.shift, ...(remote.shift ?? {}) },
    /* Never let a PIN record reach component state, even if rules leak it. */
    kioskPin: undefined,
  };
};

export async function fetchBranches() {
  try {
    const snapshot = await getDocs(branchesCol());
    if (snapshot.empty) return BRANCH_LIST;
    return snapshot.docs.map((entry) => hydrate(entry.id, entry.data()));
  } catch {
    return BRANCH_LIST;
  }
}

export function subscribeBranches(onChange, onError) {
  return onSnapshot(
    branchesCol(),
    (snapshot) => {
      onChange(
        snapshot.empty ? BRANCH_LIST : snapshot.docs.map((entry) => hydrate(entry.id, entry.data())),
      );
    },
    (error) => {
      /* Fall back rather than blanking the kiosk. */
      onChange(BRANCH_LIST);
      onError?.(error);
    },
  );
}

export async function updateBranchGeofence(branchId, geofence, actorUid) {
  await updateDoc(branchDoc(branchId), {
    geofence,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}

export async function updateBranchShift(branchId, shift, actorUid) {
  await updateDoc(branchDoc(branchId), {
    shift,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid,
  });
}

/** One-time seeding for a fresh project. Safe to re-run — it merges. */
export async function seedBranches() {
  await Promise.all(
    BRANCH_LIST.map((branch) =>
      setDoc(
        branchDoc(branch.id),
        { ...branch, active: true, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    ),
  );
}
