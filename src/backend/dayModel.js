/**
 * Builds everything a screen needs for one day from raw database rows.
 * Pure: give it rows and an instant, get a view model. Easy to test, easy to memoise.
 */

import { DEFAULT_SETTINGS } from './constants.js';
import { blockFromLog, expandBlocks } from './schedule.js';
import { describeDeviation, scoreBlock, summarizeDay } from './scoring.js';
import { dateTimeMs, minutesSinceMidnight, toDateStr } from './time.js';
import { nowLine, pickCurrentAndNext } from './nowline.js';

/**
 * Block states (see "Block states & signals" in the design):
 *   upcoming  not started yet
 *   now       inside its planned window, nothing logged, no timer
 *   running   a timer is running for it
 *   done      logged, on plan
 *   offplan   logged, outside a tolerance (tag says by how much)
 *   skipped   logged as skipped (scores 0)
 *   unknown   past and never logged (never shown as missed)
 */
export const BLOCK_STATES = ['upcoming', 'now', 'running', 'done', 'offplan', 'skipped', 'unknown'];

/**
 * @param {{date:string, tasks:object[], overrides:object[], logs:object[], timers:object[], settings?:object}} data
 * @param {number} nowMs
 */
export function buildDayModel(data, nowMs = Date.now()) {
  const { date, tasks, overrides, logs, timers = [] } = data;
  const settings = data.settings ?? DEFAULT_SETTINGS;
  const tol = settings.scoring;
  const today = toDateStr(nowMs);
  const isToday = date === today;
  const isPast = date < today;
  const nowMin = isToday ? minutesSinceMidnight(nowMs, date) : null;

  const scheduled = expandBlocks(date, tasks, overrides);
  const logByKey = new Map(logs.map((l) => [l.key, l]));
  const timerByKey = new Map(timers.map((t) => [t.key, t]));

  // Logged blocks whose task no longer exists still belong to the day's history.
  const known = new Set(scheduled.map((b) => b.key));
  const orphans = logs.filter((l) => !known.has(l.key) && l.plan).map(blockFromLog);
  const all = [...scheduled, ...orphans].sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));

  const blocks = all.map((block) => {
    const log = logByKey.get(block.key) ?? null;
    const timer = timerByKey.get(block.key) ?? null;
    const startMs = dateTimeMs(date, block.startMin);
    const endMs = dateTimeMs(date, block.endMin);

    let state;
    let result = null;
    let tag = null;
    let detail = null;
    if (log) {
      result = scoreBlock(block, log, tol);
      ({ tag, detail } = describeDeviation(result, tol));
      state = log.status === 'skipped' ? 'skipped' : result.onPlan ? 'done' : 'offplan';
    } else if (timer) {
      state = 'running';
    } else if (isPast || (isToday && nowMs >= endMs)) {
      state = 'unknown';
    } else if (isToday && nowMs >= startMs) {
      state = 'now';
    } else {
      state = 'upcoming';
    }

    return {
      ...block,
      startMs,
      endMs,
      state,
      log,
      timer: timer ? { startedAt: timer.startedAt, elapsedSec: Math.max(0, Math.floor((nowMs - timer.startedAt) / 1000)) } : null,
      score: result ? result.score : null,
      rawScore: result ? result.raw : null,
      scoreParts: result ? { timing: result.timing, length: result.length } : null,
      actual: log && log.status === 'done' ? { startMin: log.startMin, endMin: log.endMin, durationMin: log.endMin - log.startMin } : null,
      tag,
      detail,
    };
  });

  return {
    date,
    settings,
    isToday,
    isPast,
    isFuture: !isToday && !isPast,
    blocks,
    unlogged: blocks.filter((b) => b.state === 'unknown'),
    summary: summarizeBlocks(blocks, { isToday, isPast, nowMs }),
    ...(isToday ? pickCurrentAndNext(blocks, nowMs) : { current: null, next: null, remainingSec: null, progress: null }),
    nowLine: isToday ? nowLine(nowMs, settings.day) : null,
  };
}

/**
 * Day totals. For today, "so far" counts only blocks that have ended or been logged:
 * a block still in progress or still to come cannot count against you yet.
 * Future days have no score.
 */
export function summarizeBlocks(blocks, { isToday, isPast, nowMs }) {
  if (!isToday && !isPast) return null;
  const counted = blocks.filter((b) => (isPast ? true : b.log || b.endMs <= nowMs));
  return summarizeDay(counted.map((b) => ({ plannedMin: b.durationMin, raw: b.rawScore })));
}
