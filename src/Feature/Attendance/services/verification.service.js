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

const callVerifyBranchPin = httpsCallable(functions, 'verifyBranchPin');

const DEV_FALLBACK = import.meta.env.VITE_ALLOW_CLIENT_PUNCH === 'true';
const DEV_BRANCH_PIN = import.meta.env.VITE_DEV_BRANCH_PIN || '1234';

/**
 * @returns {Promise<{ok: boolean, reason?: string, ttlMinutes?: number}>}
 */
export async function unlockKiosk(branchId, pin) {
  let result;

  try {
    const response = await callVerifyBranchPin({ branchId, pin });
    result = response.data;
  } catch (error) {
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
