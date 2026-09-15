import { ATTENDANCE_STATUS, minutesToBilledHours, businessDayKey } from './time';

/**
 * The arithmetic behind the monthly summary: expected days in, and the roll-up
 * of raw attendance rows into one row per person.
 *
 * Pure on purpose, and in `lib/` rather than `services/` for the same reason
 * every other calculator here is: these are the numbers a month's pay is read
 * off, so they must be testable without a Firebase project, a network, or a
 * clock that happens to be set to the right month.
 */

/* ───────────────────────── working days ───────────────────────────────── */

/**
 * How many days someone was expected in, so far this month.
 *
 * Sundays are excluded and nothing after today is counted — an "absent days"
 * figure that includes the rest of the month would climb all month and mean
 * nothing until the 31st.
 *
 * HONEST LIMITATION: without a shift-roster collection this cannot know about
 * a person's day off, annual leave or a public holiday. It counts Mon–Sat, so
 * a legitimate day off reads as an absence. The fix is a `schedules`
 * collection; until then the figure is "days not worked", and the UI says so.
 */
export function workingDaysInMonth(month, { timeZone = 'Asia/Yangon', now = new Date() } = {}) {
  const [year, monthNumber] = month.split('-').map(Number);
  const todayKey = businessDayKey(now, timeZone);
  const days = [];

  for (let day = 1; day <= 31; day += 1) {
    const date = new Date(Date.UTC(year, monthNumber - 1, day));
    if (date.getUTCMonth() !== monthNumber - 1) break; // rolled into next month
    if (date.getUTCDay() === 0) continue; // Sunday — shops closed
    const key = `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (key > todayKey) break; // the future is not an absence
    days.push(key);
  }
  return days;
}

/* ───────────────────────── the reduction ──────────────────────────────── */

/**
 * Roll raw attendance rows into one summary per person.
 *
 * @param rows   attendance documents for the month
 * @param roster the people who should appear, including those with no rows —
 *               somebody absent all month has no attendance records at all,
 *               and leaving them out would hide exactly the person you are
 *               looking for.
 */
export function summariseMonth({ rows, roster, month, timeZone = 'Asia/Yangon', now = new Date() }) {
  const expectedDays = workingDaysInMonth(month, { timeZone, now }).length;

  const byStaff = new Map(
    roster.map((person) => [
      person.id,
      {
        staffId: person.id,
        staffName: person.name,
        role: person.role,
        branchId: person.branchId,
        month,
        expectedWorkingDays: expectedDays,
        presentDays: 0,
        lateDays: 0,
        lateMinutes: 0,
        workedMinutes: 0,
        overtimeMinutes: 0,
        /* Rounded per day and then summed — never the sum rounded once. Two
           30-minute evenings are two paid hours, not one. */
        overtimeHours: 0,
      },
    ]),
  );

  for (const row of rows) {
    const entry = byStaff.get(row.staffId);
    if (!entry || !row.checkIn?.at) continue;
    entry.presentDays += 1;
    if (row.status === ATTENDANCE_STATUS.LATE) entry.lateDays += 1;
    entry.lateMinutes += row.minutes?.late ?? 0;
    entry.workedMinutes += row.minutes?.worked ?? 0;
    entry.overtimeMinutes += row.minutes?.overtime ?? 0;
    entry.overtimeHours +=
      row.minutes?.overtimeHours ?? minutesToBilledHours(row.minutes?.overtime ?? 0);
  }

  for (const entry of byStaff.values()) {
    entry.absentDays = Math.max(0, entry.expectedWorkingDays - entry.presentDays);
  }

  return [...byStaff.values()];
}
