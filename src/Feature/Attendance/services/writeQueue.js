/**
 * Let Firestore's offline queue carry a write, instead of waiting on it.
 *
 * `await setDoc(...)` resolves only when the SERVER confirms. The write itself
 * is already safe long before that: Firestore applies it to this device's
 * cache at once (every listener sees it) and keeps it queued, persisted on
 * the device, until it can be sent — through a dropped connection, through a
 * reload. Waiting for the confirmation meant a punch on a slow line held the
 * person at the counter for a full round trip that protected nothing.
 *
 * So the server gets a short window to confirm, and after that the write is
 * left to the queue. Network trouble never fails a queued write — Firestore
 * retries it. What CAN fail later is a refusal (rules, a malformed document),
 * and by then the person has gone; a refusal like that is recorded here and
 * shown on the keypad, so a punch is never lost without anyone being told.
 */

/* Long enough for a good connection to confirm — and to surface an outright
   refusal where the person can still see it — without holding anyone on a
   slow one. */
const ACK_WAIT_MS = 150;
const FAILED_KEY = 'attendance:failedWrites';
export const WRITE_FAILED_EVENT = 'attendance:write-failed';

/**
 * @param {Promise} write   the Firestore write, already started
 * @param {string}  what    who and what, for the record if it fails later
 * @returns {Promise<{acknowledged: boolean}>} rejects only on a failure
 *          inside the window, where the caller can still show it
 */
export function settleWrite(write, what) {
  return new Promise((resolve, reject) => {
    let handedToQueue = false;
    const timer = setTimeout(() => {
      handedToQueue = true;
      resolve({ acknowledged: false });
    }, ACK_WAIT_MS);

    write.then(
      () => {
        clearTimeout(timer);
        if (!handedToQueue) resolve({ acknowledged: true });
      },
      (error) => {
        clearTimeout(timer);
        if (!handedToQueue) reject(error);
        else recordFailedWrite(what, error);
      },
    );
  });
}

function recordFailedWrite(what, error) {
  const entry = {
    what,
    at: new Date().toISOString(),
    code: error?.code ?? 'unknown',
    message: String(error?.message ?? error).slice(0, 300),
  };
  console.error('[attendance] A queued write was refused by the server:', entry);
  try {
    const list = JSON.parse(localStorage.getItem(FAILED_KEY) ?? '[]');
    list.push(entry);
    localStorage.setItem(FAILED_KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* Storage unavailable: the console line above is all that is left. */
  }
  window.dispatchEvent(new CustomEvent(WRITE_FAILED_EVENT, { detail: entry }));
}

export function readFailedWrites() {
  try {
    return JSON.parse(localStorage.getItem(FAILED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function clearFailedWrites() {
  try {
    localStorage.removeItem(FAILED_KEY);
  } catch {
    /* nothing to clear */
  }
}
