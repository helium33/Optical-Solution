/**
 * Sample roster and punches for the offline preview.
 *
 * Times are computed relative to "now" so the preview is interesting whatever
 * hour it is opened. In particular one person is given a `shiftSnapshot` whose
 * end is an hour in the past — that is the real field the app freezes onto
 * every log, so the Overtime switch lights up with a genuine claimable figure
 * instead of "your shift has not finished yet".
 */
import { BRANCHES } from '../src/Feature/Attendance/config/branches';
import { businessDayKey } from '../src/Feature/Attendance/lib/time';

const TZ = 'Asia/Yangon';
const HOUR = 3600_000;

const hhmm = (date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(date);

export const STAFF = [
  { id: 'w1', branchId: 'win',    name: 'Aye Aye Mon',   role: 'supervisor',       employeeCode: 'WIN-001', hasBiometrics: true },
  { id: 'w2', branchId: 'win',    name: 'Thiri Khine',   role: 'sales_leader',     employeeCode: 'WIN-004' },
  { id: 'w3', branchId: 'win',    name: 'Kyaw Zin Latt', role: 'sales_executive',  employeeCode: 'WIN-009', hasBiometrics: true },
  { id: 'w4', branchId: 'win',    name: 'Nilar Win',     role: 'sales_associate',  employeeCode: 'WIN-012' },
  { id: 'w5', branchId: 'win',    name: 'Soe Moe Kyaw',  role: 'sales_associate',  employeeCode: 'WIN-015' },

  { id: 'p1', branchId: 'pwint',  name: 'May Thu Aung',  role: 'supervisor',       employeeCode: 'PWT-001', hasBiometrics: true },
  { id: 'p2', branchId: 'pwint',  name: 'Hnin Ei Phyu',  role: 'sales_leader',     employeeCode: 'PWT-003' },
  { id: 'p3', branchId: 'pwint',  name: 'Khin Myat Noe', role: 'sales_executive',  employeeCode: 'PWT-007' },
  { id: 'p4', branchId: 'pwint',  name: 'Su Su Hlaing',  role: 'sales_associate',  employeeCode: 'PWT-011' },

  { id: 'y1', branchId: 'yangon', name: 'Zaw Htet Naing', role: 'supervisor',      employeeCode: 'YGN-001' },
  { id: 'y2', branchId: 'yangon', name: 'Tun Tun Oo',     role: 'sales_leader',    employeeCode: 'YGN-002', hasBiometrics: true },
  { id: 'y3', branchId: 'yangon', name: 'Aung Ko Ko',     role: 'sales_executive', employeeCode: 'YGN-006' },
  { id: 'y4', branchId: 'yangon', name: 'Ei Mon Kyaw',    role: 'sales_associate', employeeCode: 'YGN-010' },
].map((person) => ({
  ...person,
  active: true,
  webauthnCredentialCount: person.hasBiometrics ? 1 : 0,
}));

/** A shift whose end is `endsAgoHours` in the past, expressed in branch time. */
const pastShift = (branchId, startedAgoHours, endsAgoHours) => {
  const base = BRANCHES[branchId].shift;
  return {
    ...base,
    start: hhmm(new Date(Date.now() - startedAgoHours * HOUR)),
    end: hhmm(new Date(Date.now() - endsAgoHours * HOUR)),
  };
};

const punch = (at, method = 'pin') => ({
  at: at.toISOString(),
  method,
  location: { lat: 21.9588, lng: 96.0891, accuracy: 11, distance: 7.2 },
  ip: '203.81.64.17',
  deviceId: 'preview-tablet',
  verifiedBy: 'preview-fixture',
});

export function buildAttendance() {
  const now = Date.now();
  const rows = [];

  const add = (staffId, branchId, { inAgo, outAgo = null, shift, status = 'on_time', overtime = 0 }) => {
    const person = STAFF.find((s) => s.id === staffId);
    const checkInAt = new Date(now - inAgo * HOUR);
    const dayKey = businessDayKey(checkInAt, TZ);
    const worked = outAgo == null ? 0 : Math.round((inAgo - outAgo) * 60) - 60;
    rows.push({
      id: `${branchId}_${dayKey}_${staffId}`,
      branchId,
      staffId,
      staffName: person.name,
      role: person.role,
      dayKey,
      timezone: TZ,
      checkIn: punch(checkInAt, person.hasBiometrics ? 'biometric' : 'pin'),
      checkOut: outAgo == null ? null : punch(new Date(now - outAgo * HOUR)),
      status: outAgo == null ? 'incomplete' : status,
      minutes: outAgo == null
        ? { gross: 0, break: 0, worked: 0, regular: 0, overtime: 0, late: 0, earlyLeave: 0 }
        : { gross: worked + 60, break: 60, worked, regular: worked - overtime, overtime, late: status === 'late' ? 18 : 0, earlyLeave: 0 },
      overtime: {
        claimed: overtime > 0,
        eligibleMinutes: overtime,
        grantedMinutes: overtime,
        capped: false,
        reason: null,
      },
      shiftSnapshot: shift ?? BRANCHES[branchId].shift,
      createdAt: checkInAt.toISOString(),
      updatedAt: checkInAt.toISOString(),
    });
  };

  /* WIN — the branch the preview opens on.
     w1 is the overtime demo: still on shift, but her shift ended an hour ago,
     so the Overtime switch offers a real ~1h claim. */
  add('w1', 'win', { inAgo: 9, shift: pastShift('win', 9, 1) });
  add('w2', 'win', { inAgo: 8.5, shift: pastShift('win', 8.5, 0.5) });
  add('w3', 'win', { inAgo: 8.2, outAgo: 0.4, status: 'late', shift: pastShift('win', 8.2, 0.4) });
  /* w4 and w5 have not clocked in — the "Not clocked in" state. */

  add('p1', 'pwint', { inAgo: 7, shift: pastShift('pwint', 7, 0.75) });
  add('p2', 'pwint', { inAgo: 6.8, outAgo: 0.2, shift: pastShift('pwint', 6.8, 0.2), overtime: 45 });

  add('y1', 'yangon', { inAgo: 6, shift: pastShift('yangon', 6, 1.2) });
  add('y2', 'yangon', { inAgo: 5.5, shift: pastShift('yangon', 5.5, 0.6) });

  return rows;
}

export const BRANCH_DOCS = Object.values(BRANCHES).map((branch) => ({
  ...branch,
  active: true,
}));
