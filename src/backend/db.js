import Dexie from 'dexie';
import { DB_NAME } from './constants.js';

/**
 * On-device database (IndexedDB via Dexie). Nothing here ever leaves the phone.
 *
 *   tasks      one row per task *version*. A routine edited "this and future days" is
 *              split: the old row is closed with `validUntil`, a new row starts at
 *              `validFrom`. `seriesId` ties the versions together (= `id` for one-offs/inbox).
 *   overrides  "this day only" edits or removals of a routine occurrence, key `seriesId@date`.
 *   logs       what actually happened, key `seriesId@date` (one log per block). Carries a
 *              snapshot of the plan so history survives a deleted task.
 *   timers     the running timer, key `seriesId@date`. Survives a reload.
 *   settings   key/value. `app` = user settings (included in backups); `meta:*` = device-local.
 */
export const db = new Dexie(DB_NAME);

db.version(1).stores({
  tasks: 'id, seriesId, kind, date, validFrom, validUntil, updatedAt',
  overrides: 'key, seriesId, date, updatedAt',
  logs: 'key, seriesId, date, status, updatedAt',
  timers: 'key',
  settings: 'key',
});

// Future schema changes: add `db.version(2).stores({...}).upgrade(tx => ...)`; never edit version 1.
export const DB_SCHEMA_VERSION = 1;

export { ValidationError, newId, blockKey, parseBlockKey } from './keys.js';
