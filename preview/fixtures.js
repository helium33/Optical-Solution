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

/* Deterministic, so the preview shows the same history on every reload —
   a dashboard whose numbers reshuffle on refresh is impossible to judge. */
const seeded = (seed) => {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
};

/**
 * A month of plausible history, so the admin dashboard and the personal
 * dashboard have something to show.
 *
 * Without it the preview held only today's punches, and a 30-day view read
 * "2% attendance" over a wall of grey — an accurate reading of the data and a
 * useless demonstration of the product.
 */
function buildHistory(now) {
  const random = seeded(20260912);
  const rows = [];
  const DAY = 24 * HOUR;

  for (let daysAgo = 30; daysAgo >= 1; daysAgo -= 1) {
    const dayDate = new Date(now - daysAgo * DAY);
    const dayKey = businessDayKey(dayDate, TZ);
    /* Sunday closed — an attendance chart with no weekly rhythm looks fake. */
    if (dayDate.getUTCDay() === 0) continue;

    for (const person of STAFF) {
      if (random() < 0.08) continue; // day off or absence

      const branchShift = BRANCHES[person.branchId].shift;
      const late = random() < 0.12;
      const lateBy = late ? 6 + Math.floor(random() * 22) : 0;
      const claimed = random() < 0.15;
      const overtimeMinutes = claimed ? 20 + Math.floor(random() * 100) : 0;

      const [startH, startM] = branchShift.start.split(':').map(Number);
      const checkInAt = new Date(
        Date.UTC(
          dayDate.getUTCFullYear(), dayDate.getUTCMonth(), dayDate.getUTCDate(),
          startH - 7, startM + lateBy,      // Yangon is UTC+6:30
        ),
      );
      const workedMinutes = 450 + Math.floor(random() * 20) + overtimeMinutes;
      const checkOutAt = new Date(checkInAt.getTime() + (workedMinutes + 60) * 60_000);

      rows.push({
        id: `${person.branchId}_${dayKey}_${person.id}`,
        branchId: person.branchId,
        staffId: person.id,
        staffName: person.name,
        role: person.role,
        dayKey,
        timezone: TZ,
        checkIn: punch(checkInAt, person.hasBiometrics ? 'biometric' : 'pin'),
        checkOut: punch(checkOutAt),
        status: late ? 'late' : 'on_time',
        minutes: {
          gross: workedMinutes + 60,
          break: 60,
          worked: workedMinutes,
          regular: workedMinutes - overtimeMinutes,
          overtime: overtimeMinutes,
          overtimeHours: overtimeMinutes > 0 ? Math.ceil(overtimeMinutes / 60) : 0,
          late: lateBy,
          earlyLeave: 0,
        },
        overtime: {
          claimed,
          eligibleMinutes: overtimeMinutes,
          grantedMinutes: overtimeMinutes,
          billedHours: overtimeMinutes > 0 ? Math.ceil(overtimeMinutes / 60) : 0,
          capped: false,
          reason: null,
        },
        shiftSnapshot: branchShift,
        createdAt: checkInAt.toISOString(),
        updatedAt: checkOutAt.toISOString(),
      });
    }
  }
  return rows;
}

export function buildAttendance() {
  const now = Date.now();
  const rows = buildHistory(now);

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
