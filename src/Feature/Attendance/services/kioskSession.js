/**
 * The kiosk "shop is open" session.
 *
 * A staff member never logs in. The *tablet* is unlocked once, in the morning,
 * with the branch PIN, and from then on it is a shared surface showing the
 * whole roster. Individual identity is proved per-punch (PIN or fingerprint),
 * not per-session.
 *
 * Deliberately sessionStorage, not localStorage: closing the tab must end the
 * shift session. A device left unlocked overnight is the main abuse vector, so
 * there is also a hard TTL and an idle timeout on top.
 */

const KEY = 'optical.attendance.kiosk';

/** Longest a single unlock is good for, even with constant use. */
const DEFAULT_TTL_MINUTES = 14 * 60;

/** Untouched for this long and the tablet re-locks. */
const DEFAULT_IDLE_MINUTES = 45;

const now = () => Date.now();

export function readKioskSession({ idleMinutes = DEFAULT_IDLE_MINUTES } = {}) {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;

    const session = JSON.parse(raw);
    if (!session?.branchId) return null;

    if (now() > session.expiresAt) {
      closeKioskSession();
      return { ...session, expired: true, reason: 'ttl' };
    }
    if (now() - session.touchedAt > idleMinutes * 60_000) {
      closeKioskSession();
      return { ...session, expired: true, reason: 'idle' };
    }
    return session;
  } catch {
    return null;
  }
}

export function openKioskSession(branchId, { ttlMinutes = DEFAULT_TTL_MINUTES } = {}) {
  const session = {
    branchId,
    openedAt: now(),
    touchedAt: now(),
    expiresAt: now() + ttlMinutes * 60_000,
  };
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* Storage blocked: the session lives in memory for this page only. */
  }
  return session;
}

/** Called on any interaction, to push back the idle timeout. */
export function touchKioskSession() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return;
    const session = JSON.parse(raw);
    session.touchedAt = now();
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* no-op */
  }
}

export function closeKioskSession() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
