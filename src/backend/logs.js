/** Logging what happened: done as planned, done at other times, skipped, or timed live. */

import { MINUTES_PER_DAY } from './constants.js';
import { db } from './db.js';
import { getBlock } from './days.js';
import { ValidationError, parseBlockKey } from './keys.js';
import { minutesSinceMidnight } from './time.js';

/** Snapshot of the plan, so a log (and its score) still makes sense if the task is later deleted. */
const planSnapshot = (b) => ({ title: b.title, color: b.color, startMin: b.startMin, durationMin: b.durationMin });

async function requireBlock(key, now) {
  const block = await getBlock(key, { now });
  if (block) return block;
  const existing = await db.logs.get(key); // a deleted task whose log still carries its plan
  if (existing?.plan) return { key, ...existing.plan, ...parseBlockKey(key) };
  throw new ValidationError('That block no longer exists', 'not-found');
}

/**
 * Create or replace the log for a block.
 * @param {{key:string, status:'done'|'skipped', startMin?:number, endMin?:number, note?:string, source?:string}} input
 *   For `done`, omit startMin/endMin to log it exactly as planned.
 */
export async function saveLog(input, { now = Date.now() } = {}) {
  const block = await requireBlock(input.key, now);
  const { seriesId, date } = parseBlockKey(input.key);
  const note = String(input.note ?? '').slice(0, 2000);

  let log;
  if (input.status === 'skipped') {
    log = { status: 'skipped', startMin: null, endMin: null, source: input.source ?? 'manual' };
  } else if (input.status === 'done') {
    const startMin = input.startMin ?? block.startMin;
    const endMin = input.endMin ?? block.startMin + block.durationMin;
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) throw new ValidationError('Start and end times are required', 'times');
    if (startMin < 0 || endMin > MINUTES_PER_DAY) throw new ValidationError('Times must stay within the day', 'times');
    if (endMin <= startMin) throw new ValidationError('The end must be after the start', 'times');
    log = { status: 'done', startMin: Math.round(startMin), endMin: Math.round(endMin), source: input.source ?? (input.startMin === undefined ? 'planned' : 'manual') };
  } else {
    throw new ValidationError(`Unknown status "${input.status}"`, 'status');
  }

  const previous = await db.logs.get(input.key);
  const row = { key: input.key, seriesId, date, ...log, note, plan: planSnapshot(block), createdAt: previous?.createdAt ?? now, updatedAt: now };
  await db.transaction('rw', db.logs, db.timers, async () => {
    await db.logs.put(row);
    await db.timers.delete(input.key); // logging a block ends any timer on it
  });
  return row;
}

export const logDoneAsPlanned = (key, opts) => saveLog({ key, status: 'done' }, opts);
export const logSkipped = (key, opts) => saveLog({ key, status: 'skipped' }, opts);

/** Undo: the block goes back to "unknown". */
export async function clearLog(key) {
  await db.logs.delete(key);
}

/** Review flow: log several unlogged blocks at once. Returns the keys that were logged. */
export async function logMany(keys, status, opts) {
  const out = [];
  for (const key of keys) out.push((await saveLog({ key, status }, opts)).key);
  return out;
}

/* ---------- Timer ---------- */

/** The block currently being timed, if any. One timer at a time. */
export async function getRunningTimer() {
  return (await db.timers.toCollection().first()) ?? null;
}

export async function startTimer(key, { now = Date.now() } = {}) {
  const running = await getRunningTimer();
  if (running && running.key !== key) throw new ValidationError('Another timer is already running. Stop it first.', 'timer-busy');
  if (running) return running;
  await requireBlock(key, now);
  const row = { key, startedAt: now };
  await db.timers.put(row);
  return row;
}

/**
 * Stop the timer and save a "done" log from when it started to now (rounded to whole minutes,
 * at least one). The log sheet then edits that log, so closing the sheet never loses the time.
 */
export async function stopTimer(key, { now = Date.now(), note = '' } = {}) {
  const timer = await db.timers.get(key);
  if (!timer) throw new ValidationError('No timer is running for that block', 'no-timer');
  const { date } = parseBlockKey(key);
  const startMin = Math.max(0, Math.round(minutesSinceMidnight(timer.startedAt, date)));
  const endMin = Math.min(MINUTES_PER_DAY, Math.max(startMin + 1, Math.round(minutesSinceMidnight(now, date))));
  return saveLog({ key, status: 'done', startMin, endMin, note, source: 'timer' }, { now });
}

export async function cancelTimer(key) {
  await db.timers.delete(key);
}
