import { subscribeBranchStaff } from './staff.service';
import { subscribeDayBoard } from './attendance.service';

/**
 * Firestore listeners that outlive the screen that started them.
 *
 * WHY: the keypad and the staff screen are two routes. Each used to open its
 * own listeners on mount and close them on unmount, so the moment a PIN was
 * accepted and the kiosk navigated, the staff screen started from nothing and
 * waited a full round trip for the roster and today's records — on a shop's
 * mobile connection, several seconds of spinner after the PIN was already
 * right. Now the keypad starts these as soon as a shop is chosen, the staff
 * screen subscribes to the SAME listener, and gets the current value on its
 * first render.
 *
 * A listener with nobody watching is kept for KEEP_ALIVE_MS rather than
 * closed, because the next person is usually a minute away, not an hour.
 * After that it is closed, so an idle tablet is not streaming all day.
 */

const KEEP_ALIVE_MS = 10 * 60_000;

/** key -> { subscribers:Set, value, ready, stop, timer } */
const entries = new Map();

function share(key, start, onChange, onError) {
  let entry = entries.get(key);
  if (!entry) {
    entry = { subscribers: new Set(), value: undefined, ready: false, stop: null, timer: null };
    entries.set(key, entry);
    const current = entry;
    current.stop = start(
      (value) => {
        current.value = value;
        current.ready = true;
        for (const subscriber of current.subscribers) subscriber.onChange(value);
      },
      (error) => {
        for (const subscriber of current.subscribers) subscriber.onError?.(error);
        /* A failed listener is not kept: the next subscriber starts a fresh
           one rather than inheriting an error that may have been transient
           (signed out for a moment, offline at the time). */
        if (entries.get(key) === current) entries.delete(key);
        current.stop?.();
      },
    );
  }

  clearTimeout(entry.timer);
  const subscriber = { onChange, onError };
  entry.subscribers.add(subscriber);
  /* A late subscriber is told the current value at once rather than waiting
     for the next change, which may never come. */
  if (entry.ready) onChange(entry.value);

  const owner = entry;
  return () => {
    owner.subscribers.delete(subscriber);
    if (owner.subscribers.size === 0 && entries.get(key) === owner) {
      owner.timer = setTimeout(() => {
        if (entries.get(key) === owner && owner.subscribers.size === 0) {
          entries.delete(key);
          owner.stop?.();
        }
      }, KEEP_ALIVE_MS);
    }
  };
}

/** The current value, if a listener already has one — for a first render. */
function peek(key) {
  const entry = entries.get(key);
  return entry?.ready ? entry.value : undefined;
}

const rosterKey = (branchId) => `roster:${branchId}`;
const boardKey = (branchId, dayKey) => `board:${branchId}:${dayKey}`;

export function watchRoster(branchId, onChange, onError) {
  return share(
    rosterKey(branchId),
    (next, fail) => subscribeBranchStaff(branchId, next, fail),
    onChange,
    onError,
  );
}

export function watchDayBoard(branchId, dayKey, onChange, onError) {
  return share(
    boardKey(branchId, dayKey),
    (next, fail) => subscribeDayBoard(branchId, dayKey, next, fail),
    onChange,
    onError,
  );
}

export const peekRoster = (branchId) => peek(rosterKey(branchId));
export const peekDayBoard = (branchId, dayKey) => peek(boardKey(branchId, dayKey));
