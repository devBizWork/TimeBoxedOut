import { beforeEach, describe, expect, it } from 'vitest';
import { clearLog, createTask, deleteTask, duplicateTask, getDayModel, getRunningTimer, isFirstRun, listTasks, logDoneAsPlanned, logMany, saveLog, scheduleInboxTask, seedDemoData, startTimer, stopTimer, updateTask, getTrends, getMonth, getWeek, cancelTimer } from '../src/backend/index.js';
import { TODAY, at, min, resetDb } from './helpers.js';

const NOW = at(10, 12, 8);
beforeEach(resetDb);

describe('design scenario: Today at 10:12', () => {
  it('reproduces the 72% day score, NOW/NEXT card and block states', async () => {
    await seedDemoData({ now: NOW });
    const day = await getDayModel(TODAY, { now: NOW });
    const by = Object.fromEntries(day.blocks.map((b) => [b.title, b]));

    expect(by['Morning workout'].state).toBe('done');
    expect(by['Email & messages']).toMatchObject({ state: 'offplan', tag: '+15 min' });
    expect(by['Plan the day'].state).toBe('unknown');
    expect(by['Deep work'].state).toBe('now');
    expect(by['Client check-in call'].state).toBe('upcoming');
    expect(by['Meditate']).toBeUndefined(); // Sat/Sun only
    expect(day.summary.followedPct).toBe(72); // "so far": in-progress and future blocks don't count
    expect(day.current.title).toBe('Deep work');
    expect(day.next.title).toBe('Client check-in call');
    expect(day.remainingSec).toBe(17 * 60 + 52);
    expect(day.nowLine.label).toBe('10:12');
    expect(day.unlogged.map((b) => b.title)).toEqual(['Plan the day']);
  });

  it('timer: start at 9:15, stop at 10:12 → "57 of 90 min", task score 90%', async () => {
    await seedDemoData({ now: NOW });
    const deep = (await getDayModel(TODAY, { now: NOW })).blocks.find((b) => b.title === 'Deep work');
    await startTimer(deep.key, { now: at(9, 15) });
    const running = await getDayModel(TODAY, { now: NOW });
    expect(running.blocks.find((b) => b.key === deep.key)).toMatchObject({ state: 'running', timer: { elapsedSec: 57 * 60 + 8 } });
    expect(running.current.key).toBe(deep.key);

    const log = await stopTimer(deep.key, { now: at(10, 12, 20) });
    expect(log).toMatchObject({ status: 'done', startMin: min(9, 15), endMin: min(10, 12), source: 'timer' });
    expect(await getRunningTimer()).toBeNull();
    const after = (await getDayModel(TODAY, { now: NOW })).blocks.find((b) => b.key === deep.key);
    expect(after.score).toBe(90);
    expect(after.actual.durationMin).toBe(57);
  });

  it('only one timer at a time; cancel frees it', async () => {
    await seedDemoData({ now: NOW });
    const [a, b] = (await getDayModel(TODAY, { now: NOW })).blocks.filter((x) => !x.log);
    await startTimer(a.key, { now: NOW });
    await expect(startTimer(b.key, { now: NOW })).rejects.toMatchObject({ code: 'timer-busy' });
    await cancelTimer(a.key);
    await expect(startTimer(b.key, { now: NOW })).resolves.toBeTruthy();
  });
});

describe('past days', () => {
  it('Oct 5-style review: logged, skipped and unknown are never confused', async () => {
    await seedDemoData({ now: NOW });
    const y = await getDayModel('2026-10-05', { now: NOW });
    const states = Object.fromEntries(y.blocks.map((b) => [b.title, b.state]));
    expect(states).toMatchObject({ 'Morning workout': 'done', 'Deep work': 'offplan', 'Lunch walk': 'skipped', 'Evening reading': 'unknown' });
    expect(y.blocks.find((b) => b.title === 'Deep work')).toMatchObject({ score: 75, tag: 'Started 60 min late' });
    expect(y.summary.missedPct).toBeGreaterThan(0);
    expect(y.summary.unknownPct).toBeGreaterThan(0); // unlogged is "unknown", not "missed"
  });
  it('week strip and month grid carry per-day rings', async () => {
    await seedDemoData({ now: NOW });
    const week = await getWeek(TODAY, { now: NOW });
    expect(week.map((d) => d.date)[0]).toBe('2026-10-05');
    expect(week[1]).toMatchObject({ isToday: true, followedPct: 72 });
    const month = await getMonth(2026, 9, { now: NOW });
    expect(month).toHaveLength(5);
    expect(month[0][0].inMonth).toBe(false);
    expect(month.flat().find((c) => c.date === '2026-10-05').followedPct).not.toBeNull();
    expect(month.flat().find((c) => c.date === '2026-10-20').followedPct).toBeNull(); // future: no score
  });
  it('trends: averages skip never-logged days; most-skipped counts', async () => {
    await seedDemoData({ now: NOW });
    const t = await getTrends('weekly', { now: NOW });
    expect(t.start).toBe('2026-09-30');
    expect(t.days).toHaveLength(7);
    expect(t.avgDayScore).not.toBeNull();
    expect(t.avgCoverage).toBeLessThan(100);
    expect(t.mostSkipped[0]).toMatchObject({ title: 'Lunch walk', skipped: 1 });
  });
});

describe('routines: "This day only" vs "This and future days"', () => {
  async function routine() {
    return createTask({ kind: 'routine', title: 'Run', startMin: min(6), durationMin: 30, repeat: { type: 'daily' }, validFrom: '2026-10-01' }, { now: NOW });
  }
  const blocksOn = async (d) => (await getDayModel(d, { now: NOW })).blocks;

  it('this day only: one day changes, the routine does not', async () => {
    const r = await routine();
    await updateTask(r.seriesId, { startMin: min(7), title: 'Long run' }, { scope: 'this', date: '2026-10-08', now: NOW });
    expect((await blocksOn('2026-10-08'))[0]).toMatchObject({ title: 'Long run', startMin: min(7), overridden: true });
    expect((await blocksOn('2026-10-09'))[0]).toMatchObject({ title: 'Run', startMin: min(6) });
  });
  it('this and future: past days keep their original plan', async () => {
    const r = await routine();
    await updateTask(r.seriesId, { startMin: min(7), durationMin: 45 }, { scope: 'future', date: '2026-10-06', now: NOW });
    expect((await blocksOn('2026-10-05'))[0]).toMatchObject({ startMin: min(6), durationMin: 30 });
    expect((await blocksOn('2026-10-06'))[0]).toMatchObject({ startMin: min(7), durationMin: 45 });
    expect((await blocksOn('2026-10-20'))[0]).toMatchObject({ startMin: min(7), durationMin: 45 });
    expect((await listTasks({ date: TODAY })).routines).toHaveLength(1); // still one routine on the Tasks screen
    // A second split keeps both histories intact.
    await updateTask(r.seriesId, { startMin: min(8) }, { scope: 'future', date: '2026-10-10', now: NOW });
    expect((await blocksOn('2026-10-09'))[0].startMin).toBe(min(7));
    expect((await blocksOn('2026-10-10'))[0].startMin).toBe(min(8));
  });
  it('delete this day / future days', async () => {
    const r = await routine();
    await deleteTask(r.seriesId, { scope: 'this', date: '2026-10-07', now: NOW });
    expect(await blocksOn('2026-10-07')).toHaveLength(0);
    expect(await blocksOn('2026-10-08')).toHaveLength(1);
    await deleteTask(r.seriesId, { scope: 'future', date: '2026-10-09', now: NOW });
    expect(await blocksOn('2026-10-08')).toHaveLength(1);
    expect(await blocksOn('2026-10-09')).toHaveLength(0);
    expect(await blocksOn('2026-10-02')).toHaveLength(1); // history untouched
    expect((await listTasks({ date: '2026-10-10' })).routines).toHaveLength(0);
  });
  it('custom days (Sat, Sun) and validation', async () => {
    await createTask({ kind: 'routine', title: 'Meditate', startMin: min(8), durationMin: 20, repeat: { type: 'custom', days: [6, 0] }, validFrom: '2026-10-01' });
    expect(await blocksOn('2026-10-06')).toHaveLength(0);
    expect(await blocksOn('2026-10-10')).toHaveLength(1);
    await expect(createTask({ kind: 'routine', title: '', startMin: 0, durationMin: 10 })).rejects.toMatchObject({ code: 'title' });
    await expect(createTask({ kind: 'oneoff', title: 'x', date: TODAY, startMin: min(23), durationMin: 90 })).rejects.toMatchObject({ code: 'durationMin' });
    await expect(createTask({ kind: 'routine', title: 'x', startMin: 0, durationMin: 10, repeat: { type: 'custom', days: [] } })).rejects.toMatchObject({ code: 'repeat' });
  });
});

describe('inbox, one-offs, duplicate, per-task chime', () => {
  it('inbox → scheduled one-off, tasks screen counts', async () => {
    expect(await isFirstRun()).toBe(true);
    const item = await createTask({ kind: 'inbox', title: 'Call the dentist' });
    expect(await isFirstRun()).toBe(false);
    expect((await listTasks({ date: TODAY })).inbox).toHaveLength(1);
    await scheduleInboxTask(item.id, { date: TODAY, startMin: min(15), durationMin: 15 });
    const list = await listTasks({ date: TODAY });
    expect(list.inbox).toHaveLength(0);
    expect(list.oneOffs[0]).toMatchObject({ title: 'Call the dentist', kind: 'oneoff' });
  });
  it('duplicate makes an independent copy; chime may be a name, null (default) or silence', async () => {
    const t = await createTask({ kind: 'oneoff', title: 'Call', date: TODAY, startMin: min(10), durationMin: 30, chimeId: 'none' });
    expect(t.chimeId).toBe('none');
    const copy = await duplicateTask(t.seriesId);
    expect(copy.seriesId).not.toBe(t.seriesId);
    expect(copy.title).toBe('Call copy');
    expect((await createTask({ kind: 'inbox', title: 'x', chimeId: 'nonsense' })).chimeId).toBeNull();
  });
});

describe('logging', () => {
  it('log, edit, clear; deleting a task keeps its history', async () => {
    const t = await createTask({ kind: 'oneoff', title: 'Call', date: TODAY, startMin: min(10, 30), durationMin: 30 }, { now: NOW });
    const key = `${t.seriesId}@${TODAY}`;
    await logDoneAsPlanned(key, { now: NOW });
    await saveLog({ key, status: 'done', startMin: min(10, 40), endMin: min(11, 10), note: 'ran late' }, { now: NOW });
    let b = (await getDayModel(TODAY, { now: NOW })).blocks[0];
    expect(b).toMatchObject({ state: 'done', score: 100, log: { note: 'ran late', source: 'manual' } }); // 10-min late = within tolerance
    await deleteTask(t.seriesId);
    b = (await getDayModel(TODAY, { now: NOW })).blocks[0];
    expect(b).toMatchObject({ title: 'Call', orphan: true, state: 'done' });
    await clearLog(key);
    expect((await getDayModel(TODAY, { now: NOW })).blocks).toHaveLength(0);
  });
  it('rejects impossible times; review flow logs several at once', async () => {
    const a = await createTask({ kind: 'oneoff', title: 'A', date: TODAY, startMin: min(8), durationMin: 30 }, { now: NOW });
    const b = await createTask({ kind: 'oneoff', title: 'B', date: TODAY, startMin: min(9), durationMin: 30 }, { now: NOW });
    await expect(saveLog({ key: `${a.seriesId}@${TODAY}`, status: 'done', startMin: 500, endMin: 480 })).rejects.toMatchObject({ code: 'times' });
    await expect(saveLog({ key: `missing@${TODAY}`, status: 'skipped' })).rejects.toMatchObject({ code: 'not-found' });
    await logMany([`${a.seriesId}@${TODAY}`, `${b.seriesId}@${TODAY}`], 'skipped', { now: NOW });
    expect((await getDayModel(TODAY, { now: NOW })).summary).toMatchObject({ followedPct: 0, missedPct: 100 });
  });
});
