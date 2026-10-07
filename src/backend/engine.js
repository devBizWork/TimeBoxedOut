/**
 * The chime engine: watches the clock and plays
 *   - the task-change chime when a block starts,
 *   - a warning before the next block starts (default 5 min),
 *   - an end-of-task sound when a block's time is up,
 * honouring mute, quiet hours and per-task chimes. When the app was suspended (phone locked,
 * app switched away) it does NOT replay the sounds it missed: it reports a catch-up instead,
 * so the user sees "while you were away…" rather than a burst of chimes.
 */

import { SILENT } from './constants.js';
import { dateTimeMs, minutesSinceMidnight, toDateStr } from './time.js';

/** A gap longer than this between ticks means the app was asleep, not just busy. */
export const AWAY_THRESHOLD_MS = 15_000;
const HEARTBEAT_MS = 5_000;

/** Overnight-aware: 22:00 → 07:00 covers late evening and early morning. */
export function isQuietHours(minuteOfDay, quiet) {
  if (!quiet?.enabled || quiet.fromMin === quiet.untilMin) return false;
  return quiet.fromMin < quiet.untilMin
    ? minuteOfDay >= quiet.fromMin && minuteOfDay < quiet.untilMin
    : minuteOfDay >= quiet.fromMin || minuteOfDay < quiet.untilMin;
}

/**
 * Every sound a day's blocks would make.
 * @returns {{id:string, kind:'change'|'warning'|'end', atMs:number, block:object}[]} sorted by time
 */
export function buildChimeEvents(date, blocks, sounds) {
  const events = [];
  for (const block of blocks) {
    if (block.orphan || block.log || block.chimeId === SILENT) continue; // deleted, finished or silenced blocks make no sound
    const startMs = dateTimeMs(date, block.startMin);
    const endMs = dateTimeMs(date, block.endMin);
    events.push({ id: `${block.key}:change`, kind: 'change', atMs: startMs, block });
    if (sounds.warning) events.push({ id: `${block.key}:warning`, kind: 'warning', atMs: startMs - sounds.warningLeadMin * 60_000, block });
    // When the next block begins right as this one ends, its change chime already says so.
    const handedOver = blocks.some((o) => o !== block && Math.abs(dateTimeMs(date, o.startMin) - endMs) < 60_000);
    if (sounds.endSound && !handedOver) events.push({ id: `${block.key}:end`, kind: 'end', atMs: endMs, block });
  }
  return events.sort((a, b) => a.atMs - b.atMs);
}

/**
 * "While you were away": block changes that passed silently between two instants.
 * @param {{from:number, to:number, date:string, blocks:object[]}} args  `blocks` come from the day model
 * @returns {null | {fromMin:number, toMin:number, changes:object[], unlogged:object[]}}
 *   `changes` = blocks that started in the window (with their state now); `unlogged` = blocks that
 *   ended in the window with nothing logged, i.e. what to offer "Log these N now" for.
 */
export function computeCatchUp({ from, to, date, blocks }) {
  const changes = blocks
    .filter((b) => b.startMs > from && b.startMs <= to)
    .map((b) => ({ atMin: b.startMin, block: b, state: b.state }));
  const unlogged = blocks.filter((b) => b.endMs > from && b.endMs <= to && !b.log && b.state === 'unknown');
  if (changes.length === 0 && unlogged.length === 0) return null;
  return {
    fromMin: Math.floor(minutesSinceMidnight(from, date)),
    toMin: Math.floor(minutesSinceMidnight(to, date)),
    changes,
    unlogged,
  };
}

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)) };
};
const safeLocalStorage = () => {
  try {
    const s = globalThis.localStorage;
    s.getItem('x');
    return s;
  } catch {
    return memoryStorage();
  }
};

/**
 * @param {object} deps
 * @param {{subscribe:Function}} deps.clock
 * @param {{play:Function}} deps.player
 * @param {(date:string, nowMs:number)=>Promise<{blocks:object[], settings:object}>} deps.loadDay  usually getDayModel + settings
 * @param {{getItem:Function,setItem:Function}} [deps.storage]  for the "last active" heartbeat
 */
export function createEngine({ clock, player, loadDay, storage = safeLocalStorage() }) {
  const listeners = new Set();
  const fired = new Set();
  let model = null; // { date, blocks, settings, events }
  let lastTick = null;
  let lastBeat = 0;
  let unsub = null;
  let loading = null;

  const emit = (e) => listeners.forEach((fn) => fn(e));

  async function refresh(nowMs = clock.now?.() ?? Date.now()) {
    const date = toDateStr(nowMs);
    const day = await loadDay(date, nowMs);
    model = { date, blocks: day.blocks, settings: day.settings, events: buildChimeEvents(date, day.blocks, day.settings.sounds) };
    player.setEnabled?.(day.settings.sounds.enabled);
    player.setVolume?.(day.settings.sounds.volume);
    return model;
  }

  async function onTick(nowMs) {
    if (loading) return;
    if (!model || model.date !== toDateStr(nowMs)) {
      loading = refresh(nowMs).finally(() => (loading = null));
      await loading;
    }
    const prev = lastTick ?? nowMs;
    lastTick = nowMs;
    const awayMs = nowMs - prev;

    if (awayMs > AWAY_THRESHOLD_MS) {
      // Reload so block states are current, then report instead of playing.
      await refresh(nowMs);
      for (const e of model.events) if (e.atMs > prev && e.atMs <= nowMs) fired.add(e.id);
      const lastActive = Number(storage.getItem('rt:lastActiveAt')) || prev;
      const from = Math.max(Math.min(lastActive, prev), dateTimeMs(model.date, 0));
      const summary = computeCatchUp({ from, to: nowMs, date: model.date, blocks: model.blocks });
      if (summary) emit({ type: 'catchup', ...summary });
    } else {
      const due = model.events.filter((e) => e.atMs > prev && e.atMs <= nowMs && !fired.has(e.id));
      for (const e of due) fired.add(e.id);
      // If a warning, a change and an end land in the same second, play only the most important.
      const pick = ['change', 'end', 'warning'].map((k) => due.find((e) => e.kind === k)).find(Boolean);
      if (pick) {
        const quiet = isQuietHours(minutesSinceMidnight(nowMs, model.date), model.settings.sounds.quietHours);
        const finished = pick.kind === 'end' && pick.block.log; // already logged: no need to announce the end
        const chimeId = pick.block.chimeId ?? model.settings.sounds.chimeId;
        const played = !quiet && !finished && chimeId !== SILENT && player.play(pick.kind, chimeId);
        emit({ type: 'chime', kind: pick.kind, block: pick.block, played: Boolean(played), quiet });
      }
    }

    if (nowMs - lastBeat >= HEARTBEAT_MS) {
      lastBeat = nowMs;
      storage.setItem('rt:lastActiveAt', nowMs);
    }
  }

  return {
    /** Load today's blocks and start listening to the clock. */
    async start() {
      await refresh();
      // Seeding from the last heartbeat lets a cold start (iOS killed the app) show the catch-up too.
      lastTick = Number(storage.getItem('rt:lastActiveAt')) || null;
      unsub?.();
      unsub = clock.subscribe((t) => void onTick(t));
    },
    stop() {
      unsub?.();
      unsub = null;
    },
    /** Call after the user changes tasks, logs or settings so the schedule stays current. */
    refresh,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Exposed for tests and for driving the engine manually. */
    tick: onTick,
    get events() {
      return model?.events ?? [];
    },
  };
}
