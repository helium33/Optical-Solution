import { signInAnonymously, signOut } from 'firebase/auth';

import { auth } from '../config/firebase';
import { verifyPin } from '../lib/crypto';
import { pickStaffMatch } from '../lib/pinMatch';
import { fetchBranchStaff, fetchStaffVerifier } from './staff.service';

/**
 * Kiosk sign-in: a staff member types their OWN PIN and lands on their own
 * screen. There is no branch PIN any more.
 *
 * There used to be — one shared four-digit code per shop that opened the whole
 * roster, tried before anybody's own PIN. It went for two reasons. The shop
 * wanted each person's PIN to take them straight to themselves. And checking
 * the branch PIN meant calling a Cloud Function, `verifyBranchPin`, that has
 * never been deployed: every PIN waited on a request to cloudfunctions.net
 * before the real check could start. With a VPN that request failed quickly
 * and the app fell back; without one, where that host is unreachable, it hung
 * until a 15-second timeout and then reported failure. That single dead call
 * was both "unlocking is slow" and "it only works on a VPN".
 *
 * Nothing on this path talks to Cloud Functions now. It needs exactly two
 * services, both of which the rest of the app needs anyway: Firebase Auth (an
 * anonymous session, so Firestore will answer) and Firestore (the roster and
 * each person's PBKDF2 verifier).
 */

export const DEV_FALLBACK = import.meta.env.VITE_ALLOW_CLIENT_PUNCH === 'true';

/**
 * Why an anonymous sign-in was refused, in terms someone can act on.
 *
 * Each of these has a different fix, and none of the first three is about the
 * network, which is what a generic "cannot reach the server" would suggest:
 *
 *   anonymous-disabled     Authentication → Sign-in method → Anonymous is off
 *   domain-not-authorised  the site's address is not on Firebase's list
 *   bad-api-key            the key in this build is wrong or missing
 *   sign-in-failed         genuinely blocked or offline
 *
 * Firebase is inconsistent about which code it raises for a disabled Anonymous
 * provider, hence the two spellings — see firebase/flutterfire#2935.
 */
const anonymousFailure = (error) => {
  const code = String(error?.code ?? '');
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return 'anonymous-disabled';
  }
  if (code === 'auth/unauthorized-domain') return 'domain-not-authorised';
  if (code.startsWith('auth/api-key') || code === 'auth/invalid-api-key') return 'bad-api-key';
  return 'sign-in-failed';
};

/** Drop the kiosk identity as well as the local session. */
export async function lockKiosk() {
  await signOut(auth).catch(() => {});
}

/**
 * Everything the PIN check needs that does NOT depend on the PIN.
 *
 * This is the slow part — a sign-in round trip, the roster query, then one
 * read per person for their verifier — and none of it has to wait for the
 * fourth digit. The keypad starts this the moment a shop is chosen, so by the
 * time somebody has typed four digits the network is already done and only
 * the hashing is left.
 *
 * Signing in before anyone has typed anything is a deliberate trade, and worth
 * being plain about: under the development rules an anonymous session can read
 * every roster, but anonymous sign-in is enabled for this project, so anyone
 * who can open the page could already mint one from a browser console. The
 * session the keypad holds grants nothing a visitor could not take for
 * themselves. What protects a PIN is the PBKDF2 cost, not the session.
 *
 * @returns {Promise<{ok:true, branchId:string, candidates:Array<{person:object, record:object}>, at:number}
 *                 | {ok:false, reason:string, message?:string}>}
 */
export async function prepareStaffPinCheck(branchId) {
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      return { ok: false, reason: anonymousFailure(error), message: error?.message };
    }
  }

  let roster;
  try {
    roster = await fetchBranchStaff(branchId);
  } catch (error) {
    if (error?.code === 'permission-denied') return { ok: false, reason: 'rules-not-published' };
    return { ok: false, reason: 'unavailable', message: error?.message };
  }

  /* All at once rather than in turn: fifteen sequential reads on a shop's
     mobile connection is most of a second spent waiting for nothing. Each
     failure is kept rather than swallowed — see below. */
  const records = await Promise.all(
    roster.map(async (person) => {
      try {
        return { person, record: await fetchStaffVerifier(person.id) };
      } catch (error) {
        return { person, error };
      }
    }),
  );

  /* A read that FAILED is not a person without a PIN. Treating it as one
     would mean a connection that drops halfway through the roster tells the
     people whose reads were lost that their correct PIN is wrong. */
  const failed = records.filter((entry) => entry.error);
  if (failed.length) {
    /* Every one refused, on a roster that is not empty, means the rules that
       let a kiosk read verifiers were never published. */
    if (failed.every((entry) => entry.error?.code === 'permission-denied')) {
      return { ok: false, reason: 'rules-not-published' };
    }
    return { ok: false, reason: 'unavailable', message: failed[0].error?.message };
  }

  return {
    ok: true,
    branchId,
    /* No record means no PIN has been set for that person yet. */
    candidates: records.filter((entry) => entry.record),
    at: Date.now(),
  };
}

/**
 * Check a typed PIN against prepared candidates. Only hashing happens here.
 *
 * Every candidate is derived in parallel. Each derivation is deliberately slow
 * (PBKDF2, 210 000 iterations), and one after another would make a shop of
 * fifteen look frozen.
 */
export async function matchStaffPin(prepared, pin) {
  const checked = await Promise.all(
    prepared.candidates.map(async ({ person, record }) => ({
      person,
      ok: await verifyPin(pin, record).catch(() => false),
    })),
  );
  return pickStaffMatch(checked);
}

/**
 * One-shot version for callers with nothing prepared: the diagnostics page,
 * and the admin screens' clash check.
 *
 * @returns {Promise<{ok:boolean, staff?:object, reason?:string, message?:string, timings?:object}>}
 */
export async function unlockWithStaffPin(branchId, pin) {
  const started = performance.now();
  const prepared = await prepareStaffPinCheck(branchId);
  const preparedAt = performance.now();
  if (!prepared.ok) return prepared;
  const result = await matchStaffPin(prepared, pin);
  return {
    ...result,
    timings: {
      networkMs: Math.round(preparedAt - started),
      hashingMs: Math.round(performance.now() - preparedAt),
      people: prepared.candidates.length,
    },
  };
}

/**
 * Who else in this shop already answers to this PIN?
 *
 * Asked by the admin screens before saving, using the same check the keypad
 * uses — so "would this PIN be ambiguous at the kiosk" is answered by the
 * kiosk's own logic, not a second opinion that could drift from it.
 *
 * Returns null when the check cannot run (rules not published, offline). That
 * fails open on purpose: refusing to save a PIN because a safety check could
 * not reach the server would lock an admin out of fixing anything. The keypad
 * still refuses an ambiguous PIN, so the worst case is a clash that is caught
 * at the door rather than at the desk.
 *
 * @returns {Promise<object|null>} the person already using it, or null
 */
export async function findStaffWithPin(branchId, pin, { exceptStaffId = null } = {}) {
  const prepared = await prepareStaffPinCheck(branchId).catch(() => null);
  if (!prepared?.ok) return null;
  const others = {
    ...prepared,
    candidates: prepared.candidates.filter(({ person }) => person.id !== exceptStaffId),
  };
  const checked = await Promise.all(
    others.candidates.map(async ({ person, record }) => ({
      person,
      ok: await verifyPin(pin, record).catch(() => false),
    })),
  );
  return checked.find((entry) => entry.ok)?.person ?? null;
}
