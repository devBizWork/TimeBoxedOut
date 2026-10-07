/**
 * Backup and restore.
 *
 * A backup is one JSON file the user saves to Files (e.g. iCloud Drive › Routine):
 *   { app, formatVersion, schemaVersion, exportedAt, exportedAtMs, data: { tasks, overrides, logs, settings } }
 * Timers and device-local meta are deliberately left out.
 *
 * Restore has two modes (see the "Restore backup" screen):
 *   merge    adds the backup's rows; nothing local is deleted; when both sides have the same
 *            task/log/override, the one with the newer `updatedAt` stays (ties keep local).
 *   replace  erases local tasks, logs and overrides, then loads the backup exactly as saved.
 * Both run in one transaction: a failed restore leaves the phone untouched.
 */

import { APP_ID, MINUTES_PER_DAY, TASK_KINDS } from './constants.js';
import { DB_SCHEMA_VERSION, db } from './db.js';
import { ValidationError } from './keys.js';
import { scoreBlock } from './scoring.js';
import { getSettings, mergeSettings, withDefaults } from './settings.js';
import { daysBetween, toDateStr } from './time.js';

export const BACKUP_FORMAT_VERSION = 1;

export class BackupError extends Error {
  /** @param {'not-json'|'wrong-app'|'too-new'|'invalid'} code */
  constructor(message, code) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

export const backupFilename = (now = Date.now()) => `routine-backup-${toDateStr(now)}.json`;

/* ---------- Export ---------- */

export async function buildBackup({ now = Date.now() } = {}) {
  const [tasks, overrides, logs, settings] = await Promise.all([db.tasks.toArray(), db.overrides.toArray(), db.logs.toArray(), getSettings()]);
  return {
    app: APP_ID,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    exportedAtMs: now,
    data: { tasks, overrides, logs, settings },
  };
}

/** Returns the file to hand to `saveFile()`. Call `markBackedUp()` once the user has actually saved it. */
export async function exportBackup({ now = Date.now() } = {}) {
  const backup = await buildBackup({ now });
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  return { filename: backupFilename(now), blob, mime: 'application/json', backup };
}

export async function markBackedUp(now = Date.now()) {
  await db.transaction('rw', db.settings, async () => {
    const next = mergeSettings(await getSettings(), { backup: { lastBackupAt: now } });
    await db.settings.put({ key: 'app', value: next });
  });
}

/* ---------- Import ---------- */

const bad = (msg) => new BackupError(msg, 'invalid');
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function sanitizeTask(t, i) {
  if (!t || !isStr(t.id) || !isStr(t.title) || !TASK_KINDS.includes(t.kind)) throw bad(`Task ${i + 1} is damaged`);
  if (t.kind !== 'inbox' && !(Number.isInteger(t.startMin) && Number.isInteger(t.durationMin) && t.startMin >= 0 && t.startMin + t.durationMin <= MINUTES_PER_DAY && t.durationMin > 0)) {
    throw bad(`Task "${t.title}" has an invalid time`);
  }
  return { ...t, seriesId: isStr(t.seriesId) ? t.seriesId : t.id, updatedAt: isNum(t.updatedAt) ? t.updatedAt : 0, createdAt: isNum(t.createdAt) ? t.createdAt : 0 };
}
function sanitizeOverride(o, i) {
  if (!o || !isStr(o.key) || !isStr(o.seriesId) || !isStr(o.date)) throw bad(`Day edit ${i + 1} is damaged`);
  return { ...o, updatedAt: isNum(o.updatedAt) ? o.updatedAt : 0 };
}
function sanitizeLog(l, i) {
  if (!l || !isStr(l.key) || !isStr(l.seriesId) || !isStr(l.date) || !['done', 'skipped'].includes(l.status)) throw bad(`Log ${i + 1} is damaged`);
  if (l.status === 'done' && !(isNum(l.startMin) && isNum(l.endMin) && l.endMin > l.startMin)) throw bad(`Log ${i + 1} has invalid times`);
  return { ...l, updatedAt: isNum(l.updatedAt) ? l.updatedAt : 0, createdAt: isNum(l.createdAt) ? l.createdAt : 0 };
}

/** Parse + validate the text of a backup file. Throws BackupError with a user-presentable message. */
export function parseBackup(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError("That file isn't a Routine Tracker backup.", 'not-json');
  }
  if (!raw || raw.app !== APP_ID) throw new BackupError("That file isn't a Routine Tracker backup.", 'wrong-app');
  if (!Number.isInteger(raw.formatVersion) || raw.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupError('This backup was made by a newer version of the app. Update the app and try again.', 'too-new');
  }
  const d = raw.data;
  if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.logs)) throw bad('The backup is missing its tasks or logs.');
  const exportedAtMs = isNum(raw.exportedAtMs) ? raw.exportedAtMs : Date.parse(raw.exportedAt);
  if (!Number.isFinite(exportedAtMs)) throw bad('The backup has no save date.');
  return {
    app: APP_ID,
    formatVersion: raw.formatVersion,
    exportedAt: new Date(exportedAtMs).toISOString(),
    exportedAtMs,
    data: {
      tasks: d.tasks.map(sanitizeTask),
      overrides: (d.overrides ?? []).map(sanitizeOverride),
      logs: d.logs.map(sanitizeLog),
      settings: d.settings && typeof d.settings === 'object' ? d.settings : {},
    },
  };
}

export const readBackupFile = async (file) => parseBackup(await file.text());

/** The summary line on the Restore screen: "Saved Sep 28 · Tasks 11 · Days logged 27". */
export function previewBackup(backup) {
  return {
    exportedAt: backup.exportedAtMs,
    taskCount: new Set(backup.data.tasks.map((t) => t.seriesId)).size,
    logCount: backup.data.logs.length,
    daysLogged: new Set(backup.data.logs.map((l) => l.date)).size,
  };
}

/** What "Replace" would throw away: logs and tasks changed on this phone after the backup was saved. */
export async function replaceImpact(backup) {
  const [logsLost, tasksChanged] = await Promise.all([
    db.logs.where('updatedAt').above(backup.exportedAtMs).count(),
    db.tasks.where('updatedAt').above(backup.exportedAtMs).count(),
  ]);
  return { logsLost, tasksChanged, since: backup.exportedAtMs };
}

async function mergeTable(table, rows, keyField) {
  const existing = await table.bulkGet(rows.map((r) => r[keyField]));
  const toPut = [];
  let added = 0;
  let updated = 0;
  rows.forEach((row, i) => {
    const local = existing[i];
    if (!local) {
      added++;
      toPut.push(row);
    } else if (row.updatedAt > local.updatedAt) {
      updated++;
      toPut.push(row);
    }
  });
  await table.bulkPut(toPut);
  return { added, updated, skipped: rows.length - added - updated };
}

/**
 * @param {ReturnType<typeof parseBackup>} backup
 * @param {{mode:'merge'|'replace'}} opts
 */
export async function restoreBackup(backup, { mode }) {
  if (mode !== 'merge' && mode !== 'replace') throw new ValidationError('Choose merge or replace', 'mode');
  const { tasks, overrides, logs, settings } = backup.data;

  return db.transaction('rw', db.tasks, db.overrides, db.logs, db.timers, db.settings, async () => {
    if (mode === 'replace') {
      await Promise.all([db.tasks.clear(), db.overrides.clear(), db.logs.clear(), db.timers.clear()]);
      await db.tasks.bulkPut(tasks);
      await db.overrides.bulkPut(overrides);
      await db.logs.bulkPut(logs);
      const restored = mergeSettings(withDefaults(settings), { backup: { lastBackupAt: backup.exportedAtMs } });
      await db.settings.put({ key: 'app', value: restored });
      return { mode, tasks: { added: tasks.length }, overrides: { added: overrides.length }, logs: { added: logs.length } };
    }
    // Merge keeps this phone's settings.
    return {
      mode,
      tasks: await mergeTable(db.tasks, tasks, 'id'),
      overrides: await mergeTable(db.overrides, overrides, 'key'),
      logs: await mergeTable(db.logs, logs, 'key'),
    };
  });
}

/* ---------- Reminder ---------- */

/**
 * Drives the "Last backup was 8 days ago" banner and the Settings line "Sep 28 · 8 days ago".
 * `reminderDays` of 0/null turns the reminder off. A phone that has never been backed up counts
 * from first use, and nothing is due before there is anything to lose.
 */
export function backupStatus({ settings, firstUseAt = null, hasData = true, now = Date.now() }) {
  const { lastBackupAt, reminderDays } = settings.backup;
  const since = lastBackupAt ?? firstUseAt;
  const daysSince = since ? Math.max(0, daysBetween(toDateStr(since), toDateStr(now))) : null;
  const due = Boolean(reminderDays) && hasData && daysSince !== null && daysSince >= reminderDays;
  return { lastBackupAt, daysSince, never: lastBackupAt === null, due, reminderDays };
}

/* ---------- CSV ---------- */

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const hhmm = (min) => (min === null || min === undefined ? '' : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`);

export const CSV_COLUMNS = ['date', 'task', 'planned_start', 'planned_end', 'planned_min', 'status', 'actual_start', 'actual_end', 'actual_min', 'score', 'note'];

/** Logs as CSV for Numbers/Excel: UTF-8 with BOM, CRLF line endings, 24-hour times. */
export async function exportLogsCsv({ now = Date.now() } = {}) {
  const [logs, settings] = await Promise.all([db.logs.orderBy('date').toArray(), getSettings()]);
  logs.sort((a, b) => a.date.localeCompare(b.date) || a.plan.startMin - b.plan.startMin);
  const rows = logs.map((l) => {
    const score = scoreBlock(l.plan, l, settings.scoring);
    return [
      l.date, l.plan.title, hhmm(l.plan.startMin), hhmm(l.plan.startMin + l.plan.durationMin), l.plan.durationMin,
      l.status, hhmm(l.startMin), hhmm(l.endMin), l.status === 'done' ? l.endMin - l.startMin : '', score.score, l.note,
    ];
  });
  const text = '﻿' + [CSV_COLUMNS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return { filename: `routine-logs-${toDateStr(now)}.csv`, blob: new Blob([text], { type: 'text/csv;charset=utf-8' }), mime: 'text/csv', text };
}
