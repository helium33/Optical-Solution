import {
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../config/firebase';
import { attendanceCol, attendanceDoc, attendanceLogId } from './paths';
import { computeWorkSession, businessDayKey, zonedTimeToUtc } from '../lib/time';
import { deviceFingerprint } from '../lib/crypto';
import { isCallableUnavailable } from '../lib/callableErrors';

export const PUNCH = { CHECK_IN: 'check_in', CHECK_OUT: 'check_out' };
export const AUTH_METHOD = { PIN: 'pin', BIOMETRIC: 'biometric' };

/**
 * Reads come straight from Firestore (rules scope them by branch and role).
 * WRITES DO NOT. A punch is submitted to a callable Cloud Function, which is
 * the only writer for the attendance collection, because three of the things
 * that make a punch valid cannot be trusted from a browser:
 *
 *   - the clock      — a tablet's system time is user-settable
 *   - the IP         — whatever the client reports about itself is a claim
 *   - the PIN check  — comparing a hash client-side means shipping the hash
 *
 * The function re-derives all of them: `context.rawRequest.ip` for the network
 * check, its own clock for the timestamps, and the stored PIN/credential for
 * identity. The client's GPS reading is the one input that *must* come from the
 * device; it is stored alongside its accuracy so a suspicious fix stays
 * auditable after the fact.
 */

const ALLOW_CLIENT_PUNCH = import.meta.env.VITE_ALLOW_CLIENT_PUNCH === 'true';

/* ────────────────────────────── reads ─────────────────────────────────── */

const shapeLog = (entry) => ({ id: entry.id, ...entry.data() });

/** Live board for one branch on one day — what the kiosk and dashboard show. */
export function subscribeDayBoard(branchId, dayKey, onChange, onError) {
  const q = query(
    attendanceCol(),
    where('branchId', '==', branchId),
    where('dayKey', '==', dayKey),
  );
  return onSnapshot(q, (snapshot) => onChange(snapshot.docs.map(shapeLog)), onError);
}

export async function fetchLog(branchId, dayKey, staffId) {
  const snapshot = await getDoc(attendanceDoc(attendanceLogId(branchId, dayKey, staffId)));
  return snapshot.exists() ? shapeLog(snapshot) : null;
}

/**
 * Range query for the dashboard.
 *
 * Only branch and date are filtered server-side. Role and overtime are applied
 * in memory on purpose: Firestore would need a separate composite index per
 * filter combination, and the result set here is bounded by
 * (branches x staff x days) — a three-shop month is a few thousand documents,
 * which is cheaper to over-fetch once than to index six ways.
 */
export async function queryAttendance({
  branchIds = [],
  fromKey,
  toKey,
  roles = null,
  overtimeOnly = false,
  statuses = null,
} = {}) {
  if (!branchIds.length || !fromKey || !toKey) return [];

  const constraints = [
    where('dayKey', '>=', fromKey),
    where('dayKey', '<=', toKey),
    orderBy('dayKey', 'desc'),
  ];
  /* `in` caps at 30 values; three branches is comfortably inside it. */
  constraints.unshift(where('branchId', 'in', branchIds.slice(0, 30)));

  const snapshot = await getDocs(query(attendanceCol(), ...constraints));
  let rows = snapshot.docs.map(shapeLog);

  if (roles?.length) rows = rows.filter((row) => roles.includes(row.role));
  if (statuses?.length) rows = rows.filter((row) => statuses.includes(row.status));
  if (overtimeOnly) rows = rows.filter((row) => (row.overtime?.grantedMinutes ?? 0) > 0);

  return rows;
}

export async function fetchLogsByIds(ids = []) {
  if (!ids.length) return [];
  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const results = await Promise.all(
    chunks.map((chunk) => getDocs(query(attendanceCol(), where(documentId(), 'in', chunk)))),
  );
  return results.flatMap((snapshot) => snapshot.docs.map(shapeLog));
}

/* ────────────────────────────── writes ────────────────────────────────── */

const callSubmitPunch = httpsCallable(functions, 'submitPunch');

/**
 * @param {object} punch
 * @param {'check_in'|'check_out'} punch.kind
 * @param {string} punch.branchId
 * @param {string} punch.staffId
 * @param {boolean} punch.overtimeRequested   only meaningful on check_out
 * @param {{method:string, pin?:string, assertion?:object}} punch.auth
 * @param {{latitude:number,longitude:number,accuracy:number}} punch.position
 * @param {string|null} punch.ip              client's view, for cross-checking
 */
export async function submitPunch(punch) {
  const payload = {
    ...punch,
    deviceId: deviceFingerprint(),
    /* Sent for drift detection, never used as the recorded time. */
    clientTime: new Date().toISOString(),
  };

  try {
    const response = await callSubmitPunch(payload);
    return response.data;
  } catch (error) {
    if (ALLOW_CLIENT_PUNCH && isCallableUnavailable(error)) {
      return submitPunchUnverified(payload);
    }
    throw error;
  }
}

/**
 * DEVELOPMENT ONLY — writes the log straight from the browser.
 *
 * Enabled by VITE_ALLOW_CLIENT_PUNCH=true and only reached when the callable
 * is genuinely absent, so a real deployment cannot silently fall into it. Every
 * record it writes is tagged `verifiedBy: 'client-unverified'` so unverified
 * rows are greppable in the database rather than indistinguishable from real
 * ones. Leave this off in production; the matching Firestore rule should deny
 * client writes to `attendance` entirely.
 */
async function submitPunchUnverified(payload) {
  const { kind, branchId, staffId, staff, branch, overtimeRequested, position, ip } = payload;

  console.warn(
    '[attendance] submitPunch callable not deployed — writing an UNVERIFIED log from the client. ' +
      'This path must be disabled in production (VITE_ALLOW_CLIENT_PUNCH).',
  );

  const timezone = branch.timezone;
  const at = new Date();
  const dayKey = businessDayKey(at, timezone);
  const id = attendanceLogId(branchId, dayKey, staffId);

  const event = {
    at: at.toISOString(),
    method: payload.auth?.method ?? AUTH_METHOD.PIN,
    location: position
      ? {
          lat: position.latitude,
          lng: position.longitude,
          accuracy: position.accuracy,
          distance: payload.geo?.distance ?? null,
        }
      : null,
    ip: ip ?? null,
    deviceId: payload.deviceId,
    verifiedBy: 'client-unverified',
    /* Records made with the geofence switched off stay identifiable forever. */
    ...(payload.locationBypass ? { locationBypass: payload.locationBypass } : {}),
  };

  if (kind === PUNCH.CHECK_IN) {
    const computed = computeWorkSession({
      checkInAt: at,
      checkOutAt: null,
      shift: branch.shift,
      timeZone: timezone,
      now: at,
    });
    await setDoc(
      attendanceDoc(id),
      {
        branchId,
        staffId,
        staffName: staff.name,
        role: staff.role,
        dayKey,
        timezone,
        checkIn: event,
        checkOut: null,
        status: computed.status,
        minutes: zeroMinutes(),
        overtime: { claimed: false, eligibleMinutes: 0, grantedMinutes: 0, capped: false, reason: null },
        shiftSnapshot: branch.shift,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return { id, dayKey, kind };
  }

  const existing = await fetchLog(branchId, dayKey, staffId);
  if (!existing?.checkIn?.at) {
    const error = new Error('No open session to close.');
    error.code = 'failed-precondition';
    throw error;
  }

  const computed = computeWorkSession({
    checkInAt: existing.checkIn.at,
    checkOutAt: at,
    shift: existing.shiftSnapshot ?? branch.shift,
    timeZone: timezone,
    overtimeRequested,
    now: at,
  });

  await updateDoc(attendanceDoc(id), {
    checkOut: event,
    status: computed.status,
    minutes: minutesOf(computed),
    overtime: computed.overtime,
    updatedAt: serverTimestamp(),
  });

  return { id, dayKey, kind, computed };
}

const zeroMinutes = () => ({
  gross: 0, break: 0, worked: 0, regular: 0, overtime: 0, late: 0, earlyLeave: 0,
});

const minutesOf = (computed) => ({
  gross: computed.grossMinutes,
  break: computed.breakMinutes,
  worked: computed.workedMinutes,
  regular: computed.regularMinutes,
  /* Actual minutes past the shift... */
  overtime: computed.overtimeMinutes,
  /* ...and the whole hours those are paid as. Both, always: one is the
     measurement, the other is the payroll figure, and a payslip query needs
     to be answerable from the record. */
  overtimeHours: computed.overtimeHours,
  late: computed.lateMinutes,
  earlyLeave: computed.earlyLeaveMinutes,
});

/* ─────────────────────── supervisor / admin actions ───────────────────── */

export async function approveOvertime(logId, actor) {
  await updateDoc(attendanceDoc(logId), {
    'overtime.approvedBy': actor.uid,
    'overtime.approvedAt': serverTimestamp(),
    'overtime.reason': null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Rewrite a day's check-in and check-out times, and recompute everything that
 * depends on them.
 *
 * This is the administrator's override, and the reason it lives in the service
 * rather than the dialog is that an edited day must go through the SAME
 * calculation as a punched one. If the component worked out the new totals
 * itself there would be two implementations of the overtime rule, and the one
 * used for corrections would be the one nobody tested.
 *
 * The shift is taken from the record's own `shiftSnapshot`, not from today's
 * branch config — correcting a punch from March must use March's shift, or the
 * correction silently applies a policy that did not exist yet.
 *
 * @param {string} checkInHHMM   "09:05" in branch-local time, or null to leave
 * @param {string} checkOutHHMM  "17:40", or null to leave the shift open
 */
export async function amendPunchTimes({
  log,
  branch,
  checkInHHMM,
  checkOutHHMM,
  overtimeRequested,
  actor,
  reason,
}) {
  if (!reason?.trim()) {
    const error = new Error('An amendment needs a reason.');
    error.code = 'invalid-argument';
    throw error;
  }

  const timezone = log.timezone ?? branch.timezone;
  const shift = log.shiftSnapshot ?? branch.shift;

  const checkInAt = checkInHHMM
    ? zonedTimeToUtc(log.dayKey, checkInHHMM, timezone)
    : log.checkIn?.at
      ? new Date(log.checkIn.at)
      : null;

  if (!checkInAt) {
    const error = new Error('A day needs a check-in time before it can be corrected.');
    error.code = 'failed-precondition';
    throw error;
  }

  let checkOutAt = null;
  if (checkOutHHMM) {
    checkOutAt = zonedTimeToUtc(log.dayKey, checkOutHHMM, timezone);
    /* A clock-out earlier than the clock-in means the shift ran past midnight —
       the normal case for a late close, not an error to reject. */
    if (checkOutAt.getTime() < checkInAt.getTime()) {
      checkOutAt = new Date(checkOutAt.getTime() + 86_400_000);
    }
  }

  const computed = computeWorkSession({
    checkInAt,
    checkOutAt,
    shift,
    timeZone: timezone,
    overtimeRequested,
  });

  const stamp = (existing, at) =>
    at
      ? {
          ...(existing ?? {}),
          at: at.toISOString(),
          method: existing?.method ?? 'admin-edit',
          verifiedBy: 'admin-edit',
        }
      : null;

  return amendLog(
    log.id,
    {
      checkIn: stamp(log.checkIn, checkInAt),
      checkOut: stamp(log.checkOut, checkOutAt),
      status: computed.status,
      minutes: minutesOf(computed),
      overtime: computed.overtime,
    },
    { actor, reason },
  );
}

/**
 * Correct a mis-punch. The previous values are kept on the record rather than
 * overwritten — an attendance log that can be silently rewritten is not
 * evidence of anything.
 */
export async function amendLog(logId, patch, { actor, reason }) {
  const snapshot = await getDoc(attendanceDoc(logId));
  if (!snapshot.exists()) throw new Error('Log not found');

  const previous = snapshot.data();
  await updateDoc(attendanceDoc(logId), {
    ...patch,
    edited: {
      by: actor.uid,
      byName: actor.displayName ?? actor.email ?? actor.uid,
      at: new Date().toISOString(),
      reason,
      previous: {
        checkIn: previous.checkIn ?? null,
        checkOut: previous.checkOut ?? null,
        minutes: previous.minutes ?? null,
        overtime: previous.overtime ?? null,
      },
    },
    updatedAt: serverTimestamp(),
  });
}
