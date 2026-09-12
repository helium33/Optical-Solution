import { getDocs, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { functions } from '../config/firebase';
import { attendanceCol } from './paths';
import { ATTENDANCE_STATUS, minutesToBilledHours } from '../lib/time';

/**
 * A staff member's own figures, opened with their personal PIN.
 *
 * PRIVACY NOTE, because this is the one place it is easy to get wrong.
 *
 * The kiosk token can read its whole branch — it has to, or the roster would
 * not render. That means a client-side "filter to my own rows" is a display
 * convention, not a boundary: anyone with devtools on the shop tablet could
 * read a colleague's hours.
 *
 * So the supported path is the `getStaffSummary` callable, which verifies the
 * PIN server-side and returns only that person's tallies — the other rows never
 * reach the device. The fallback below exists so the screen works before the
 * function is deployed, and it is honest about what it is: it reads the branch
 * and filters locally. Do not leave a real shop running on it.
 */

const callVerifyStaffPin = httpsCallable(functions, 'verifyStaffPin');
const callGetStaffSummary = httpsCallable(functions, 'getStaffSummary');

const ALLOW_CLIENT_FALLBACK = import.meta.env.VITE_ALLOW_CLIENT_PUNCH === 'true';

/* ──────────────────────────── identity ────────────────────────────────── */

/**
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function verifyStaffPin({ branchId, staffId, pin }) {
  try {
    const response = await callVerifyStaffPin({ branchId, staffId, pin });
    return response.data;
  } catch (error) {
    if (ALLOW_CLIENT_FALLBACK && error?.code === 'functions/not-found') {
      console.warn(
        '[attendance] verifyStaffPin is not deployed — the personal dashboard is opening ' +
          'WITHOUT checking the PIN. Development only.',
      );
      return { ok: true, unverified: true };
    }
    if (error?.code === 'functions/permission-denied') return { ok: false, reason: 'wrong-pin' };
    if (error?.code === 'functions/resource-exhausted') return { ok: false, reason: 'rate-limited' };
    return { ok: false, reason: 'unavailable' };
  }
}

/* ──────────────────────────── the figures ─────────────────────────────── */

/**
 * Reduce a set of attendance rows to the three numbers a staff member asks for.
 *
 * Exported separately from the fetch so it can be unit-tested and so the Cloud
 * Function can use the identical reduction — the figure on the kiosk and the
 * figure in a payroll export should never come from two implementations.
 */
export function summariseRows(rows) {
  let presentDays = 0;
  let lateDays = 0;
  let lateMinutes = 0;
  let overtimeMinutes = 0;
  let workedMinutes = 0;

  /* One document per person per business day, so a day is a row. */
  for (const row of rows) {
    if (!row.checkIn?.at) continue;
    presentDays += 1;
    if (row.status === ATTENDANCE_STATUS.LATE) lateDays += 1;
    lateMinutes += row.minutes?.late ?? 0;
    overtimeMinutes += row.minutes?.overtime ?? 0;
    workedMinutes += row.minutes?.worked ?? 0;
  }

  return {
    presentDays,
    lateDays,
    lateMinutes,
    workedMinutes,
    overtimeMinutes,
    /* Overtime is paid in whole hours, and the total is the sum of each day's
       rounded-up hours — not the rounding of the summed minutes. Two evenings
       of 30 minutes are two paid hours, not one, because each was rounded when
       it was worked. Summing first would quietly shorten the payslip. */
    overtimeHours: rows.reduce(
      (total, row) => total + minutesToBilledHours(row.minutes?.overtime ?? 0),
      0,
    ),
  };
}

export async function fetchStaffSummary({ branchId, staffId, fromKey, toKey }) {
  try {
    const response = await callGetStaffSummary({ branchId, staffId, fromKey, toKey });
    return response.data;
  } catch (error) {
    if (!(ALLOW_CLIENT_FALLBACK && error?.code === 'functions/not-found')) throw error;

    console.warn(
      '[attendance] getStaffSummary is not deployed — reading the branch and filtering ' +
        'locally. Other people’s rows reach this device on this path. Development only.',
    );

    const snapshot = await getDocs(
      query(
        attendanceCol(),
        where('branchId', '==', branchId),
        where('dayKey', '>=', fromKey),
        where('dayKey', '<=', toKey),
        orderBy('dayKey', 'desc'),
      ),
    );

    const rows = snapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((row) => row.staffId === staffId);

    return { ...summariseRows(rows), rows, unverified: true };
  }
}
