/**
 * Turns stored tasks into the blocks of a given day. Pure functions, no database access.
 */

import { ALL_DAYS, COLORS, DEFAULT_COLOR, CHIME_IDS, MINUTES_PER_DAY, REPEAT_TYPES, TASK_KINDS, WEEKDAYS } from './constants.js';
import { ValidationError, blockKey } from './keys.js';
import { isDateStr, weekdayOf } from './time.js';

/** Fields a "this day only" override may change. */
export const OVERRIDABLE = ['title', 'startMin', 'durationMin', 'color', 'chimeId', 'notes'];

export function repeatDays(repeat) {
  if (!repeat) return [];
  if (repeat.type === 'daily') return ALL_DAYS;
  if (repeat.type === 'weekdays') return WEEKDAYS;
  return [...new Set(repeat.days ?? [])].sort();
}

/** Does this routine version run on `date`? */
export function routineOccursOn(task, date) {
  if (task.kind !== 'routine') return false;
  if (task.validFrom && date < task.validFrom) return false;
  if (task.validUntil && date > task.validUntil) return false;
  return repeatDays(task.repeat).includes(weekdayOf(date));
}

/**
 * Blocks scheduled on `date`, sorted by start time.
 * @returns {Array<{key,seriesId,taskId,date,kind,title,startMin,endMin,durationMin,color,chimeId,notes,repeat,overridden}>}
 */
export function expandBlocks(date, tasks, overrides = []) {
  const overrideByKey = new Map(overrides.map((o) => [o.key, o]));
  const chosen = new Map(); // seriesId → task version that applies

  for (const task of tasks) {
    const applies = task.kind === 'oneoff' ? task.date === date : routineOccursOn(task, date);
    if (!applies) continue;
    const prev = chosen.get(task.seriesId);
    // Versions never overlap by construction; if a merge ever produces overlap, the newest version wins.
    if (!prev || (task.validFrom ?? '') > (prev.validFrom ?? '') || ((task.validFrom ?? '') === (prev.validFrom ?? '') && task.updatedAt > prev.updatedAt)) {
      chosen.set(task.seriesId, task);
    }
  }

  const blocks = [];
  for (const task of chosen.values()) {
    const key = blockKey(task.seriesId, date);
    const override = overrideByKey.get(key);
    if (override?.removed) continue;
    const merged = { ...task };
    if (override) for (const f of OVERRIDABLE) if (override[f] !== undefined) merged[f] = override[f];
    blocks.push({
      key,
      seriesId: task.seriesId,
      taskId: task.id,
      date,
      kind: task.kind,
      title: merged.title,
      startMin: merged.startMin,
      endMin: merged.startMin + merged.durationMin,
      durationMin: merged.durationMin,
      color: merged.color,
      chimeId: merged.chimeId ?? null,
      notes: merged.notes ?? '',
      repeat: task.repeat ?? null,
      overridden: Boolean(override),
    });
  }
  return blocks.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}

/** A block rebuilt from a log's plan snapshot (the task was deleted or never existed on this phone). */
export function blockFromLog(log) {
  const p = log.plan;
  return {
    key: log.key,
    seriesId: log.seriesId,
    taskId: null,
    date: log.date,
    kind: 'oneoff',
    title: p.title,
    startMin: p.startMin,
    endMin: p.startMin + p.durationMin,
    durationMin: p.durationMin,
    color: p.color ?? DEFAULT_COLOR,
    chimeId: null,
    notes: '',
    repeat: null,
    overridden: false,
    orphan: true,
  };
}

/** Normalise + validate task input. Throws ValidationError. Returns a clean object. */
export function normalizeTaskInput(input) {
  const kind = input.kind;
  if (!TASK_KINDS.includes(kind)) throw new ValidationError(`Unknown task kind "${kind}"`, 'kind');
  const title = String(input.title ?? '').trim();
  if (!title) throw new ValidationError('A task needs a title', 'title');
  if (title.length > 120) throw new ValidationError('Title is too long (120 characters max)', 'title');

  const out = {
    kind,
    title,
    notes: String(input.notes ?? '').slice(0, 2000),
    color: COLORS.some((c) => c.id === input.color) ? input.color : DEFAULT_COLOR,
    chimeId: input.chimeId && CHIME_IDS.includes(input.chimeId) ? input.chimeId : null,
  };

  if (kind === 'inbox') return { ...out, startMin: null, durationMin: null, date: null, repeat: null };

  const { startMin, durationMin } = input;
  if (!Number.isInteger(startMin) || startMin < 0 || startMin >= MINUTES_PER_DAY) throw new ValidationError('Start time must be within the day', 'startMin');
  if (!Number.isInteger(durationMin) || durationMin < 1) throw new ValidationError('Duration must be at least 1 minute', 'durationMin');
  if (startMin + durationMin > MINUTES_PER_DAY) throw new ValidationError('A block cannot run past midnight', 'durationMin');
  out.startMin = startMin;
  out.durationMin = durationMin;

  if (kind === 'oneoff') {
    if (!isDateStr(input.date)) throw new ValidationError('A one-off task needs a date', 'date');
    return { ...out, date: input.date, repeat: null };
  }

  // routine
  const type = input.repeat?.type ?? 'daily';
  if (!REPEAT_TYPES.includes(type)) throw new ValidationError(`Unknown repeat "${type}"`, 'repeat');
  const days = type === 'custom' ? [...new Set(input.repeat?.days ?? [])].filter((d) => ALL_DAYS.includes(d)).sort() : repeatDays({ type });
  if (days.length === 0) throw new ValidationError('Pick at least one day', 'repeat');
  return { ...out, date: null, repeat: { type, days } };
}

/** Human label for a task's repeat rule: "Daily", "Weekdays", "Sat, Sun". */
export function describeRepeat(repeat) {
  if (!repeat) return '';
  if (repeat.type === 'daily') return 'Daily';
  if (repeat.type === 'weekdays') return 'Weekdays';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = repeatDays(repeat);
  if (days.length === 7) return 'Daily';
  // Monday-first reads more naturally.
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => names[d]).join(', ');
}
