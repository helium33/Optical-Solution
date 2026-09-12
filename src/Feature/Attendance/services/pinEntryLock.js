import { useSyncExternalStore } from 'react';

/**
 * Tracks whether a PIN pad is on screen anywhere.
 *
 * Exists for one reason: the secret admin sequence listens for digits typed on
 * the page, and so does the PIN pad. Without this, a staff member whose
 * personal PIN happened to be 7860 would reveal the administrator door every
 * time they clocked in. The listener switches off while a pad is open.
 *
 * A counter rather than a boolean, because a PIN pad can legitimately be on
 * screen behind a dialog containing another one.
 */

let openCount = 0;
const listeners = new Set();

const notify = () => listeners.forEach((listener) => listener());

/** Called by PinPad on mount. Returns the release function for cleanup. */
export function acquirePinEntry() {
  openCount += 1;
  notify();
  return () => {
    openCount = Math.max(0, openCount - 1);
    notify();
  };
}

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const getSnapshot = () => openCount > 0;

export function usePinEntryOpen() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
