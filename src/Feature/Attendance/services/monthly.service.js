import { getDocs, getDocsFromCache, query, where } from 'firebase/firestore';

import { attendanceCol, monthlyCol } from './paths';
import { summariseMonth, workingDaysInMonth } from '../lib/monthly';

/* Re-exported so callers have one import for "the monthly summary" and do not
   have to know which half of it touches Firestore. */
export { summariseMonth, workingDaysInMonth };

/**
 * The monthly summary the admin dashboard shows.
 *
 * TWO PATHS, ONE SHAPE.
 *
 * Reading `attendanceMonthly/{branchId}_{month}_{staffId}` is one document per
 * person per month — the query the dashboard actually wants, and the one that
 * stays fast when there are three years of punches. Those documents are
 * maintained by a Cloud Function trigger on attendance writes.
 *
 * Until that trigger exists the same figures are derived from the raw
 * attendance rows here. `summariseMonth` is the single implementation both
 * sides use, so the number on the dashboard today and the number in the
 * rolled-up document later cannot disagree.
 */

/* ───────────────────────────── fetching ───────────────────────────────── */

const shape = (entry) => ({ id: entry.id, ...entry.data() });

/**
 * @param month  "2026-09"
 * @param roster the staff to report on
 */
export async function fetchMonthlySummary({ branchIds, month, roster, timeZone, fromCache = false }) {
  if (!branchIds?.length || !month) return [];

  const rawQuery = query(
    attendanceCol(),
    where('branchId', 'in', branchIds.slice(0, 30)),
    where('dayKey', '>=', `${month}-01`),
    where('dayKey', '<=', `${month}-31`),
  );
  const fromRaw = (snapshot) =>
    summariseMonth({
      rows: snapshot.docs.map(shape),
      roster: roster.filter((person) => branchIds.includes(person.branchId)),
      month,
      timeZone,
    });

  /* This device's copy of the raw rows, for an instant first paint. The
     caller asks again without this for the server's answer. */
  if (fromCache) return fromRaw(await getDocsFromCache(rawQuery));

  /* Both questions at once. The roll-ups are written by a Cloud Function
     that has never been deployed, so asking for them first and the raw rows
     only afterwards was a guaranteed-empty round trip in front of every
     monthly view. */
  const [rolledUp, raw] = await Promise.allSettled([
    getDocs(
      query(monthlyCol(), where('month', '==', month), where('branchId', 'in', branchIds.slice(0, 30))),
    ),
    getDocs(rawQuery),
  ]);

  /* Preferred: the rolled-up documents. */
  {
    const snapshot = rolledUp.status === 'fulfilled' ? rolledUp.value : null;
    if (snapshot && !snapshot.empty) {
      const rolled = snapshot.docs.map(shape);
      const ids = new Set(rolled.map((entry) => entry.staffId));
      /* Anyone with no rolled-up document was absent all month; synthesise a
         zero row rather than dropping them. */
      const expectedDays = workingDaysInMonth(month, { timeZone }).length;
      const missing = roster
        .filter((person) => !ids.has(person.id))
        .map((person) => ({
          staffId: person.id,
          staffName: person.name,
          role: person.role,
          branchId: person.branchId,
          month,
          expectedWorkingDays: expectedDays,
          presentDays: 0,
          absentDays: expectedDays,
          lateDays: 0,
          lateMinutes: 0,
          workedMinutes: 0,
          overtimeMinutes: 0,
          overtimeHours: 0,
        }));
      return [...rolled, ...missing];
    }
    /* Collection missing, index missing, rules deny it, or simply empty —
       fall through to the raw rows. */
  }

  /* Fallback: derive it from the raw rows. */
  if (raw.status === 'rejected') throw raw.reason;
  return fromRaw(raw.value);
}
