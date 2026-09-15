/**
 * Logic tests for the three modules that decide whether someone gets paid:
 * geofencing, IP allowlisting, and the shift/overtime calculator.
 *
 * Run with `npm run test:logic`. Deliberately dependency-free — plain asserts
 * bundled by esbuild and executed by node, so there is no test framework to
 * keep in step with the app.
 */
import assert from 'node:assert/strict';

import { haversineMeters, evaluateFence, FENCE, formatDistance } from '../lib/geo';
import { ipv4ToInt, matchesCidr, ipMatchesAny, evaluateNetwork, NETWORK } from '../lib/network';
import {
  businessDayKey,
  zonedTimeToUtc,
  shiftWindow,
  computeWorkSession,
  formatDuration,
  toDecimalHours,
  minutesToBilledHours,
  dayKeyRange,
  ATTENDANCE_STATUS,
} from '../lib/time';
import { workingDaysInMonth, summariseMonth } from '../lib/monthly';
import { formatMonth } from '../i18n/months';
import { BRANCHES } from '../config/branches';

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    results.push(['ok', name]);
  } catch (error) {
    failed += 1;
    results.push(['FAIL', `${name}\n         ${error.message.split('\n')[0]}`]);
  }
}

const TZ = 'Asia/Yangon';
const WIN = BRANCHES.win;
const SHIFT = WIN.shift; // 09:00-17:30, grace 10, break 60 over 5h, OT grace 15, cap 300

/** Offset a latitude by roughly N metres north. */
const metresNorth = (lat, metres) => lat + metres / 111132.95;

/* ============================== geo =================================== */

test('haversine: identical points are 0 m apart', () => {
  assert.equal(haversineMeters({ lat: 21.9588, lng: 96.0891 }, { lat: 21.9588, lng: 96.0891 }), 0);
});

test('haversine: 0.001 deg of longitude at the equator is ~111 m', () => {
  const d = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 0.001 });
  assert.ok(Math.abs(d - 111.3) < 0.5, `expected ~111.3 m, got ${d}`);
});

test('haversine: known long-haul distance (Yangon to Mandalay ~570 km)', () => {
  const d = haversineMeters({ lat: 16.8409, lng: 96.1735 }, { lat: 21.9588, lng: 96.0891 });
  assert.ok(d > 560000 && d < 580000, `got ${Math.round(d / 1000)} km`);
});

test('haversine: rejects garbage instead of returning 0', () => {
  assert.ok(Number.isNaN(haversineMeters({ lat: 'x', lng: 1 }, { lat: 2, lng: 3 })));
});

test('fence: standing on the shop pin is INSIDE', () => {
  const r = evaluateFence(
    { latitude: WIN.geofence.lat, longitude: WIN.geofence.lng, accuracy: 8 },
    WIN.geofence,
  );
  assert.equal(r.verdict, FENCE.INSIDE);
  assert.equal(r.inside, true);
  assert.ok(r.distance < 1);
});

test('fence: 40 m away is INSIDE the 50 m radius', () => {
  const r = evaluateFence(
    { latitude: metresNorth(WIN.geofence.lat, 40), longitude: WIN.geofence.lng, accuracy: 10 },
    WIN.geofence,
  );
  assert.equal(r.verdict, FENCE.INSIDE);
  assert.ok(Math.abs(r.distance - 40) < 1, `distance ${r.distance}`);
});

test('fence: 65 m away is OUTSIDE, and reports the overshoot', () => {
  const r = evaluateFence(
    { latitude: metresNorth(WIN.geofence.lat, 65), longitude: WIN.geofence.lng, accuracy: 10 },
    WIN.geofence,
  );
  assert.equal(r.verdict, FENCE.OUTSIDE);
  assert.equal(r.inside, false);
  assert.ok(Math.abs(r.overshootMeters - 15) < 1, `overshoot ${r.overshootMeters}`);
});

test('fence: a +/-500 m indoor fix is IMPRECISE, not a silent pass', () => {
  const r = evaluateFence(
    { latitude: WIN.geofence.lat, longitude: WIN.geofence.lng, accuracy: 500 },
    WIN.geofence,
  );
  assert.equal(r.verdict, FENCE.IMPRECISE);
  assert.equal(r.inside, false);
  assert.equal(r.requiredAccuracy, 65);
});

test('fence: an inside fix straddling the line is flagged borderline', () => {
  const r = evaluateFence(
    { latitude: metresNorth(WIN.geofence.lat, 48), longitude: WIN.geofence.lng, accuracy: 20 },
    WIN.geofence,
  );
  assert.equal(r.verdict, FENCE.INSIDE);
  assert.equal(r.borderline, true);
});

test('fence: no position yet is UNKNOWN', () => {
  assert.equal(evaluateFence(null, WIN.geofence).verdict, FENCE.UNKNOWN);
});

test('formatDistance switches to km past 1000 m', () => {
  assert.equal(formatDistance(42.4), '42 m');
  assert.equal(formatDistance(1440), '1.4 km');
  assert.equal(formatDistance(NaN), '—');
});

/* ============================ network ================================= */

test('ipv4ToInt handles the high half without sign overflow', () => {
  // The classic bug: `<<` is signed 32-bit, so 200.x.x.x comes out negative.
  assert.equal(ipv4ToInt('0.0.0.0'), 0);
  assert.equal(ipv4ToInt('255.255.255.255'), 4294967295);
  assert.ok(ipv4ToInt('200.0.0.1') > 0);
});

test('ipv4ToInt rejects malformed input', () => {
  assert.equal(ipv4ToInt('256.0.0.1'), null);
  assert.equal(ipv4ToInt('10.0.0'), null);
  assert.equal(ipv4ToInt('hello'), null);
});

test('CIDR: the Win branch /20 matches its own range only', () => {
  assert.equal(matchesCidr('203.81.64.5', '203.81.64.0/20'), true);
  assert.equal(matchesCidr('203.81.79.255', '203.81.64.0/20'), true);
  assert.equal(matchesCidr('203.81.80.0', '203.81.64.0/20'), false);
});

test('CIDR: high-octet ranges match (regression for signed shift)', () => {
  assert.equal(matchesCidr('200.1.2.3', '200.0.0.0/8'), true);
  assert.equal(matchesCidr('201.1.2.3', '200.0.0.0/8'), false);
});

test('CIDR: a bare address is an exact match', () => {
  assert.equal(matchesCidr('10.0.0.1', '10.0.0.1'), true);
  assert.equal(matchesCidr('10.0.0.2', '10.0.0.1'), false);
});

test('CIDR: /0 matches everything, /32 matches one', () => {
  assert.equal(matchesCidr('8.8.8.8', '0.0.0.0/0'), true);
  assert.equal(matchesCidr('8.8.8.8', '8.8.8.8/32'), true);
  assert.equal(matchesCidr('8.8.8.9', '8.8.8.8/32'), false);
});

test('CIDR: IPv6 prefixes compare correctly', () => {
  assert.equal(matchesCidr('2001:db8::1', '2001:db8::/32'), true);
  assert.equal(matchesCidr('2001:db9::1', '2001:db8::/32'), false);
  assert.equal(matchesCidr('2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8::/32'), true);
});

test('CIDR: IPv4-mapped IPv6 is understood', () => {
  assert.equal(matchesCidr('::ffff:192.0.2.1', '::ffff:192.0.2.0/120'), true);
});

test('CIDR: an address family mismatch is a miss, not a crash', () => {
  assert.equal(matchesCidr('2001:db8::1', '203.81.64.0/20'), false);
  assert.equal(matchesCidr('203.81.64.5', '2001:db8::/32'), false);
});

test('ipMatchesAny scans the whole allowlist', () => {
  assert.equal(ipMatchesAny('10.0.0.5', ['203.81.64.0/20', '10.0.0.0/24']), true);
  assert.equal(ipMatchesAny('172.16.0.5', ['203.81.64.0/20', '10.0.0.0/24']), false);
});

test('evaluateNetwork distinguishes match / mismatch / unknown / skipped', () => {
  assert.equal(evaluateNetwork('203.81.64.5', WIN.network).verdict, NETWORK.MATCH);
  assert.equal(evaluateNetwork('1.2.3.4', WIN.network).verdict, NETWORK.MISMATCH);
  assert.equal(evaluateNetwork(null, WIN.network).verdict, NETWORK.UNKNOWN);
  assert.equal(evaluateNetwork('1.2.3.4', { allowedCidrs: [] }).verdict, NETWORK.SKIPPED);
});

/* ============================== time ================================== */

test('businessDayKey uses branch-local midnight, not the viewer clock', () => {
  // 18:00 UTC is already 00:30 the next day in Yangon (UTC+06:30).
  assert.equal(businessDayKey(new Date('2026-09-11T18:00:00Z'), TZ), '2026-09-12');
  assert.equal(businessDayKey(new Date('2026-09-11T17:00:00Z'), TZ), '2026-09-11');
});

test('zonedTimeToUtc maps 09:00 Yangon to 02:30 UTC', () => {
  assert.equal(zonedTimeToUtc('2026-09-11', '09:00', TZ).toISOString(), '2026-09-11T02:30:00.000Z');
});

test('shiftWindow: a day shift spans 510 min, 450 after the break', () => {
  const w = shiftWindow('2026-09-11', SHIFT, TZ);
  assert.equal(w.overnight, false);
  assert.equal(w.spanMinutes, 510);
  assert.equal(w.expectedMinutes, 450);
});

test('shiftWindow: an end before the start rolls over midnight', () => {
  const w = shiftWindow('2026-09-11', { ...SHIFT, start: '22:00', end: '06:00' }, TZ);
  assert.equal(w.overnight, true);
  assert.equal(w.spanMinutes, 480);
});

const session = (inHm, outHm, overtimeRequested = false, extra = {}) =>
  computeWorkSession({
    checkInAt: zonedTimeToUtc('2026-09-11', inHm, TZ),
    checkOutAt: outHm ? zonedTimeToUtc(extra.outDay ?? '2026-09-11', outHm, TZ) : null,
    shift: SHIFT,
    timeZone: TZ,
    overtimeRequested,
    now: extra.now,
  });

test('a clean on-time day: break deducted, no overtime', () => {
  const s = session('08:55', '17:30');
  assert.equal(s.status, ATTENDANCE_STATUS.ON_TIME);
  assert.equal(s.grossMinutes, 515);
  assert.equal(s.breakMinutes, 60);
  assert.equal(s.workedMinutes, 455);
  assert.equal(s.overtimeMinutes, 0);
  assert.equal(s.regularMinutes, 455);
  assert.equal(s.lateMinutes, 0);
});

test('the 10-minute grace absorbs a slightly late arrival', () => {
  const s = session('09:08', '17:30');
  assert.equal(s.lateMinutes, 0);
  assert.equal(s.status, ATTENDANCE_STATUS.ON_TIME);
});

test('past the grace, lateness is counted from the scheduled start', () => {
  const s = session('09:25', '17:30');
  assert.equal(s.lateMinutes, 15); // 25 late, 10 forgiven
  assert.equal(s.status, ATTENDANCE_STATUS.LATE);
});

test('OVERTIME: claimed and past the shift end is granted', () => {
  const s = session('09:00', '19:00', true);
  assert.equal(s.overtime.claimed, true);
  assert.equal(s.overtime.eligibleMinutes, 90);
  assert.equal(s.overtimeMinutes, 90);
  assert.equal(s.workedMinutes, 540); // 600 gross - 60 break
  assert.equal(s.regularMinutes, 450); // never double-counted
  assert.equal(s.regularMinutes + s.overtimeMinutes, s.workedMinutes);
});

test('OVERTIME: staying late WITHOUT claiming pays no overtime', () => {
  const s = session('09:00', '19:00', false);
  assert.equal(s.overtimeMinutes, 0);
  assert.equal(s.overtime.reason, 'not-claimed');
  assert.equal(s.regularMinutes, 540);
});

test('OVERTIME: a claim inside the grace window is refused with a reason', () => {
  const s = session('09:00', '17:40', true);
  assert.equal(s.overtimeMinutes, 0);
  assert.equal(s.overtime.claimed, true);
  assert.equal(s.overtime.reason, 'within-grace-window');
});

test('OVERTIME: leaving early cannot produce a claim', () => {
  const s = session('09:00', '16:00', true);
  assert.equal(s.overtimeMinutes, 0);
  assert.equal(s.overtime.reason, 'not-past-shift-end');
  assert.equal(s.earlyLeaveMinutes, 90);
});

test('OVERTIME: arriving early is not overtime', () => {
  const s = session('07:00', '17:30', true);
  assert.equal(s.overtimeMinutes, 0);
  assert.equal(s.overtime.reason, 'not-past-shift-end');
});

test('OVERTIME: a forgotten clock-out is capped and flagged for review', () => {
  const s = session('09:00', '02:00', true, { outDay: '2026-09-12' });
  assert.equal(s.overtime.eligibleMinutes, 510);
  assert.equal(s.overtimeMinutes, 300); // the cap
  assert.equal(s.overtime.capped, true);
  assert.equal(s.overtime.reason, 'capped-pending-review');
});

test('an open session reports INCOMPLETE and defers overtime', () => {
  const s = session('09:00', null, true, { now: zonedTimeToUtc('2026-09-11', '14:00', TZ) });
  assert.equal(s.open, true);
  assert.equal(s.status, ATTENDANCE_STATUS.INCOMPLETE);
  assert.equal(s.overtime.reason, 'session-open');
  assert.equal(s.grossMinutes, 300);
});

test('a short visit does not have the unpaid break deducted', () => {
  const s = session('09:00', '11:00');
  assert.equal(s.breakMinutes, 0);
  assert.equal(s.workedMinutes, 120);
});

test('a clock-out before the clock-in is rejected, not negative', () => {
  const s = session('17:00', '09:00');
  assert.equal(s.invalid, true);
  assert.equal(s.workedMinutes, 0);
  assert.equal(s.overtimeMinutes, 0);
});

test('OVERTIME: paid in whole hours, always rounded up', () => {
  assert.equal(minutesToBilledHours(0), 0);
  assert.equal(minutesToBilledHours(1), 1);
  assert.equal(minutesToBilledHours(30), 1);   // the rule as stated
  assert.equal(minutesToBilledHours(59), 1);
  assert.equal(minutesToBilledHours(60), 1);
  assert.equal(minutesToBilledHours(61), 2);
  assert.equal(minutesToBilledHours(120), 2);
  assert.equal(minutesToBilledHours(121), 3);
});

test('OVERTIME: a 90-minute evening is paid as 2 hours', () => {
  const s = session('09:00', '19:00', true);
  assert.equal(s.overtimeMinutes, 90);  // what was worked
  assert.equal(s.overtimeHours, 2);     // what gets paid
  assert.equal(s.overtime.billedHours, 2);
});

test('OVERTIME: 30 minutes over is paid as a full hour', () => {
  const s = session('09:00', '18:00', true);
  assert.equal(s.overtime.eligibleMinutes, 30);
  assert.equal(s.overtimeHours, 1);
});

test('OVERTIME: rounding up never eats into regular hours', () => {
  const s = session('09:00', '18:00', true);
  // regular is reduced by the 30 minutes actually worked, not the billed hour
  assert.equal(s.regularMinutes, s.workedMinutes - s.overtimeMinutes);
  assert.ok(s.regularMinutes > 0);
});

test('OVERTIME: an unclaimed late finish bills zero hours', () => {
  const s = session('09:00', '19:00', false);
  assert.equal(s.overtimeHours, 0);
  assert.equal(s.overtime.billedHours, 0);
});

test('formatDuration reads like a timesheet', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(75), '1h 15m');
  assert.equal(formatDuration(480), '8h');
  assert.equal(formatDuration(NaN), '—');
});

test('toDecimalHours is payroll-safe to 2dp', () => {
  assert.equal(toDecimalHours(495), 8.25);
  assert.equal(toDecimalHours(90), 1.5);
});

test('dayKeyRange is inclusive and crosses month ends', () => {
  assert.deepEqual(dayKeyRange('2026-08-30', '2026-09-02'), [
    '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
  ]);
  assert.equal(dayKeyRange('2026-09-01', '2026-09-30').length, 30);
});

/* ======================== monthly summary ============================= */

/* Fixed "now" so these never drift: 2026-09-12 is a Saturday. */
const SEPT_12 = new Date('2026-09-12T06:00:00Z');

const staff = (id, name) => ({ id, name, role: 'sales_associate', branchId: 'win' });

const row = (staffId, dayKey, extra = {}) => ({
  staffId,
  dayKey,
  branchId: 'win',
  checkIn: { at: `${dayKey}T02:30:00Z` },
  status: ATTENDANCE_STATUS.ON_TIME,
  minutes: { worked: 450, late: 0, overtime: 0 },
  ...extra,
});

test('MONTHLY: working days exclude Sundays', () => {
  const days = workingDaysInMonth('2026-09', { timeZone: TZ, now: SEPT_12 });
  /* 1 Sep 2026 is a Tuesday. Sundays in range: the 6th. */
  assert.ok(!days.includes('2026-09-06'));
  assert.ok(days.includes('2026-09-05'));
  assert.equal(days.length, 11); // 1-12 inclusive, minus one Sunday
});

test('MONTHLY: the rest of the month is not counted as absence', () => {
  const days = workingDaysInMonth('2026-09', { timeZone: TZ, now: SEPT_12 });
  assert.equal(days.at(-1), '2026-09-12');
  assert.ok(!days.includes('2026-09-13'));
});

test('MONTHLY: a past month counts all of its working days', () => {
  const days = workingDaysInMonth('2026-08', { timeZone: TZ, now: SEPT_12 });
  assert.equal(days.length, 26); // 31 days, 5 Sundays in August 2026
});

test('MONTHLY: present and absent days are complementary', () => {
  const summary = summariseMonth({
    rows: [row('a', '2026-09-01'), row('a', '2026-09-02'), row('a', '2026-09-03')],
    roster: [staff('a', 'Aye')],
    month: '2026-09',
    timeZone: TZ,
    now: SEPT_12,
  });
  const [person] = summary;
  assert.equal(person.presentDays, 3);
  assert.equal(person.expectedWorkingDays, 11);
  assert.equal(person.absentDays, 8);
});

test('MONTHLY: somebody absent all month still appears, with zero present', () => {
  const summary = summariseMonth({
    rows: [],
    roster: [staff('a', 'Aye'), staff('b', 'Bo')],
    month: '2026-09',
    timeZone: TZ,
    now: SEPT_12,
  });
  assert.equal(summary.length, 2);
  assert.equal(summary[1].presentDays, 0);
  assert.equal(summary[1].absentDays, 11);
});

test('MONTHLY: overtime hours are rounded per day, never on the total', () => {
  /* Two 30-minute evenings. Summed first and rounded once that is 1 hour;
     rounded per day, as the shop pays it, it is 2. */
  const summary = summariseMonth({
    rows: [
      row('a', '2026-09-01', { minutes: { worked: 480, late: 0, overtime: 30 } }),
      row('a', '2026-09-02', { minutes: { worked: 480, late: 0, overtime: 30 } }),
    ],
    roster: [staff('a', 'Aye')],
    month: '2026-09',
    timeZone: TZ,
    now: SEPT_12,
  });
  assert.equal(summary[0].overtimeMinutes, 60);
  assert.equal(summary[0].overtimeHours, 2);
});

test('MONTHLY: a stored overtimeHours is trusted over re-deriving it', () => {
  /* The clock-out already billed this day. Recomputing from minutes would
     silently disagree with the payslip the person was given. */
  const summary = summariseMonth({
    rows: [row('a', '2026-09-01', { minutes: { worked: 480, overtime: 90, overtimeHours: 2 } })],
    roster: [staff('a', 'Aye')],
    month: '2026-09',
    timeZone: TZ,
    now: SEPT_12,
  });
  assert.equal(summary[0].overtimeHours, 2);
});

test('MONTHLY: late days and late minutes accumulate separately', () => {
  const summary = summariseMonth({
    rows: [
      row('a', '2026-09-01', { status: ATTENDANCE_STATUS.LATE, minutes: { worked: 440, late: 12, overtime: 0 } }),
      row('a', '2026-09-02', { status: ATTENDANCE_STATUS.LATE, minutes: { worked: 445, late: 7, overtime: 0 } }),
      row('a', '2026-09-03'),
    ],
    roster: [staff('a', 'Aye')],
    month: '2026-09',
    timeZone: TZ,
    now: SEPT_12,
  });
  assert.equal(summary[0].lateDays, 2);
  assert.equal(summary[0].lateMinutes, 19);
  assert.equal(summary[0].presentDays, 3);
});

test('MONTHLY: a row with no clock-in is not a present day', () => {
  /* An admin-created placeholder, or a write that failed halfway. Counting it
     would mark somebody present who never turned up. */
  const summary = summariseMonth({
    rows: [{ staffId: 'a', dayKey: '2026-09-01', branchId: 'win', checkIn: null, minutes: {} }],
    roster: [staff('a', 'Aye')],
    month: '2026-09',
    timeZone: TZ,
    now: SEPT_12,
  });
  assert.equal(summary[0].presentDays, 0);
});

test('MONTHLY: rows for somebody off the roster are ignored, not crashed on', () => {
  const summary = summariseMonth({
    rows: [row('ghost', '2026-09-01'), row('a', '2026-09-01')],
    roster: [staff('a', 'Aye')],
    month: '2026-09',
    timeZone: TZ,
    now: SEPT_12,
  });
  assert.equal(summary.length, 1);
  assert.equal(summary[0].presentDays, 1);
});

test('MONTHLY: absent days never go negative', () => {
  /* Two branches, one person, both rows land on the same staffId — or simply
     more punches than expected days. The figure floors at zero. */
  const rows = Array.from({ length: 20 }, (_, i) =>
    row('a', `2026-09-${String(i + 1).padStart(2, '0')}`),
  );
  const summary = summariseMonth({
    rows,
    roster: [staff('a', 'Aye')],
    month: '2026-09',
    timeZone: TZ,
    now: SEPT_12,
  });
  assert.equal(summary[0].absentDays, 0);
});

test('MONTHLY: the month heading is Burmese without trusting browser ICU', () => {
  /* Chromium builds with small-icu resolve 'my-MM' to en-US and hand back
     "September 2026" to a reader who asked for Burmese. */
  assert.equal(formatMonth('2026-09', 'my'), 'စက်တင်ဘာ 2026');
  assert.equal(formatMonth('2026-01', 'my-MM'), 'ဇန်နဝါရီ 2026');
  assert.equal(formatMonth('2026-12', 'en'), 'December 2026');
});

/* ============================= report ================================= */

for (const [mark, name] of results) {
  console.log(`  ${mark.padEnd(4)}  ${name}`);
}
console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed === 0 ? 0 : 1);
