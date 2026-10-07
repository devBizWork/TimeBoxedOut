/**
 * The "now line": where the current time sits on the timeline, plus the NOW / NEXT
 * card maths. Pure functions; `clock.js` supplies the ticking.
 */

import { dateTimeMs, minutesSinceMidnight, toDateStr } from './time.js';

/** Timeline geometry. 72 px per hour matches the design (7 am line at y=46, 8 am at y=118). */
export const DEFAULT_PX_PER_HOUR = 72;

export function timelineLayout({ startHour = 5, endHour = 23, pxPerHour = DEFAULT_PX_PER_HOUR, originY = 0 } = {}) {
  const pxPerMin = pxPerHour / 60;
  const hours = [];
  for (let h = startHour; h <= endHour; h++) hours.push({ hour: h, y: originY + (h - startHour) * pxPerHour });
  return {
    startHour,
    endHour,
    pxPerMin,
    originY,
    hours,
    height: (endHour - startHour) * pxPerHour,
    minuteToY: (min) => originY + (min - startHour * 60) * pxPerMin,
    yToMinute: (y) => startHour * 60 + (y - originY) / pxPerMin,
    /** Top/height for a block, with an optional visual inset (the design uses ~1.5 px). */
    blockRect: (block, inset = 0) => {
      const top = originY + (block.startMin - startHour * 60) * pxPerMin + inset;
      return { top, height: Math.max(0, block.durationMin * pxPerMin - inset * 2) };
    },
  };
}

/**
 * @param {number} nowMs
 * @param {{startHour:number,endHour:number,hour12?:boolean}} day  from settings.day
 * @returns {{minute:number, label:string, visible:boolean, fraction:number}}
 *   `fraction` is 0–1 down the visible timeline (clamped); `visible` is false outside day hours.
 */
export function nowLine(nowMs, day = { startHour: 5, endHour: 23, hour12: true }) {
  const minute = minutesSinceMidnight(nowMs, toDateStr(nowMs));
  const from = day.startHour * 60;
  const to = day.endHour * 60;
  const d = new Date(nowMs);
  const hh = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, '0');
  const label = day.hour12 === false ? `${String(hh).padStart(2, '0')}:${mm}` : `${hh % 12 === 0 ? 12 : hh % 12}:${mm}`;
  return {
    minute,
    label,
    visible: minute >= from && minute <= to,
    fraction: Math.min(1, Math.max(0, (minute - from) / (to - from))),
  };
}

/** Pixel position of the now line for a layout from `timelineLayout`, or null when off the timeline. */
export function nowLineY(nowMs, layout) {
  const minute = minutesSinceMidnight(nowMs, toDateStr(nowMs));
  if (minute < layout.startHour * 60 || minute > layout.endHour * 60) return null;
  return layout.minuteToY(minute);
}

/** A scroll offset that puts the now line about a third of the way down the viewport. */
export function suggestedScrollTop(nowY, viewportHeight, contentHeight) {
  const target = nowY - viewportHeight / 3;
  return Math.min(Math.max(0, contentHeight - viewportHeight), Math.max(0, target));
}

/**
 * Current block, next block and the countdown for the NOW / NEXT card.
 * Blocks already logged are finished, so they are never "now" or "next"; a block with a
 * running timer is always "now".
 */
export function pickCurrentAndNext(blocks, nowMs) {
  const running = blocks.find((b) => b.state === 'running');
  const inWindow = blocks.filter((b) => !b.log && b.startMs <= nowMs && nowMs < b.endMs);
  const current = running ?? inWindow.sort((a, b) => b.startMs - a.startMs)[0] ?? null;
  const next = blocks.find((b) => !b.log && b.state !== 'running' && b.startMs > nowMs && b !== current) ?? null;
  return {
    current,
    next,
    remainingSec: current ? Math.max(0, Math.ceil((current.endMs - nowMs) / 1000)) : null,
    progress: current ? Math.min(1, Math.max(0, (nowMs - current.startMs) / (current.endMs - current.startMs))) : null,
    untilNextSec: next ? Math.max(0, Math.ceil((next.startMs - nowMs) / 1000)) : null,
  };
}

export { dateTimeMs };
