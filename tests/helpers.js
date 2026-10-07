import { db } from '../src/backend/db.js';

/** Local-time instant. Oct 6 2026 is a Tuesday and far from any DST change. */
export const at = (h, m = 0, s = 0, day = 6, month = 10) => new Date(2026, month - 1, day, h, m, s).getTime();
export const TODAY = '2026-10-06';
export const min = (h, m = 0) => h * 60 + m;

export async function resetDb() {
  await Promise.all([db.tasks.clear(), db.overrides.clear(), db.logs.clear(), db.timers.clear(), db.settings.clear()]);
}
