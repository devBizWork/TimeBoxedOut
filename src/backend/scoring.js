/**
 * The scoring formula (plain, dependency-free, deterministic).
 *
 *   done block    = 50  + up to 25 for timing + up to 25 for length   (0–100)
 *   skipped block = 0
 *   unlogged      = no score, counted as "unknown" in the day totals
 *
 * Timing credit: full while the start is within `onTimeMin` of plan, then falls
 * linearly to zero at `zeroTimingMin` (early or late).
 * Length credit: full while the logged length is within ±`lengthPct`% of the planned
 * length, then falls linearly to zero at 100% off (an empty or doubled block).
 *
 * Day totals are weighted by planned minutes, so a 90-minute block counts three
 * times a 30-minute one.
 */

import { DEFAULT_SETTINGS, SCORE_WEIGHTS } from './constants.js';

export const DEFAULT_TOLERANCES = DEFAULT_SETTINGS.scoring;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** @param {number} startDiffMin actual start − planned start, in minutes (+ = late) */
export function timingCredit(startDiffMin, tol = DEFAULT_TOLERANCES) {
  const d = Math.abs(startDiffMin);
  if (d <= tol.onTimeMin) return 1;
  if (d >= tol.zeroTimingMin) return 0;
  return clamp01((tol.zeroTimingMin - d) / (tol.zeroTimingMin - tol.onTimeMin));
}

export function lengthCredit(plannedMin, actualMin, tol = DEFAULT_TOLERANCES) {
  if (plannedMin <= 0) return 0;
  const dev = Math.abs(actualMin - plannedMin) / plannedMin;
  const free = tol.lengthPct / 100;
  if (dev <= free) return 1;
  if (dev >= 1) return 0;
  return clamp01(1 - (dev - free) / (1 - free));
}

/**
 * Score one block.
 * @param {{startMin:number,durationMin:number}} plan
 * @param {{status:'done'|'skipped', startMin?:number, endMin?:number}} log
 * @returns {{raw:number, score:number, timing:number, length:number, startDiff:number|null,
 *            lengthDiff:number|null, actualMin:number|null, onPlan:boolean}}
 */
export function scoreBlock(plan, log, tol = DEFAULT_TOLERANCES) {
  if (log.status === 'skipped') {
    return { raw: 0, score: 0, timing: 0, length: 0, startDiff: null, lengthDiff: null, actualMin: null, onPlan: false };
  }
  const actualMin = log.endMin - log.startMin;
  const startDiff = log.startMin - plan.startMin;
  const timing = timingCredit(startDiff, tol);
  const length = lengthCredit(plan.durationMin, actualMin, tol);
  const raw = SCORE_WEIGHTS.base + SCORE_WEIGHTS.timing * timing + SCORE_WEIGHTS.length * length;
  return {
    raw,
    score: Math.round(raw),
    timing,
    length,
    startDiff,
    lengthDiff: actualMin - plan.durationMin,
    actualMin,
    onPlan: timing === 1 && length === 1,
  };
}

/** Wording for "what was off" — `tag` is the short chip, `detail` is the review line. */
export function describeDeviation(result, tol = DEFAULT_TOLERANCES) {
  if (result.startDiff === null) return { tag: 'Skipped', detail: 'Skipped' };
  if (result.onPlan) return { tag: 'On plan', detail: 'On plan' };
  const start = Math.round(Math.abs(result.startDiff));
  const len = Math.round(Math.abs(result.lengthDiff));
  const startOff = result.timing < 1;
  const lenOff = result.length < 1;
  const startText = startOff ? `Started ${start} min ${result.startDiff > 0 ? 'late' : 'early'}` : 'On time';
  const lenText = lenOff ? `ran ${len} min ${result.lengthDiff > 0 ? 'over' : 'short'}` : 'length on plan';
  const tag = startOff ? startText : `${result.lengthDiff > 0 ? '+' : '−'}${len} min`;
  return { tag, detail: `${startText} · ${lenText}` };
}

/**
 * Largest-remainder rounding, so displayed percentages add up to exactly 100.
 * @param {number[]} values non-negative shares (any scale)
 */
export function roundToHundred(values) {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

/**
 * Day totals.
 * @param {{plannedMin:number, raw:number|null}[]} items  raw = score 0–100, or null when unlogged
 * @returns {null | {
 *   plannedMin:number, loggedMin:number, unknownMin:number,
 *   followedPct:number, missedPct:number, unknownPct:number,
 *   upToPct:number, loggedScore:number|null, coverage:number, blockCount:number, loggedCount:number }}
 */
export function summarizeDay(items) {
  const plannedMin = items.reduce((a, b) => a + b.plannedMin, 0);
  if (plannedMin <= 0) return null;
  let followed = 0;
  let missed = 0;
  let unknown = 0;
  let loggedMin = 0;
  let loggedWeighted = 0;
  let loggedCount = 0;
  for (const it of items) {
    if (it.raw === null) {
      unknown += it.plannedMin;
    } else {
      followed += (it.raw / 100) * it.plannedMin;
      missed += (1 - it.raw / 100) * it.plannedMin;
      loggedMin += it.plannedMin;
      loggedWeighted += it.raw * it.plannedMin;
      loggedCount += 1;
    }
  }
  const [followedPct, missedPct, unknownPct] = roundToHundred([followed, missed, unknown]);
  return {
    plannedMin,
    loggedMin,
    unknownMin: unknown,
    followedPct,
    missedPct,
    unknownPct,
    // The real result is somewhere between "followed" and "followed + everything still unknown".
    upToPct: followedPct + unknownPct,
    loggedScore: loggedMin > 0 ? Math.round(loggedWeighted / loggedMin) : null,
    coverage: Math.round((loggedMin / plannedMin) * 100),
    blockCount: items.length,
    loggedCount,
  };
}
