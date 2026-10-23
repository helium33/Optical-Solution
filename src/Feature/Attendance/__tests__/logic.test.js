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
import { BRANCHES, BRANCH_PINS } from '../config/branches';
import { pickStaffMatch } from '../lib/pinMatch';
import { verifyPin, createPinRecord } from '../lib/crypto';
import {
  decodePlusCode,
  recoverPlusCode,
  parseLocationInput,
  isFullPlusCode,
  isPlusCodeish,
} from '../lib/plusCode';

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
  /* A fixture rather than a branch record. The shops no longer restrict by
     network, and hanging this off BRANCHES.win meant that policy change would
     have quietly deleted the coverage for the function itself — which still
     has to work for whoever re-enables a CIDR later. */
  const restricted = { allowedCidrs: ['203.81.64.0/20'], enforce: true };
  assert.equal(evaluateNetwork('203.81.64.5', restricted).verdict, NETWORK.MATCH);
  assert.equal(evaluateNetwork('1.2.3.4', restricted).verdict, NETWORK.MISMATCH);
  assert.equal(evaluateNetwork(null, restricted).verdict, NETWORK.UNKNOWN);
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

/* ============================ plus codes =============================== */

/* The reference locality the shop codes were quoted against. A short code
   names a cell in every 1-degree block on Earth; this says which one. */
const MUSE = { lat: 23.995407, lng: 97.900507 };

test('PLUSCODE: a full code decodes to the published cell centre', () => {
  /* Google's decoding.csv row for this code:
       7FG49QCJ+2VX,11,20.3701,2.78221875,20.370125,2.78225
     so the cell centre is the midpoint of those bounds. */
  const area = decodePlusCode('7FG49QCJ+2VX');
  assert.ok(Math.abs(area.lat - (20.3701 + 20.370125) / 2) < 1e-9, `lat ${area.lat}`);
  assert.ok(Math.abs(area.lng - (2.78221875 + 2.78225) / 2) < 1e-9, `lng ${area.lng}`);
});

test('PLUSCODE: grid rows and columns are not interchangeable', () => {
  /* 5 north-south, 4 east-west. Swapping them yields a plausible-looking code
     that lands tens of metres away, which is the whole bug class this guards. */
  const a = decodePlusCode('7MMVXWW2+45W');
  const b = decodePlusCode('7MMVXWW2+45X');
  assert.ok(a.lat !== b.lat || a.lng !== b.lng);
  assert.ok(Math.abs(a.latSpan - 1 / 8000 / 5) < 1e-12, `latSpan ${a.latSpan}`);
  assert.ok(Math.abs(a.lngSpan - 1 / 8000 / 4) < 1e-12, `lngSpan ${a.lngSpan}`);
});

test('PLUSCODE: a short code is recovered against a nearby reference', () => {
  const area = recoverPlusCode('XWW2+45W', MUSE);
  assert.ok(Math.abs(area.lat - BRANCH_PINS.pwint.lat) < 1e-7, `lat ${area.lat}`);
  assert.ok(Math.abs(area.lng - BRANCH_PINS.pwint.lng) < 1e-7, `lng ${area.lng}`);
});

test('PLUSCODE: the shop codes resolve to the pins in the config', () => {
  /* The config stores decimals; these are the codes they came from. If someone
     edits one without the other, this is what notices. */
  for (const [id, short] of [
    ['win', 'XVVX+GW3'],
    ['pwint', 'XWW2+45W'],
    ['yangon', 'XWW2+QJC'],
  ]) {
    const area = recoverPlusCode(short, MUSE);
    assert.ok(
      Math.abs(area.lat - BRANCHES[id].geofence.lat) < 1e-7 &&
        Math.abs(area.lng - BRANCHES[id].geofence.lng) < 1e-7,
      `${id}: code gives ${area.lat},${area.lng} but config has ${BRANCHES[id].geofence.lat},${BRANCHES[id].geofence.lng}`,
    );
  }
});

test('PLUSCODE: the locality suffix people actually paste is tolerated', () => {
  const withComma = recoverPlusCode('XWW2+45W, Muse', MUSE);
  const withSpace = recoverPlusCode('XWW2+45W Muse', MUSE);
  const bare = recoverPlusCode('XWW2+45W', MUSE);
  assert.equal(withComma.lat, bare.lat);
  assert.equal(withSpace.lat, bare.lat);
  assert.equal(withComma.lng, bare.lng);
});

test('PLUSCODE: full and short codes are told apart', () => {
  assert.equal(isFullPlusCode('7MMVXWW2+45W'), true);
  assert.equal(isFullPlusCode('XWW2+45W'), false);
  assert.equal(isPlusCodeish('XWW2+45W'), true);
  assert.equal(isPlusCodeish('23.99, 97.90'), false);
  /* 'A' and 'B' are not in the alphabet — a typo must not become a location. */
  assert.equal(isPlusCodeish('XWWA+45B'), false);
});

test('PLUSCODE: one field takes either a code or decimals', () => {
  const code = parseLocationInput('XWW2+45W, Muse', MUSE);
  assert.equal(code.source, 'plus-code');
  assert.ok(Math.abs(code.lat - BRANCH_PINS.pwint.lat) < 1e-7);

  const decimals = parseLocationInput('23.9953625, 97.9004531', MUSE);
  assert.equal(decimals.source, 'coordinates');
  assert.equal(decimals.lat, 23.9953625);

  assert.equal(parseLocationInput('', MUSE), null);
  assert.equal(parseLocationInput('not a place', MUSE), null);
  /* Out of range must be refused, not clamped into somewhere real. */
  assert.equal(parseLocationInput('99, 200', MUSE), null);
});

/* ========================= branch geofences ============================ */

test('BRANCHES: every shop has its own pin, 50 m, and no network rule', () => {
  for (const id of ['win', 'pwint', 'yangon']) {
    const { geofence, network } = BRANCHES[id];
    assert.ok(Number.isFinite(geofence.lat) && Number.isFinite(geofence.lng), id);
    assert.equal(geofence.radiusMeters, 50, `${id} radius`);
    /* "Any network" is an empty allowlist — the configured not-applicable
       path, which makes useGeoFence skip the IP lookup altogether. */
    assert.deepEqual(network.allowedCidrs, [], `${id} allowlist`);
    assert.equal(network.enforce, false, `${id} enforce`);
    assert.equal(evaluateNetwork(null, network).verdict, NETWORK.SKIPPED, id);
    assert.equal(evaluateNetwork('8.8.8.8', network).verdict, NETWORK.SKIPPED, id);
  }
});

test('BRANCHES: the three 50 m fences do not overlap', () => {
  /* While all three shared a pin, standing in one shop satisfied the fence for
     all of them. Two radii must not reach each other. */
  const ids = ['win', 'pwint', 'yangon'];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = BRANCHES[ids[i]].geofence;
      const b = BRANCHES[ids[j]].geofence;
      const gap = haversineMeters(a, b) - a.radiusMeters - b.radiusMeters;
      assert.ok(gap > 0, `${ids[i]} and ${ids[j]} overlap by ${Math.round(-gap)} m`);
    }
  }
});

test('BRANCHES: standing at one shop fails the other two fences', () => {
  const atPwint = { latitude: BRANCH_PINS.pwint.lat, longitude: BRANCH_PINS.pwint.lng, accuracy: 12 };
  assert.equal(evaluateFence(atPwint, BRANCHES.pwint.geofence).verdict, FENCE.INSIDE);
  assert.equal(evaluateFence(atPwint, BRANCHES.win.geofence).verdict, FENCE.OUTSIDE);
  assert.equal(evaluateFence(atPwint, BRANCHES.yangon.geofence).verdict, FENCE.OUTSIDE);
});

/* ========================= kiosk PIN matching ========================== */

/* Fictional people and PINs. This repository is public: real staff and the
   PINs they use must never appear in it, not even in a test. */
const ONE = { id: 'p1', name: 'Person One' };
const TWO = { id: 'p2', name: 'Person Two' };
const THREE = { id: 'p3', name: 'Person Three' };

test('PIN MATCH: exactly one match opens that person', () => {
  const r = pickStaffMatch([
    { person: ONE, ok: true },
    { person: TWO, ok: false },
    { person: THREE, ok: false },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.staff, ONE);
});

test('PIN MATCH: no match is a wrong PIN', () => {
  const r = pickStaffMatch([{ person: ONE, ok: false }, { person: TWO, ok: false }]);
  assert.deepEqual(r, { ok: false, reason: 'wrong-pin' });
  assert.deepEqual(pickStaffMatch([]), { ok: false, reason: 'wrong-pin' });
});

test('PIN MATCH: two people sharing a PIN is refused, never guessed', () => {
  /* Picking the first would clock somebody in as a colleague, and the screen
     would show nothing wrong. */
  const r = pickStaffMatch([
    { person: ONE, ok: true },
    { person: TWO, ok: true },
    { person: THREE, ok: false },
  ]);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'pin-ambiguous');
  assert.equal(r.count, 2);
  assert.equal(r.staff, undefined);
});

/* ============================= report ================================= */

/* Real PBKDF2 against three distinct PINs. Async, so it is awaited here
   rather than registered with the synchronous test() above. */
await (async () => {
  const name = 'PIN MATCH: real PBKDF2 picks the right person out of three';
  try {
    const people = await Promise.all(
      [[ONE, '4821'], [TWO, '5937'], [THREE, '6044']].map(async ([person, pin]) => ({
        person,
        record: await createPinRecord(pin),
      })),
    );
    const check = async (pin) =>
      pickStaffMatch(
        await Promise.all(
          people.map(async ({ person, record }) => ({ person, ok: await verifyPin(pin, record) })),
        ),
      );
    assert.equal((await check('4821')).staff, ONE);
    assert.equal((await check('5937')).staff, TWO);
    assert.equal((await check('6044')).staff, THREE);
    assert.equal((await check('0000')).reason, 'wrong-pin');
    passed += 1;
    results.push(['ok', name]);
  } catch (error) {
    failed += 1;
    results.push(['FAIL', `${name}\n         ${error.message.split('\n')[0]}`]);
  }
})();

for (const [mark, name] of results) {
  console.log(`  ${mark.padEnd(4)}  ${name}`);
}
console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed === 0 ? 0 : 1);
