/**
 * Task CRUD. Routines are versioned so that "this and future days" never rewrites the past.
 */

import { db } from './db.js';
import { ValidationError, blockKey, newId } from './keys.js';
import { OVERRIDABLE, normalizeTaskInput } from './schedule.js';
import { addDays, toDateStr } from './time.js';

const tables = () => [db.tasks, db.overrides];

/** Create any kind of task. Returns the stored row. */
export async function createTask(input, { now = Date.now() } = {}) {
  const clean = normalizeTaskInput(input);
  const id = newId();
  const row = {
    id,
    seriesId: id,
    ...clean,
    validFrom: clean.kind === 'routine' ? input.validFrom ?? toDateStr(now) : null,
    validUntil: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.tasks.add(row);
  return row;
}

/** Inbox → timeline: gives a to-do a day, start time and length. */
export async function scheduleInboxTask(seriesId, { date, startMin, durationMin }, { now = Date.now() } = {}) {
  return db.transaction('rw', db.tasks, async () => {
    const row = await db.tasks.get(seriesId);
    if (!row || row.kind !== 'inbox') throw new ValidationError('Not an inbox task', 'not-inbox');
    const clean = normalizeTaskInput({ ...row, kind: 'oneoff', date, startMin, durationMin });
    const next = { ...row, ...clean, updatedAt: now };
    await db.tasks.put(next);
    return next;
  });
}

/**
 * Edit a task.
 *   one-off / inbox     edited in place (scope is ignored)
 *   routine, 'this'     only `date` changes (stored as an override; the routine is untouched)
 *   routine, 'future'   `date` and every later day; earlier days keep their original plan
 */
export async function updateTask(seriesId, patch, { scope = 'future', date = toDateStr(), now = Date.now() } = {}) {
  return db.transaction('rw', tables(), async () => {
    const versions = await db.tasks.where('seriesId').equals(seriesId).toArray();
    if (versions.length === 0) throw new ValidationError('Task not found', 'not-found');
    const head = versions.find((v) => v.id === seriesId) ?? versions[0];

    if (head.kind !== 'routine') {
      const clean = normalizeTaskInput({ ...head, ...patch, kind: head.kind });
      const next = { ...head, ...clean, updatedAt: now };
      await db.tasks.put(next);
      return next;
    }

    if (scope === 'this') {
      const current = versions.find((v) => v.validFrom <= date && (!v.validUntil || v.validUntil >= date));
      if (!current) throw new ValidationError('This routine does not run on that day', 'not-scheduled');
      const key = blockKey(seriesId, date);
      const existing = (await db.overrides.get(key)) ?? {};
      const merged = {};
      for (const f of OVERRIDABLE) {
        const v = patch[f] !== undefined ? patch[f] : existing[f];
        if (v !== undefined) merged[f] = v;
      }
      // Validate the combined result using the routine's other fields as context.
      normalizeTaskInput({ ...current, ...merged });
      const override = { key, seriesId, date, ...merged, removed: false, updatedAt: now };
      await db.overrides.put(override);
      return override;
    }

    // 'future'
    const touched = [];
    for (const v of versions.sort((a, b) => a.validFrom.localeCompare(b.validFrom))) {
      if (v.validFrom > date) {
        touched.push(await putVersion(v, patch, now)); // later versions get the same edit
      } else if (!v.validUntil || v.validUntil >= date) {
        if (v.validFrom === date) {
          touched.push(await putVersion(v, patch, now)); // starts today: edit in place
        } else {
          // Close the old version yesterday, open a new one today.
          await db.tasks.put({ ...v, validUntil: addDays(date, -1), updatedAt: now });
          const id = newId();
          const clean = normalizeTaskInput({ ...v, ...patch, kind: 'routine' });
          const created = { ...v, ...clean, id, validFrom: date, validUntil: v.validUntil, createdAt: now, updatedAt: now };
          await db.tasks.add(created);
          touched.push(created);
        }
      }
    }
    // Per-day overrides from `date` on were made against the old plan; the user's new edit wins.
    const stale = await db.overrides.where('seriesId').equals(seriesId).filter((o) => o.date >= date && !o.removed).primaryKeys();
    await db.overrides.bulkDelete(stale);
    return touched[0];
  });
}

async function putVersion(v, patch, now) {
  const clean = normalizeTaskInput({ ...v, ...patch, kind: 'routine' });
  const next = { ...v, ...clean, updatedAt: now };
  await db.tasks.put(next);
  return next;
}

/**
 * Delete a task.
 *   one-off / inbox     removed (its logs are kept: they carry their own plan snapshot)
 *   routine, 'this'     skips just `date`
 *   routine, 'future'   stops the routine from `date` on; past days are untouched
 */
export async function deleteTask(seriesId, { scope = 'future', date = toDateStr(), now = Date.now() } = {}) {
  return db.transaction('rw', tables(), async () => {
    const versions = await db.tasks.where('seriesId').equals(seriesId).toArray();
    if (versions.length === 0) return;
    if (versions[0].kind !== 'routine') {
      await db.tasks.bulkDelete(versions.map((v) => v.id));
      return;
    }
    if (scope === 'this') {
      await db.overrides.put({ key: blockKey(seriesId, date), seriesId, date, removed: true, updatedAt: now });
      return;
    }
    for (const v of versions) {
      if (v.validFrom >= date) {
        await db.tasks.delete(v.id); // never ran before `date`
      } else if (!v.validUntil || v.validUntil >= date) {
        await db.tasks.put({ ...v, validUntil: addDays(date, -1), updatedAt: now });
      }
    }
    const stale = await db.overrides.where('seriesId').equals(seriesId).filter((o) => o.date >= date).primaryKeys();
    await db.overrides.bulkDelete(stale);
  });
}

/** Copies the version of the task that applies on `date` as a new, independent task. */
export async function duplicateTask(seriesId, { date = toDateStr(), now = Date.now() } = {}) {
  const versions = await db.tasks.where('seriesId').equals(seriesId).toArray();
  const src = versions.find((v) => v.kind !== 'routine' || (v.validFrom <= date && (!v.validUntil || v.validUntil >= date))) ?? versions.at(-1);
  if (!src) throw new ValidationError('Task not found', 'not-found');
  const { id, seriesId: _s, createdAt, updatedAt, validUntil, ...rest } = src;
  return createTask({ ...rest, title: `${src.title} copy`, validFrom: src.kind === 'routine' ? date : undefined }, { now });
}

/**
 * Data for the Tasks screen: the inbox, routines as they stand on `date`, and one-offs
 * from `date` onwards (past one-offs live in the calendar).
 */
export async function listTasks({ date = toDateStr() } = {}) {
  const all = await db.tasks.toArray();
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const byStart = (a, b) => a.startMin - b.startMin || byTitle(a, b);
  const inbox = all.filter((t) => t.kind === 'inbox').sort((a, b) => a.createdAt - b.createdAt);
  const routines = all
    .filter((t) => t.kind === 'routine' && t.validFrom <= date && (!t.validUntil || t.validUntil >= date))
    .sort(byStart);
  const oneOffs = all.filter((t) => t.kind === 'oneoff' && t.date >= date).sort((a, b) => a.date.localeCompare(b.date) || byStart(a, b));
  return { inbox, routines, oneOffs, total: inbox.length + routines.length + oneOffs.length };
}

/** True until the user has created anything: drives the friendly first-run screen. */
export async function isFirstRun() {
  return (await db.tasks.count()) === 0;
}
