/** Read side: load rows from Dexie and hand them to the pure day model. */

import { db } from './db.js';
import { buildDayModel } from './dayModel.js';
import { getSettings } from './settings.js';
import { parseBlockKey } from './keys.js';
import { dateRange, toDateStr } from './time.js';

/** Raw rows for one day. Reading inside a Dexie `liveQuery` makes the UI re-render when any of them change. */
export async function loadDayData(date) {
  const [tasks, overrides, logs, timers, settings] = await Promise.all([
    db.tasks.where('kind').anyOf('routine', 'oneoff').toArray(),
    db.overrides.where('date').equals(date).toArray(),
    db.logs.where('date').equals(date).toArray(),
    db.timers.toArray(),
    getSettings(),
  ]);
  return { date, tasks, overrides, logs, timers: timers.filter((t) => t.key.endsWith(`@${date}`)), settings };
}

export async function getDayModel(date = toDateStr(), { now = Date.now() } = {}) {
  return buildDayModel(await loadDayData(date), now);
}

/** One block (with state, score, tag…) by its key. */
export async function getBlock(key, { now = Date.now() } = {}) {
  const { date } = parseBlockKey(key);
  const model = await getDayModel(date, { now });
  return model.blocks.find((b) => b.key === key) ?? null;
}

/** Day models for a run of days, loading the tasks and settings once. */
export async function getRangeModels(startDate, endDate, { now = Date.now() } = {}) {
  const [tasks, overrides, logs, timers, settings] = await Promise.all([
    db.tasks.where('kind').anyOf('routine', 'oneoff').toArray(),
    db.overrides.where('date').between(startDate, endDate, true, true).toArray(),
    db.logs.where('date').between(startDate, endDate, true, true).toArray(),
    db.timers.toArray(),
    getSettings(),
  ]);
  return dateRange(startDate, endDate).map((date) =>
    buildDayModel(
      {
        date,
        tasks,
        overrides: overrides.filter((o) => o.date === date),
        logs: logs.filter((l) => l.date === date),
        timers: timers.filter((t) => t.key.endsWith(`@${date}`)),
        settings,
      },
      now,
    ),
  );
}

