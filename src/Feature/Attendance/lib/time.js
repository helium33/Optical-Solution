/**
 * Shift, duration and overtime maths.
 *
 * Everything here is timezone-explicit. The kiosk tablet sits in the shop so
 * its clock agrees with the branch, but the admin reviewing Monday's log may be
 * in another country, and "which business day was this?" must give the same
 * answer to both. Timestamps are stored as UTC instants; the branch timezone is
 * applied only when a human-facing day or shift boundary is needed.
 *
 * No date library is used for the zone work — Intl.DateTimeFormat is in every
 * target browser and is the only thing that actually knows the tz database.
 */

export const ATTENDANCE_STATUS = {
  ON_TIME: 'on_time',
  LATE: 'late',
  /** Clocked in, never clocked out. */
  INCOMPLETE: 'incomplete',
  /** Scheduled but no record at all — derived during aggregation, not here. */
  ABSENT: 'absent',
};

/* ──────────────────────────── Timezone core ───────────────────────────── */

const partsFormatter = (timeZone) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** Calendar/clock fields of `date` as seen in `timeZone`. */
export function zonedParts(date, timeZone) {
  const parts = partsFormatter(timeZone)
    .formatToParts(date)
    .filter((part) => part.type !== 'literal');
  const bag = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return bag;
}

/** Offset of `timeZone` from UTC at the instant `date`, in milliseconds. */
export function tzOffsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  /* Drop sub-second noise so the subtraction is exact. */
  return asIfUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "2026-09-11" — the business day of `date` in `timeZone`. */
export function businessDayKey(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The UTC instant of a wall-clock time in a zone: ("2026-09-11", "17:30",
 * "Asia/Yangon") -> Date.
 *
 * Two passes because the offset itself depends on the instant: guess, measure
 * the offset there, correct, then re-measure in case the correction stepped
 * across a DST boundary. Myanmar has no DST, but the branch table is data and
 * a future shop might not be so simple.
 */
export function zonedTimeToUtc(dayKey, hhmm, timeZone) {
  const [year, month, day] = String(dayKey).split('-').map(Number);
  const [hour, minute] = String(hhmm).split(':').map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;

  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = new Date(naive - tzOffsetMs(new Date(naive), timeZone));
  return new Date(naive - tzOffsetMs(firstPass, timeZone));
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;

export const minutesBetween = (from, to) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / MINUTE_MS);

/* ──────────────────────────── Shift window ────────────────────────────── */

/**
 * The scheduled start/end instants for one business day.
 * An end at or before the start means the shift runs past midnight.
 */
export function shiftWindow(dayKey, shift, timeZone) {
  const start = zonedTimeToUtc(dayKey, shift.start, timeZone);
  let end = zonedTimeToUtc(dayKey, shift.end, timeZone);
  if (!start || !end) return null;

  const overnight = end.getTime() <= start.getTime();
  if (overnight) end = new Date(end.getTime() + DAY_MS);

  const spanMinutes = minutesBetween(start, end);
  const breakMinutes = spanMinutes >= (shift.minBreakThresholdMinutes ?? Infinity)
    ? (shift.breakMinutes ?? 0)
    : 0;

  return {
    start,
    end,
    overnight,
    spanMinutes,
    /* What a full, on-time day is worth once the unpaid break is removed. */
    expectedMinutes: Math.max(0, spanMinutes - breakMinutes),
  };
}

/* ─────────────────────────── The overtime rule ────────────────────────── */

/**
 * Turn a punch pair into the numbers payroll needs.
 *
 * The overtime rule, in one place so it can be argued with:
 *
 *   1. Overtime is OPT-IN. It is only calculated when the employee flips the
 *      Overtime switch at clock-out. Staying late by accident is not overtime.
 *   2. Only time past `shift.end` counts. Arriving early is not overtime — it
 *      is a separate policy, and conflating them lets someone bank an hour by
 *      turning up at 08:00 and leaving on time.
 *   3. A grace window (`overtimeGraceMinutes`) past the scheduled end is
 *      absorbed, so a 17:34 clock-out on a 17:30 shift is not a 4-minute
 *      overtime claim.
 *   4. Overtime is capped at `maxOvertimeMinutes`. Anything past the cap is
 *      recorded as `capped` and needs an admin edit — almost always a forgotten
 *      clock-out rather than a 14-hour day.
 *   5. regular = worked - overtime, so the two never double-count.
 *
 * A claim that survives none of these still records `claimed: true` with
 * `grantedMinutes: 0` and a reason, so the employee sees why it was refused
 * and the admin sees that it was asked for.
 *
 * @param {Date|string|number}  checkInAt
 * @param {Date|string|number?} checkOutAt   omit for a still-open session
 * @param {object} shift      branch shift config
 * @param {string} timeZone   branch timezone
 * @param {boolean} overtimeRequested  the kiosk toggle
 * @param {Date} now          injectable clock, for open sessions and tests
 */
export function computeWorkSession({
  checkInAt,
  checkOutAt = null,
  shift,
  timeZone,
  overtimeRequested = false,
  now = new Date(),
}) {
  const checkIn = new Date(checkInAt);
  if (Number.isNaN(checkIn.getTime())) return null;

  const open = checkOutAt == null;
  const checkOut = open ? new Date(now) : new Date(checkOutAt);

  const dayKey = businessDayKey(checkIn, timeZone);
  const window = shiftWindow(dayKey, shift, timeZone);
  if (!window) return null;

  /* A clock-out before the clock-in is corrupt data, not a negative shift. */
  if (checkOut.getTime() < checkIn.getTime()) {
    return {
      dayKey,
      invalid: true,
      open,
      grossMinutes: 0,
      breakMinutes: 0,
      workedMinutes: 0,
      regularMinutes: 0,
      overtimeMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      status: ATTENDANCE_STATUS.INCOMPLETE,
      scheduledStart: window.start,
      scheduledEnd: window.end,
      expectedMinutes: window.expectedMinutes,
      overtime: { claimed: overtimeRequested, eligibleMinutes: 0, grantedMinutes: 0, capped: false, reason: 'invalid-punch-pair' },
    };
  }

  const grossMinutes = minutesBetween(checkIn, checkOut);

  const breakMinutes =
    grossMinutes >= (shift.minBreakThresholdMinutes ?? Infinity) ? (shift.breakMinutes ?? 0) : 0;

  const workedMinutes = Math.max(0, grossMinutes - breakMinutes);

  const lateMinutes = Math.max(
    0,
    minutesBetween(window.start, checkIn) - (shift.graceMinutes ?? 0),
  );

  const earlyLeaveMinutes = open ? 0 : Math.max(0, minutesBetween(checkOut, window.end));

  /* ---- overtime ---- */
  const beyondEnd = Math.max(0, minutesBetween(window.end, checkOut));
  const graceMinutes = shift.overtimeGraceMinutes ?? 0;
  const eligibleMinutes = beyondEnd > graceMinutes ? beyondEnd : 0;
  const cap = shift.maxOvertimeMinutes ?? Infinity;

  let grantedMinutes = 0;
  let reason = null;
  let capped = false;

  if (open) {
    reason = 'session-open';
  } else if (!overtimeRequested) {
    reason = eligibleMinutes > 0 ? 'not-claimed' : null;
  } else if (eligibleMinutes === 0) {
    reason = beyondEnd > 0 ? 'within-grace-window' : 'not-past-shift-end';
  } else {
    grantedMinutes = Math.min(eligibleMinutes, cap);
    capped = eligibleMinutes > cap;
    if (capped) reason = 'capped-pending-review';
  }

  const overtimeMinutes = grantedMinutes;
  const regularMinutes = Math.max(0, workedMinutes - overtimeMinutes);

  const status = open
    ? ATTENDANCE_STATUS.INCOMPLETE
    : lateMinutes > 0
      ? ATTENDANCE_STATUS.LATE
      : ATTENDANCE_STATUS.ON_TIME;

  return {
    dayKey,
    open,
    invalid: false,
    scheduledStart: window.start,
    scheduledEnd: window.end,
    expectedMinutes: window.expectedMinutes,
    grossMinutes,
    breakMinutes,
    workedMinutes,
    regularMinutes,
    overtimeMinutes,
    lateMinutes,
    earlyLeaveMinutes,
    status,
    overtime: {
      claimed: Boolean(overtimeRequested),
      eligibleMinutes,
      grantedMinutes,
      capped,
      reason,
    },
  };
}

/* ──────────────────────────── Formatting ──────────────────────────────── */

/** 0 -> "0m", 75 -> "1h 15m", 480 -> "8h". */
export function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '—';
  const sign = minutes < 0 ? '-' : '';
  const total = Math.abs(Math.round(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (!hours) return `${sign}${mins}m`;
  if (!mins) return `${sign}${hours}h`;
  return `${sign}${hours}h ${mins}m`;
}

/** Decimal hours for payroll export: 495 -> 8.25 */
export const toDecimalHours = (minutes) =>
  Number.isFinite(minutes) ? Math.round((minutes / 60) * 100) / 100 : 0;

export function formatClock(date, timeZone, { seconds = false } = {}) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  }).format(new Date(date));
}

export function formatDayLabel(dayKey, { weekday = 'short' } = {}) {
  const [y, m, d] = String(dayKey).split('-').map(Number);
  if (!y) return dayKey;
  return new Intl.DateTimeFormat('en-GB', {
    weekday,
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Inclusive list of "YYYY-MM-DD" keys. */
export function dayKeyRange(fromKey, toKey) {
  const keys = [];
  const [fy, fm, fd] = fromKey.split('-').map(Number);
  const [ty, tm, td] = toKey.split('-').map(Number);
  let cursor = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cursor <= end) {
    const date = new Date(cursor);
    keys.push(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`,
    );
    cursor += DAY_MS;
  }
  return keys;
}
