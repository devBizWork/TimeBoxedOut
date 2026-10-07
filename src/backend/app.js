/**
 * Wires the backend together for the browser: clock → chime engine → chime player, plus wake lock.
 * Screens call `startApp()` once and then use the pieces it returns.
 */

import { createChimePlayer } from './chimes.js';
import { createClock } from './clock.js';
import { liveQuery } from 'dexie';
import { db } from './db.js';
import { getDayModel } from './days.js';
import { createEngine } from './engine.js';
import { ensureFirstUse, getSettings } from './settings.js';
import { createWakeLock } from './wakelock.js';
import { requestPersistentStorage } from './pwa.js';

export async function startApp() {
  await ensureFirstUse();
  const settings = await getSettings();

  const clock = createClock();
  const player = createChimePlayer();
  player.setEnabled(settings.sounds.enabled);
  player.setVolume(settings.sounds.volume);
  const stopUnlockListeners = player.attachUnlockListeners();

  const engine = createEngine({
    clock,
    player,
    loadDay: async (date, now) => {
      const model = await getDayModel(date, { now });
      return { blocks: model.blocks, settings: model.settings };
    },
  });
  const wakeLock = createWakeLock();
  await wakeLock.set(settings.sounds.keepScreenOn);

  await engine.start();
  clock.start();
  requestPersistentStorage();

  // Keep the chime schedule and wake lock in step with edits: any change to tasks, logs, timers or
  // settings re-reads today. (`count()` observes the whole table, so it also fires for other days.)
  const watch = liveQuery(() => Promise.all([db.tasks.count(), db.overrides.count(), db.logs.count(), db.timers.count(), getSettings()])).subscribe({
    next: ([, , , , latest]) => {
      engine.refresh();
      wakeLock.set(latest.sounds.keepScreenOn);
    },
    error: (err) => console.error('[routine] live sync failed', err),
  });

  return {
    clock,
    player,
    engine,
    wakeLock,
    stop() {
      clock.stop();
      engine.stop();
      stopUnlockListeners();
      watch.unsubscribe();
      wakeLock.set(false);
    },
  };
}
