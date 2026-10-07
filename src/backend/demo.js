/**
 * Sample data that mirrors the design mockups, for building and demoing the screens.
 * Not used by the app itself. `seedDemoData()` wipes tasks/logs first.
 */

import { db } from './db.js';
import { createTask } from './tasks.js';
import { saveLog } from './logs.js';
import { addDays, toDateStr } from './time.js';

const t = (h, m = 0) => h * 60 + m;

export async function seedDemoData({ now = Date.now() } = {}) {
  const today = toDateStr(now);
  await Promise.all([db.tasks.clear(), db.overrides.clear(), db.logs.clear(), db.timers.clear()]);
  const from = addDays(today, -14);
  const routine = (title, startMin, durationMin, repeat, color) =>
    createTask({ kind: 'routine', title, startMin, durationMin, repeat, color, validFrom: from }, { now });

  const workout = await routine('Morning workout', t(6, 30), 60, { type: 'daily' }, 'mint');
  const planDay = await routine('Plan the day', t(7, 45), 30, { type: 'weekdays' }, 'sky');
  await routine('Meditate', t(8), 20, { type: 'custom', days: [6, 0] }, 'peach');
  const email = await routine('Email & messages', t(8, 30), 30, { type: 'weekdays' }, 'butter');
  const deep = await routine('Deep work', t(9), 90, { type: 'weekdays' }, 'lilac');
  const lunch = await routine('Lunch walk', t(12), 30, { type: 'daily' }, 'mint');
  await routine('Project work', t(13), 90, { type: 'weekdays' }, 'lilac');
  const reading = await routine('Evening reading', t(21), 40, { type: 'daily' }, 'peach');

  await createTask({ kind: 'oneoff', title: 'Client check-in call', date: today, startMin: t(10, 30), durationMin: 30, color: 'pink' }, { now });
  await createTask({ kind: 'oneoff', title: 'Admin & invoices', date: today, startMin: t(11, 15), durationMin: 45, color: 'butter' }, { now });
  await createTask({ kind: 'oneoff', title: 'Quarterly review prep', date: addDays(today, 2), startMin: t(14), durationMin: 60, color: 'sky' }, { now });
  for (const title of ['Call the dentist', 'Return library books', 'Plan weekend trip']) await createTask({ kind: 'inbox', title }, { now });

  // Yesterday: workout on plan, deep work an hour late, lunch skipped, reading never logged.
  const y = addDays(today, -1);
  const k = (task, d) => `${task.seriesId}@${d}`;
  await saveLog({ key: k(workout, y), status: 'done' }, { now });
  await saveLog({ key: k(deep, y), status: 'done', startMin: t(10), endMin: t(11, 30) }, { now });
  await saveLog({ key: k(lunch, y), status: 'skipped' }, { now });
  void reading;

  // Today: workout done, email ran 15 min over, plan-the-day not logged.
  await saveLog({ key: k(workout, today), status: 'done' }, { now });
  await saveLog({ key: k(email, today), status: 'done', startMin: t(8, 30), endMin: t(9, 15) }, { now });
  void planDay;
  return { today };
}
