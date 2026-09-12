import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken, signOut } from 'firebase/auth';

import { auth, functions } from '../config/firebase';

/**
 * Branch PIN verification, and the identity it hands back.
 *
 * The kiosk has no user account — but it still has to read the roster and
 * today's punches out of Firestore, and "let anyone on the internet read every
 * shop's staff list" is not an acceptable rule. So a correct branch PIN returns
 * a Firebase CUSTOM TOKEN carrying two claims:
 *
 *     { kiosk: true, branchId: 'win' }
 *
 * The tablet signs in with it, and from then on Firestore rules can scope every
 * read to exactly one branch — no email, no password, no shared credential
 * sitting in the client bundle. The token is short-lived and re-minted by the
 * next unlock, so a stolen tablet stops working when the session expires.
 *
 * The PIN itself is compared server-side against a PBKDF2 hash the client is
 * never permitted to read.
 */

/**
 * Firebase callables default to a 70-second timeout. On a shop tablet that is
 * indistinguishable from "frozen" — nobody waits over a minute at a keypad, they
 * just press it again. Fifteen seconds is long enough for a slow connection and
 * short enough to stay a conversation.
 */
const CALL_TIMEOUT_MS = 15_000;

const callVerifyBranchPin = httpsCallable(functions, 'verifyBranchPin', {
  timeout: CALL_TIMEOUT_MS,
});

/** Reject rather than hang, whatever the SDK decides to do. */
const withTimeout = (promise, ms = CALL_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise((unused, reject) =>
      setTimeout(() => {
        const error = new Error('The server did not answer in time.');
        error.code = 'deadline-exceeded';
        reject(error);
      }, ms),
    ),
  ]);

const DEV_FALLBACK = import.meta.env.VITE_ALLOW_CLIENT_PUNCH === 'true';
const DEV_BRANCH_PIN = import.meta.env.VITE_DEV_BRANCH_PIN || '1234';

/**
 * @returns {Promise<{ok: boolean, reason?: string, ttlMinutes?: number}>}
 */
export async function unlockKiosk(branchId, pin) {
  let result;

  try {
    const response = await withTimeout(callVerifyBranchPin({ branchId, pin }));
    result = response.data;
  } catch (error) {
    if (error?.code === 'deadline-exceeded' || error?.code === 'functions/deadline-exceeded') {
      return { ok: false, reason: 'timeout' };
    }
    if (DEV_FALLBACK && error?.code === 'functions/not-found') {
      console.warn(
        '[attendance] verifyBranchPin is not deployed — using the development PIN and an ' +
          'unauthenticated kiosk session. Never ship with VITE_ALLOW_CLIENT_PUNCH enabled.',
      );
      return pin === DEV_BRANCH_PIN
        ? { ok: true, ttlMinutes: 840, dev: true }
        : { ok: false, reason: 'wrong-pin' };
    }
    if (error?.code === 'functions/resource-exhausted') return { ok: false, reason: 'rate-limited' };
    if (error?.code === 'functions/permission-denied') return { ok: false, reason: 'wrong-pin' };
    if (error?.code === 'functions/not-found') {
      /* The function simply is not there. Say that, rather than blaming the
         network — the fix is a deploy, not a better signal. */
      console.error(
        '[attendance] The verifyBranchPin function is not deployed. Deploy it, or set ' +
          'VITE_ALLOW_CLIENT_PUNCH=true (with VITE_DEV_BRANCH_PIN) to test locally.',
      );
      return { ok: false, reason: 'not-deployed' };
    }
    return { ok: false, reason: 'unavailable', message: error?.message };
  }

  if (!result?.ok) return result ?? { ok: false, reason: 'wrong-pin' };

  if (result.token) {
    try {
      await signInWithCustomToken(auth, result.token);
    } catch (signInError) {
      return { ok: false, reason: 'unavailable', message: signInError?.message };
    }
  }

  return result;
}

/** Drop the kiosk identity as well as the local session. */
export async function lockKiosk() {
  await signOut(auth).catch(() => {});
}
