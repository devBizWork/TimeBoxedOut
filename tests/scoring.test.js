import { describe, expect, it } from 'vitest';
import { DEFAULT_TOLERANCES as tol, describeDeviation, lengthCredit, roundToHundred, scoreBlock, summarizeDay, timingCredit } from '../src/backend/scoring.js';

const plan = (startMin, durationMin) => ({ startMin, durationMin });
const done = (startMin, endMin) => ({ status: 'done', startMin, endMin });

describe('timing credit', () => {
  it('is full within the on-time window, zero at the cut-off, linear between', () => {
    expect(timingCredit(0, tol)).toBe(1);
    expect(timingCredit(10, tol)).toBe(1);
    expect(timingCredit(-10, tol)).toBe(1);
    expect(timingCredit(35, tol)).toBeCloseTo(0.5);
    expect(timingCredit(60, tol)).toBe(0);
    expect(timingCredit(-90, tol)).toBe(0);
  });
  it('follows custom tolerances', () => {
    expect(timingCredit(5, { onTimeMin: 0, zeroTimingMin: 10, lengthPct: 10 })).toBeCloseTo(0.5);
  });
});

describe('length credit', () => {
  it('is full within ±10%, zero at 100% off', () => {
    expect(lengthCredit(60, 60, tol)).toBe(1);
    expect(lengthCredit(60, 66, tol)).toBe(1);
    expect(lengthCredit(60, 54, tol)).toBe(1);
    expect(lengthCredit(60, 120, tol)).toBe(0);
    expect(lengthCredit(60, 200, tol)).toBe(0);
    expect(lengthCredit(60, 0, tol)).toBe(0);
  });
});

describe('block score (numbers from the design screens)', () => {
  it('Morning workout, as planned → 100%', () => {
    const r = scoreBlock(plan(390, 60), done(390, 450), tol);
    expect(r.score).toBe(100);
    expect(r.onPlan).toBe(true);
    expect(describeDeviation(r, tol).tag).toBe('On plan');
  });
  it('Deep work started 60 min late, length on plan → 75%', () => {
    const r = scoreBlock(plan(540, 80), done(600, 680), tol);
    expect(r.score).toBe(75);
    expect(describeDeviation(r, tol)).toEqual({ tag: 'Started 60 min late', detail: 'Started 60 min late · length on plan' });
  });
  it('Log sheet: 9:15–10:12 against a 9:00–10:30 plan → 90%', () => {
    expect(scoreBlock(plan(540, 90), done(555, 612), tol).score).toBe(90);
  });
  it('Email & messages ran 15 min over → tag "+15 min"', () => {
    const r = scoreBlock(plan(510, 30), done(510, 555), tol);
    expect(r.score).toBe(89);
    expect(describeDeviation(r, tol).tag).toBe('+15 min');
  });
  it('skipped scores 0', () => {
    const r = scoreBlock(plan(720, 20), { status: 'skipped' }, tol);
    expect(r.score).toBe(0);
    expect(describeDeviation(r).tag).toBe('Skipped');
  });
  it('a bigger on-time window forgives a late start', () => {
    expect(scoreBlock(plan(540, 60), done(570, 630), { ...tol, onTimeMin: 30 }).score).toBe(100);
  });
});

describe('day totals', () => {
  it('Oct 5 in the design: 60% followed, 20% missed, 20% unknown, logged score 75%, coverage 80%', () => {
    const s = summarizeDay([
      { plannedMin: 60, raw: 100 },
      { plannedMin: 80, raw: 75 },
      { plannedMin: 20, raw: 0 },
      { plannedMin: 40, raw: null },
    ]);
    expect(s).toMatchObject({ plannedMin: 200, loggedMin: 160, followedPct: 60, missedPct: 20, unknownPct: 20, upToPct: 80, loggedScore: 75, coverage: 80 });
  });
  it('percentages always add up to 100', () => {
    const s = summarizeDay([{ plannedMin: 30, raw: 33 }, { plannedMin: 30, raw: 33 }, { plannedMin: 30, raw: null }]);
    expect(s.followedPct + s.missedPct + s.unknownPct).toBe(100);
    expect(roundToHundred([1, 1, 1]).reduce((a, b) => a + b)).toBe(100);
  });
  it('is null when nothing was planned; loggedScore null when nothing logged', () => {
    expect(summarizeDay([])).toBeNull();
    expect(summarizeDay([{ plannedMin: 30, raw: null }]).loggedScore).toBeNull();
  });
});
