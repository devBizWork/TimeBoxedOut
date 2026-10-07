import { describe, expect, it, vi } from 'vitest';
import { AWAY_THRESHOLD_MS, buildChimeEvents, computeCatchUp, createChimePlayer, createEngine, getChimeSpec, isQuietHours, renderSpec, SILENT, DEFAULT_SETTINGS } from '../src/backend/index.js';
import { TODAY, at, min } from './helpers.js';

const block = (key, title, s, e, extra = {}) => ({
  key, title, startMin: min(...s), endMin: min(...e), durationMin: min(...e) - min(...s),
  startMs: at(...s), endMs: at(...e), log: null, state: 'upcoming', chimeId: null, ...extra,
});
const sounds = { ...DEFAULT_SETTINGS.sounds, quietHours: { enabled: false, fromMin: 0, untilMin: 0 } };

describe('quiet hours', () => {
  const q = { enabled: true, fromMin: min(22), untilMin: min(7) };
  it('wrap past midnight (10 pm → 7 am)', () => {
    expect(isQuietHours(min(23), q)).toBe(true);
    expect(isQuietHours(min(3), q)).toBe(true);
    expect(isQuietHours(min(7), q)).toBe(false);
    expect(isQuietHours(min(12), q)).toBe(false);
    expect(isQuietHours(min(22), q)).toBe(true);
  });
  it('same-day window and disabled', () => {
    expect(isQuietHours(min(13), { enabled: true, fromMin: min(12), untilMin: min(14) })).toBe(true);
    expect(isQuietHours(min(23), { ...q, enabled: false })).toBe(false);
  });
});

describe('chime events', () => {
  it('change at start, warning 5 min before, end at end', () => {
    const ev = buildChimeEvents(TODAY, [block('a', 'A', [9], [10])], sounds);
    expect(ev.map((e) => [e.kind, e.atMs])).toEqual([['warning', at(8, 55)], ['change', at(9)], ['end', at(10)]]);
  });
  it('respects the toggles; no end sound when the next block starts right then; silent / logged / orphan blocks are quiet', () => {
    const a = block('a', 'A', [9], [10]);
    const b = block('b', 'B', [10], [11]);
    const ev = buildChimeEvents(TODAY, [a, b], { ...sounds, warning: false });
    expect(ev.map((e) => e.id)).toEqual(['a:change', 'b:change', 'b:end']);
    expect(buildChimeEvents(TODAY, [a], { ...sounds, warning: false, endSound: false })).toHaveLength(1);
    expect(buildChimeEvents(TODAY, [block('s', 'S', [9], [10], { chimeId: SILENT })], sounds)).toHaveLength(0);
    expect(buildChimeEvents(TODAY, [block('l', 'L', [9], [10], { log: {} }), block('o', 'O', [11], [12], { orphan: true })], sounds)).toHaveLength(0);
  });
});

describe('catch-up ("While you were away")', () => {
  it('lists block changes since the app was last open, with their state now', () => {
    const blocks = [
      block('c', 'Client check-in call', [10, 30], [11], { state: 'unknown' }),
      block('d', 'Admin & invoices', [11, 15], [12], { state: 'unknown' }),
      block('l', 'Lunch walk', [12], [12, 30], { state: 'now' }),
    ];
    const r = computeCatchUp({ from: at(10, 20), to: at(12, 10), date: TODAY, blocks });
    expect(r.fromMin).toBe(min(10, 20));
    expect(r.toMin).toBe(min(12, 10));
    expect(r.changes.map((c) => [c.block.title, c.state])).toEqual([['Client check-in call', 'unknown'], ['Admin & invoices', 'unknown'], ['Lunch walk', 'now']]);
    expect(r.unlogged.map((b) => b.title)).toEqual(['Client check-in call', 'Admin & invoices']); // "Log these 2 now"
    expect(computeCatchUp({ from: at(6), to: at(6, 5), date: TODAY, blocks })).toBeNull();
  });
});

function harness({ blocks, settings = sounds, stored = null }) {
  const subs = new Set();
  const clock = { now: () => 0, subscribe: (fn) => (subs.add(fn), () => subs.delete(fn)) };
  const player = { play: vi.fn(() => true), setEnabled: vi.fn(), setVolume: vi.fn() };
  const store = new Map(stored ? [['rt:lastActiveAt', stored]] : []);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const engine = createEngine({ clock, player, storage, loadDay: async () => ({ blocks, settings: { sounds: settings } }) });
  const events = [];
  engine.subscribe((e) => events.push(e));
  return { engine, player, events, store, tick: (ms) => engine.tick(ms) };
}

describe('chime engine', () => {
  const blocks = [block('a', 'A', [9], [10], { chimeId: 'glass' }), block('b', 'B', [11], [12])];

  it('plays the block chime, then the end sound, only once each', async () => {
    const h = harness({ blocks });
    await h.engine.start();
    await h.tick(at(8, 59, 58));
    await h.tick(at(9, 0, 0, 6));
    await h.tick(at(9, 0, 1));
    expect(h.player.play).toHaveBeenCalledTimes(1);
    expect(h.player.play).toHaveBeenCalledWith('change', 'glass');
    await h.tick(at(9, 59, 59));
    await h.tick(at(10, 0, 0));
    expect(h.player.play).toHaveBeenLastCalledWith('end', 'glass');
    await h.tick(at(10, 0, 0)); // same instant again: nothing new
    expect(h.player.play).toHaveBeenCalledTimes(2);
  });
  it('uses the app default chime when the task has none, and warns first', async () => {
    const h = harness({ blocks });
    await h.engine.start();
    await h.tick(at(10, 54, 59));
    await h.tick(at(10, 55, 0));
    expect(h.player.play).toHaveBeenLastCalledWith('warning', 'bamboo');
    await h.tick(at(10, 59, 59));
    await h.tick(at(11, 0, 0));
    expect(h.player.play).toHaveBeenLastCalledWith('change', 'bamboo');
  });
  it('stays silent in quiet hours but still reports the event', async () => {
    const h = harness({ blocks, settings: { ...sounds, quietHours: { enabled: true, fromMin: min(8), untilMin: min(9, 30) } } });
    await h.engine.start();
    await h.tick(at(8, 59, 59));
    await h.tick(at(9, 0, 0));
    expect(h.player.play).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toMatchObject({ type: 'chime', kind: 'change', played: false, quiet: true });
  });
  it('after a long gap it reports a catch-up instead of replaying chimes', async () => {
    const h = harness({ blocks });
    await h.engine.start();
    await h.tick(at(8, 50));
    await h.tick(at(11, 0, 30)); // phone was locked for 2 h
    expect(h.player.play).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toMatchObject({ type: 'catchup' });
    expect(h.events.at(-1).changes.map((c) => c.block.key)).toEqual(['a', 'b']);
    await h.tick(at(11, 0, 31));
    expect(h.player.play).not.toHaveBeenCalled(); // already handled, not replayed
    expect(AWAY_THRESHOLD_MS).toBeGreaterThan(5000);
  });
  it('a cold start uses the stored heartbeat to build the catch-up', async () => {
    const h = harness({ blocks, stored: at(8, 30) });
    await h.engine.start();
    await h.tick(at(11, 5));
    expect(h.events.at(-1)).toMatchObject({ type: 'catchup', fromMin: min(8, 30) });
    expect(h.store.get('rt:lastActiveAt')).toBe(String(at(11, 5)));
  });
});

/** Minimal AudioContext double. */
function fakeAudio(initial = 'suspended') {
  const log = { osc: 0 };
  class Ctx {
    constructor() { this.state = initial; this.currentTime = 0; this.destination = {}; this.listeners = []; }
    addEventListener(_, fn) { this.listeners.push(fn); }
    async resume() { this.state = 'running'; this.listeners.forEach((f) => f()); }
    createBuffer() { return {}; }
    createBufferSource() { return { connect() {}, start() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n }; }
    createOscillator() { log.osc++; return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n, start() {}, stop() {} }; }
  }
  return { Ctx, log };
}

describe('chime player states', () => {
  it('needs a tap, then plays; mute wins; test() unlocks and un-mutes', async () => {
    const { Ctx, log } = fakeAudio();
    const p = createChimePlayer({ AudioContextImpl: Ctx });
    const seen = [];
    p.subscribe((s) => seen.push(s));
    expect(p.state()).toBe('needs-tap');
    expect(p.play('change')).toBe(false);
    await p.unlock();
    expect(p.state()).toBe('on');
    expect(p.play('change', 'bamboo')).toBe(true);
    expect(log.osc).toBeGreaterThan(0);
    p.setEnabled(false);
    expect(p.state()).toBe('muted');
    expect(p.play('end')).toBe(false);
    expect(await p.test('glass')).toBe(true);
    expect(p.state()).toBe('on');
    expect(p.play('change', SILENT)).toBe(false);
    expect(seen).toContain('muted');
  });
  it('catalogue: every chime and cue renders', () => {
    const { Ctx } = fakeAudio('running');
    const ctx = new Ctx();
    for (const id of ['bamboo', 'glass', 'marimba', 'bell', 'drop']) expect(renderSpec(ctx, getChimeSpec('change', id))).toBeGreaterThan(0);
    expect(getChimeSpec('change', 'unknown-id').notes.length).toBeGreaterThan(0);
    expect(renderSpec(ctx, getChimeSpec('warning'))).toBeGreaterThan(0);
    expect(renderSpec(ctx, getChimeSpec('end'))).toBeGreaterThan(0);
  });
});

describe('audio unlock listeners', () => {
  it('never listen on pointerdown (unlocking can shift layout mid-tap and make the tap miss)', () => {
    const added = [];
    const target = { addEventListener: (e) => added.push(e), removeEventListener() {} };
    createChimePlayer({ AudioContextImpl: fakeAudio().Ctx }).attachUnlockListeners(target);
    expect(added).toEqual(expect.arrayContaining(['touchend', 'click']));
    expect(added).not.toContain('pointerdown');
  });
});
