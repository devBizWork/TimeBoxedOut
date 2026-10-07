/** Calendar rings and Trends. Built on the same day models as every other screen. */

import { getRangeModels } from './days.js';
import { addDays, monthGrid, toDateStr, weekDates } from './time.js';

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Compact per-day numbers: ring segments, scores, coverage. */
export function toDaySummary(model) {
  const s = model.summary;
  return {
    date: model.date,
    isToday: model.isToday,
    isFuture: model.isFuture,
    blockCount: model.blocks.length,
    hasPlan: model.blocks.length > 0,
    followedPct: s?.followedPct ?? null, // "day score" (so far, for today)
    missedPct: s?.missedPct ?? null,
    unknownPct: s?.unknownPct ?? null,
    upToPct: s?.upToPct ?? null,
    loggedScore: s?.loggedScore ?? null,
    coverage: s?.coverage ?? null,
    plannedMin: s?.plannedMin ?? 0,
    loggedMin: s?.loggedMin ?? 0,
    loggedCount: s?.loggedCount ?? 0,
  };
}

export async function getDaySummaries(startDate, endDate, { now = Date.now() } = {}) {
  return (await getRangeModels(startDate, endDate, { now })).map(toDaySummary);
}

/** Calendar month: weeks of cells, each with its summary (null summary fields for days with no plan). */
export async function getMonth(year, monthIndex, { now = Date.now() } = {}) {
  const weeks = monthGrid(year, monthIndex);
  const summaries = await getDaySummaries(weeks[0][0].date, weeks.at(-1)[6].date, { now });
  const byDate = new Map(summaries.map((s) => [s.date, s]));
  return weeks.map((w) => w.map((cell) => ({ ...cell, ...byDate.get(cell.date) })));
}

/** The Monday-first week strip on the Day screen. */
export async function getWeek(date, { now = Date.now() } = {}) {
  const days = weekDates(date);
  return getDaySummaries(days[0], days[6], { now });
}

/** Weekly = the 7 days ending `today`; monthly = the 30 days ending `today`. */
export function trendRange(period, today = toDateStr()) {
  return { start: addDays(today, period === 'monthly' ? -29 : -6), end: today };
}

/**
 * Trends for a range.
 *  - dayScore / loggedScore average only days with at least one log: a day you never logged says
 *    nothing about how closely you followed the plan.
 *  - coverage averages every day that had a plan, so unlogged days pull it down. That is its job.
 *  - mostSkipped: per routine/task title, how many planned days it was skipped (or left unknown).
 */
export async function getTrends(period = 'weekly', { now = Date.now(), today = toDateStr(now) } = {}) {
  const { start, end } = trendRange(period, today);
  const models = await getRangeModels(start, end, { now });
  const days = models.map(toDaySummary);

  const planned = days.filter((d) => d.hasPlan && !d.isFuture);
  const logged = planned.filter((d) => d.loggedCount > 0);

  const bySeries = new Map();
  for (const m of models) {
    if (m.isFuture) continue;
    for (const b of m.blocks) {
      const row = bySeries.get(b.seriesId) ?? { seriesId: b.seriesId, title: b.title, plannedDays: 0, skipped: 0, unknown: 0 };
      row.title = b.title;
      row.plannedDays += 1;
      if (b.state === 'skipped') row.skipped += 1;
      if (b.state === 'unknown') row.unknown += 1;
      bySeries.set(b.seriesId, row);
    }
  }
  const mostSkipped = [...bySeries.values()]
    .filter((r) => r.skipped > 0)
    .sort((a, b) => b.skipped - a.skipped || b.skipped / b.plannedDays - a.skipped / a.plannedDays || a.title.localeCompare(b.title));

  return {
    period,
    start,
    end,
    days,
    avgDayScore: mean(logged.map((d) => d.followedPct)),
    avgLoggedScore: mean(logged.map((d) => d.loggedScore)),
    avgCoverage: mean(planned.map((d) => d.coverage)),
    mostSkipped,
  };
}
