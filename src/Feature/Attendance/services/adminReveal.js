/**
 * Whether the administrator door is currently showing.
 *
 * Again, and it bears repeating wherever this is imported: this is a curtain,
 * not a lock. The flag lives in sessionStorage and anyone can set it by hand.
 * It exists so the shop tablet does not carry a visible "Admin" button, not so
 * that the admin area is protected — that is Google OAuth plus the allowlist
 * plus firestore.rules, none of which care about this value.
 *
 * sessionStorage, and a short TTL on top: the door should not still be standing
 * open on a shared tablet an hour after the owner walked away.
 */

const KEY = 'optical.attendance.adminReveal';

/** The door closes again after this long, even if the tab stays open. */
const TTL_MINUTES = 10;

export const ADMIN_SEQUENCE = '7860';

export function revealAdmin() {
  try {
    window.sessionStorage.setItem(KEY, String(Date.now() + TTL_MINUTES * 60_000));
  } catch {
    /* Storage blocked — the reveal lasts for this page view only. */
  }
}

export function isAdminRevealed() {
  try {
    const until = Number(window.sessionStorage.getItem(KEY));
    if (!until) return false;
    if (Date.now() > until) {
      hideAdmin();
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function hideAdmin() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}
