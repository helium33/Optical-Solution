import { getDocs, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { branchDoc, branchesCol } from './paths';
import { BRANCH_LIST } from '../config/branches';
import { mergeBranchRecords } from '../lib/branchRecords';

/**
 * Branch records live in Firestore so an owner can move a shop pin or rotate
 * the kiosk PIN without a deploy. config/branches.js is the seed and the
 * offline fallback — if Firestore is unreachable the kiosk still knows where
 * the shop is and what the shift looks like.
 */

const recordsOf = (snapshot) => snapshot.docs.map((entry) => ({ id: entry.id, data: entry.data() }));

export async function fetchBranches() {
  try {
    return mergeBranchRecords(recordsOf(await getDocs(branchesCol())));
  } catch {
    return BRANCH_LIST;
  }
}

export function subscribeBranches(onChange, onError) {
  return onSnapshot(
    branchesCol(),
    (snapshot) => {
      onChange(mergeBranchRecords(recordsOf(snapshot)));
    },
    (error) => {
      /* Fall back rather than blanking the kiosk. */
      onChange(BRANCH_LIST);
      onError?.(error);
    },
  );
}

/*
 * Both writes create the document if it is not there yet, and merge into it if
 * it is.
 *
 * They used updateDoc, which only ever edits an existing document — and this
 * project has never had branch documents; the shops have run on the built-in
 * defaults from day one. So the very first save of a shift or a shop pin
 * failed with "No document to update: …/branches/win", every time, for every
 * shop. `merge: true` keeps whatever else the document already holds, so
 * saving the shift does not wipe a pin saved earlier, or the reverse.
 */

export async function updateBranchGeofence(branchId, geofence, actorUid) {
  await setDoc(
    branchDoc(branchId),
    { geofence, updatedAt: serverTimestamp(), updatedBy: actorUid },
    { merge: true },
  );
}

export async function updateBranchShift(branchId, shift, actorUid) {
  await setDoc(
    branchDoc(branchId),
    { shift, updatedAt: serverTimestamp(), updatedBy: actorUid },
    { merge: true },
  );
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
