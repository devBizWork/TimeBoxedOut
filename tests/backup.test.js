import { beforeEach, describe, expect, it } from 'vitest';
import { BackupError, backupFilename, backupStatus, buildBackup, createTask, db, DEFAULT_SETTINGS, exportBackup, exportLogsCsv, getSettings, logDoneAsPlanned, markBackedUp, parseBackup, previewBackup, replaceImpact, restoreBackup, saveLog, seedDemoData, updateSettings } from '../src/backend/index.js';
import { TODAY, at, resetDb } from './helpers.js';

const NOW = at(10, 12);
beforeEach(resetDb);

const counts = async () => ({ tasks: await db.tasks.count(), logs: await db.logs.count(), overrides: await db.overrides.count() });
const roundTrip = async (now) => parseBackup(await (await exportBackup({ now })).blob.text());

describe('export / parse', () => {
  it('names the file like the design: routine-backup-2026-10-06.json', () => {
    expect(backupFilename(NOW)).toBe('routine-backup-2026-10-06.json');
  });
  it('round-trips, and previews tasks and days logged for the Restore screen', async () => {
    await seedDemoData({ now: NOW });
    const backup = await roundTrip(NOW);
    expect(backup.data.tasks.length).toBeGreaterThan(8);
    const p = previewBackup(backup);
    expect(p).toMatchObject({ exportedAt: NOW, taskCount: 14, daysLogged: 2 });
    expect((await buildBackup({ now: NOW })).data.logs).toHaveLength(p.logCount);
  });
  it('rejects things that are not backups, with a friendly code', () => {
    expect(() => parseBackup('not json')).toThrow(BackupError);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/isn't a Routine Tracker backup/);
    expect(() => parseBackup(JSON.stringify({ app: 'routine-tracker', formatVersion: 99, data: {} }))).toThrow(/newer version/);
    expect(() => parseBackup(JSON.stringify({ app: 'routine-tracker', formatVersion: 1, exportedAtMs: 1, data: { tasks: [{ id: 'x' }], logs: [] } }))).toThrow(/damaged/);
  });
});

describe('restore: merge', () => {
  it('adds the backup without deleting anything; newer log wins on the same block', async () => {
    await seedDemoData({ now: NOW });
    const backup = await roundTrip(NOW);

    // Diverge: local has a brand-new task and a newer edit of one log; the backup has an old log version.
    const extra = await createTask({ kind: 'inbox', title: 'Only on phone' }, { now: NOW + 1000 });
    const someLog = backup.data.logs[0];
    await saveLog({ key: someLog.key, status: 'skipped', note: 'newer on phone' }, { now: NOW + 5000 });
    await db.tasks.delete(backup.data.tasks[0].id); // deleted locally, present in backup → comes back
    const result = await restoreBackup(backup, { mode: 'merge' });

    expect(await db.tasks.get(extra.id)).toBeTruthy();
    expect(await db.tasks.get(backup.data.tasks[0].id)).toBeTruthy();
    expect((await db.logs.get(someLog.key)).note).toBe('newer on phone'); // newer local stays
    expect(result.logs.skipped).toBeGreaterThanOrEqual(1);
    expect(result.tasks.added).toBe(1);
  });
  it('takes the backup version when it is newer, and leaves local settings alone', async () => {
    await seedDemoData({ now: NOW });
    const backup = await roundTrip(NOW);
    const key = backup.data.logs[0].key;
    await saveLog({ key, status: 'skipped', note: 'old' }, { now: NOW - 99999 });
    await updateSettings({ day: { hour12: false } });
    const backupSettings = { ...backup, data: { ...backup.data, settings: { day: { hour12: true } } } };
    await restoreBackup(backupSettings, { mode: 'merge' });
    expect((await db.logs.get(key)).updatedAt).toBe(backup.data.logs[0].updatedAt);
    expect((await getSettings()).day.hour12).toBe(false);
  });
});

describe('restore: replace', () => {
  it('loads the backup exactly, erasing what was only on the phone, and reports what would be lost', async () => {
    await seedDemoData({ now: NOW });
    const backup = await roundTrip(NOW);
    const before = await counts();

    const task = await createTask({ kind: 'oneoff', title: 'Later', date: TODAY, startMin: 600, durationMin: 30 }, { now: NOW + 60_000 });
    await logDoneAsPlanned(`${task.seriesId}@${TODAY}`, { now: NOW + 90_000 });
    expect(await replaceImpact(backup)).toMatchObject({ logsLost: 1, tasksChanged: 1 });

    await restoreBackup(backup, { mode: 'replace' });
    expect(await counts()).toEqual(before);
    expect(await db.tasks.get(task.id)).toBeUndefined();
    expect((await getSettings()).backup.lastBackupAt).toBe(NOW); // "Last backup" = the file's date
  });
  it('is all-or-nothing: a bad mode changes nothing', async () => {
    await seedDemoData({ now: NOW });
    const before = await counts();
    await expect(restoreBackup(await roundTrip(NOW), { mode: 'bogus' })).rejects.toMatchObject({ code: 'mode' });
    expect(await counts()).toEqual(before);
  });
  it('an old backup missing newer settings keys still yields complete settings', async () => {
    const backup = await roundTrip(NOW);
    backup.data.settings = { sounds: { chimeId: 'bell' } };
    await restoreBackup(backup, { mode: 'replace' });
    const s = await getSettings();
    expect(s.sounds.chimeId).toBe('bell');
    expect(s.sounds.warningLeadMin).toBe(DEFAULT_SETTINGS.sounds.warningLeadMin);
  });
});

describe('backup reminder', () => {
  const day = 86400000;
  it('"Sep 28 · 8 days ago" is due after 7 days; never before; off when 0', () => {
    const settings = (backup) => ({ backup: { ...DEFAULT_SETTINGS.backup, ...backup } });
    const now = at(9, 0, 0, 6);
    expect(backupStatus({ settings: settings({ lastBackupAt: now - 8 * day }), now })).toMatchObject({ daysSince: 8, due: true, never: false });
    expect(backupStatus({ settings: settings({ lastBackupAt: now - 3 * day }), now }).due).toBe(false);
    expect(backupStatus({ settings: settings({ lastBackupAt: now - 30 * day, reminderDays: 0 }), now }).due).toBe(false);
    expect(backupStatus({ settings: settings({}), firstUseAt: now - 9 * day, now }).due).toBe(true); // never backed up: counts from first use
    expect(backupStatus({ settings: settings({}), firstUseAt: now - 9 * day, hasData: false, now }).due).toBe(false);
  });
  it('markBackedUp stores the time', async () => {
    await markBackedUp(NOW);
    expect((await getSettings()).backup.lastBackupAt).toBe(NOW);
  });
});

describe('CSV export', () => {
  it('quotes commas/quotes/newlines, uses a BOM and CRLF, and scores each log', async () => {
    const t = await createTask({ kind: 'oneoff', title: 'Plan, "big" rock', date: TODAY, startMin: 540, durationMin: 60 }, { now: NOW });
    await saveLog({ key: `${t.seriesId}@${TODAY}`, status: 'done', note: 'line1\nline2' }, { now: NOW });
    const { text, filename } = await exportLogsCsv({ now: NOW });
    expect(filename).toBe('routine-logs-2026-10-06.csv');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe('date,task,planned_start,planned_end,planned_min,status,actual_start,actual_end,actual_min,score,note');
    expect(lines[1]).toBe('2026-10-06,"Plan, ""big"" rock",09:00,10:00,60,done,09:00,10:00,60,100,"line1\nline2"');
  });
});
