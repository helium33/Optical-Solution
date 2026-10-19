/**
 * The admin allowlist.
 *
 * IMPORTANT — this file is a *user-experience* gate, not a security boundary.
 * It ships in the client bundle and anyone can edit it in devtools. The real
 * enforcement lives in two places and both must be kept in step with this list:
 *
 *   1. firestore.rules   — isAdmin() checks request.auth.token.email
 *   2. functions/        — the onCreate trigger that mints the `admin: true`
 *                          custom claim only for these addresses
 *
 * Keeping the list here as well means a non-admin who signs in gets an
 * immediate, readable "this account isn't an administrator" instead of a
 * dashboard that loads and then fails every read with permission-denied.
 */

export const ADMIN_EMAILS = Object.freeze([
  'kyawwinhtun564@gmail.com',
  /* Both spellings of the same mailbox. Gmail ignores dots, so these two
     addresses deliver to one inbox — but Firebase hands back whichever
     spelling the Google account is registered under, and every check
     here and in the rules is an exact string match. Listing one of them
     locks the owner out of their own dashboard with "not an
     administrator", which reads like the wrong account rather than a
     punctuation mismatch. */
  'wpy.muse@gmail.com',
  'wpymuse@gmail.com',
  'yannaing190792@gmail.com',
]);

const normalise = (email) => String(email ?? '').trim().toLowerCase();

export const isAllowlistedAdmin = (email) => ADMIN_EMAILS.includes(normalise(email));
