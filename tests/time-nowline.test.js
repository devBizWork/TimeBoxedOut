import { describe, expect, it } from 'vitest';
import { formatCountdown, formatHourLabel, formatRange, formatTime, monthGrid, weekDates, addDays, minutesSinceMidnight, isDateStr } from '../src/backend/time.js';
import { nowLine, nowLineY, pickCurrentAndNext, suggestedScrollTop, timelineLayout } from '../src/backend/nowline.js';
import { at } from './helpers.js';

describe('time helpers', () => {
  it('formats times and countdowns', () => {
    expect(formatTime(390)).toBe('6:30 am');
    expect(formatTime(0)).toBe('12:00 am');
    expect(formatTime(12 * 60)).toBe('12:00 pm');
    expect(formatTime(18 * 60 + 5, { hour12: false })).toBe('18:05');
    expect(formatRange(390, 450)).toBe('6:30 – 7:30');
    expect(formatHourLabel(12)).toBe('12 pm');
    expect(formatHourLabel(7, false)).toBe('07:00');
    expect(formatCountdown(1072)).toBe('17:52');
    expect(formatCountdown(3725)).toBe('1:02:05');
  });
  it('builds the Monday-first October 2026 grid shown in the calendar (28 Sep … 1 Nov)', () => {
    const grid = monthGrid(2026, 9);
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toEqual({ date: '2026-09-28', inMonth: false });
    expect(grid[4][6]).toEqual({ date: '2026-11-01', inMonth: false });
  });
  it('week strip and date maths', () => {
    expect(weekDates('2026-10-06')[0]).toBe('2026-10-05');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(isDateStr('2026-02-30')).toBe(false);
    expect(minutesSinceMidnight(at(10, 12, 30), '2026-10-06')).toBeCloseTo(612.5);
  });
});

describe('now line', () => {
  it('reports the minute, label and visibility', () => {
    const n = nowLine(at(10, 12), { startHour: 5, endHour: 23, hour12: true });
    expect(n).toMatchObject({ minute: 612, label: '10:12', visible: true });
    expect(nowLine(at(3, 0)).visible).toBe(false);
    expect(nowLine(at(23, 30)).visible).toBe(false);
  });
  it('positions on the same 72 px/hour scale as the design', () => {
    const layout = timelineLayout({ startHour: 7, endHour: 12, originY: 46 });
    expect(layout.hours.map((h) => h.y)).toEqual([46, 118, 190, 262, 334, 406]); // 7 am … 12 pm in the design
    expect(nowLineY(at(10, 12), layout)).toBeCloseTo(46 + (612 - 420) * 1.2);
    expect(nowLineY(at(15, 0), layout)).toBeNull();
    expect(layout.blockRect({ startMin: 390, durationMin: 60 }, 1.5)).toEqual({ top: 46 + (390 - 420) * 1.2 + 1.5, height: 72 - 3 });
    expect(layout.yToMinute(layout.minuteToY(600))).toBeCloseTo(600);
  });
  it('scroll target keeps the line a third down, within bounds', () => {
    expect(suggestedScrollTop(900, 600, 1500)).toBe(700);
    expect(suggestedScrollTop(100, 600, 1500)).toBe(0);
    expect(suggestedScrollTop(1490, 600, 1500)).toBe(900);
  });
});

describe('NOW / NEXT', () => {
  const blk = (title, s, e, extra = {}) => ({ title, startMs: at(...s), endMs: at(...e), log: null, state: 'upcoming', ...extra });
  const blocks = [blk('Deep work', [9], [10, 30]), blk('Client call', [10, 30], [11]), blk('Admin', [11, 15], [12])];

  it('counts down to the end of the current block: 17:52 left at 10:12:08', () => {
    const r = pickCurrentAndNext(blocks, at(10, 12, 8));
    expect(r.current.title).toBe('Deep work');
    expect(r.next.title).toBe('Client call');
    expect(formatCountdown(r.remainingSec)).toBe('17:52');
    expect(r.progress).toBeCloseTo((72 * 60 + 8) / (90 * 60), 1);
  });
  it('is between blocks when nothing is running, and skips logged blocks', () => {
    expect(pickCurrentAndNext(blocks, at(11, 5)).current).toBeNull();
    expect(pickCurrentAndNext(blocks, at(11, 5)).next.title).toBe('Admin');
    const logged = [{ ...blocks[0], log: {} }, ...blocks.slice(1)];
    expect(pickCurrentAndNext(logged, at(10, 12)).current).toBeNull();
  });
  it('a running timer always counts as now, even outside its window', () => {
    const r = pickCurrentAndNext([{ ...blocks[2], state: 'running' }, ...blocks.slice(0, 2)], at(10, 12));
    expect(r.current.title).toBe('Admin');
  });
});
