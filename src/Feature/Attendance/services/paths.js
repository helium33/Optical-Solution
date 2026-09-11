import { collection, doc } from 'firebase/firestore';
import { db } from '../config/firebase';

/**
 * Every Firestore path in one file, so a schema change is a single diff and
 * no component ever hard-codes a collection name.
 */

export const COLLECTIONS = {
  BRANCHES: 'branches',
  ADMINS: 'admins',
  STAFF: 'staff',
  ATTENDANCE: 'attendance',
  ATTENDANCE_DAILY: 'attendanceDaily',
  AUDIT: 'auditLogs',
};

export const branchesCol = () => collection(db, COLLECTIONS.BRANCHES);
export const branchDoc = (branchId) => doc(db, COLLECTIONS.BRANCHES, branchId);

export const adminDoc = (uid) => doc(db, COLLECTIONS.ADMINS, uid);

export const staffCol = () => collection(db, COLLECTIONS.STAFF);
export const staffDoc = (staffId) => doc(db, COLLECTIONS.STAFF, staffId);

export const attendanceCol = () => collection(db, COLLECTIONS.ATTENDANCE);
export const attendanceDoc = (logId) => doc(db, COLLECTIONS.ATTENDANCE, logId);

export const attendanceDailyCol = () => collection(db, COLLECTIONS.ATTENDANCE_DAILY);
export const attendanceDailyDoc = (branchId, dayKey) =>
  doc(db, COLLECTIONS.ATTENDANCE_DAILY, `${branchId}_${dayKey}`);

export const auditCol = () => collection(db, COLLECTIONS.AUDIT);

/* ──────────────────── server-only secret paths ──────────────────────────
 * Declared here so the schema lives in one file, but deliberately NOT exported
 * as Firestore refs: firestore.rules denies every client read and write on
 * these, and a helper that looked usable from the browser would only invite
 * someone to try.
 *
 * Secrets are separate DOCUMENTS rather than fields on the parent, because
 * Firestore rules are all-or-nothing per document — there is no way to serve
 * `staff/{id}` while withholding one field on it. The Cloud Functions read
 * these with the Admin SDK.
 */
export const SECRET_PATHS = {
  /** PBKDF2 record for a branch's kiosk PIN. */
  branchKioskPin: (branchId) => `${COLLECTIONS.BRANCHES}/${branchId}/secrets/kiosk`,
  /** PBKDF2 record for one staff member's personal PIN. */
  staffPin: (staffId) => `${COLLECTIONS.STAFF}/${staffId}/secrets/pin`,
  /** WebAuthn public key + signature counter, one document per credential. */
  staffCredential: (staffId, credentialId) =>
    `${COLLECTIONS.STAFF}/${staffId}/credentials/${credentialId}`,
};

/**
 * Attendance log ids are deterministic: one document per person per business
 * day. This is load-bearing, not a convenience — it makes a double check-in
 * structurally impossible rather than something a transaction has to catch,
 * and it turns "is Aye already in?" into a single get() instead of a query.
 */
export const attendanceLogId = (branchId, dayKey, staffId) => `${branchId}_${dayKey}_${staffId}`;
