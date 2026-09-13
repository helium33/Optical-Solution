import { httpsCallable } from 'firebase/functions';
import { signInAnonymously, signInWithCustomToken, signOut } from 'firebase/auth';

import { auth, functions } from '../config/firebase';
import { isCallableUnavailable } from '../lib/callableErrors';

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

/**
 * Development PINs, per branch.
 *
 * `VITE_DEV_BRANCH_PINS=win:1111,pwint:2222,yangon:3333` gives each shop its
 * real PIN while testing locally, so the tablet behaves the way it will once
 * the Functions are deployed. Without this the whole point of three different
 * PINs is lost the moment you run it on your own machine — you type the Win PIN
 * at the Win kiosk, it is refused, and nothing on screen explains why.
 *
 * The values live in `.env`, which is gitignored. This repository is public and
 * a branch PIN must never be committed to it.
 *
 * `VITE_DEV_BRANCH_PIN` stays supported as the single-PIN shorthand, and the
 * whole thing falls back to 1234 so a fresh clone runs with no configuration.
 */
const DEV_BRANCH_PINS = (() => {
  const map = {};
  for (const pair of String(import.meta.env.VITE_DEV_BRANCH_PINS ?? '').split(',')) {
    const [id, pin] = pair.split(':').map((part) => part?.trim());
    if (id && pin) map[id] = pin;
  }
  return map;
})();

const DEV_SHARED_PIN = import.meta.env.VITE_DEV_BRANCH_PIN || '1234';

const devPinFor = (branchId) => DEV_BRANCH_PINS[branchId] ?? DEV_SHARED_PIN;

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
    if (DEV_FALLBACK && isCallableUnavailable(error)) {
      console.warn(
        '[attendance] verifyBranchPin is not deployed — using the development PIN and an ' +
          'unauthenticated kiosk session. Never ship with VITE_ALLOW_CLIENT_PUNCH enabled.',
      );
      if (pin !== devPinFor(branchId)) return { ok: false, reason: 'wrong-pin' };

      /* Without SOME Firebase identity every Firestore read is refused and the
         kiosk shows an empty roster with "Missing or insufficient permissions".
         The real path mints a branch-scoped custom token; there is no way to
         do that from a browser, so the development path signs in anonymously
         and the development rules accept any signed-in reader.
         This is weaker than the real thing by design — an anonymous session
         carries no branch claim, so the rules cannot scope it to one shop. It
         is a way to run the app before the Functions exist, not a posture to
         deploy. */
      try {
        await signInAnonymously(auth);
      } catch (anonError) {
        if (anonError?.code === 'auth/operation-not-allowed') {
          return { ok: false, reason: 'anonymous-disabled' };
        }
        return { ok: false, reason: 'unavailable', message: anonError?.message };
      }
      return { ok: true, ttlMinutes: 840, dev: true };
    }
    if (error?.code === 'functions/resource-exhausted') return { ok: false, reason: 'rate-limited' };
    if (error?.code === 'functions/permission-denied') return { ok: false, reason: 'wrong-pin' };
    if (isCallableUnavailable(error)) {
      /* The function simply is not there. Say that, rather than blaming the
         network — the fix is a deploy, not a better signal. */
      console.error(
        '[attendance] The verifyBranchPin function is not deployed. Deploy it, or set ' +
          'VITE_ALLOW_CLIENT_PUNCH=true (with VITE_DEV_BRANCH_PINS) to test locally.',
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
