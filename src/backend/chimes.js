/**
 * Chimes, synthesised with Web Audio so they work offline and need no audio files.
 *
 * iOS rules this module works around:
 *  - audio is blocked until a user gesture: `unlock()` must run inside a tap. The player
 *    reports `needs-tap` until then (the Today header shows "Tap to turn on sounds").
 *  - a backgrounded web app is suspended, so chimes only play while the app is on screen.
 *  - the Silent switch mutes Web Audio; `navigator.audioSession.type = 'playback'` (Safari 16.4+)
 *    asks iOS to play anyway. Where unsupported, the switch still wins (the Settings screen says so).
 */

import { CHIMES, CUE_SOUNDS, DEFAULT_CHIME, SILENT } from './constants.js';

/** 'on' = will play · 'muted' = user turned sounds off · 'needs-tap' = enabled but audio is still locked. */
export const SOUND_STATES = ['on', 'muted', 'needs-tap'];

export function getChimeSpec(kind, chimeId) {
  if (kind === 'warning' || kind === 'end') return CUE_SOUNDS[kind];
  return CHIMES.find((c) => c.id === chimeId) ?? CHIMES.find((c) => c.id === DEFAULT_CHIME);
}

/** Schedule one chime on an AudioContext. Returns the time it finishes ringing. */
export function renderSpec(ctx, spec, { when = ctx.currentTime, volume = 0.8, destination = ctx.destination } = {}) {
  let end = when;
  for (const note of spec.notes) {
    const t0 = when + note.at;
    for (const [ratio, gain, decay] of spec.partials) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = spec.wave;
      osc.frequency.setValueAtTime(note.f * ratio, t0);
      if (note.glideTo) osc.frequency.exponentialRampToValueAtTime(note.glideTo * ratio, t0 + (note.glide ?? 0.2));
      const peak = Math.max(0.0001, gain * volume * 0.5);
      amp.gain.setValueAtTime(0.0001, t0);
      amp.gain.linearRampToValueAtTime(peak, t0 + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      osc.connect(amp).connect(destination);
      osc.start(t0);
      osc.stop(t0 + decay + 0.05);
      end = Math.max(end, t0 + decay + 0.05);
    }
  }
  return end;
}

/**
 * @param {{AudioContextImpl?: typeof AudioContext}} [opts]
 */
export function createChimePlayer({ AudioContextImpl = globalThis.AudioContext ?? globalThis.webkitAudioContext } = {}) {
  let ctx = null;
  let enabled = true;
  let volume = 0.8;
  const listeners = new Set();

  const state = () => {
    if (!enabled) return 'muted';
    return ctx && ctx.state === 'running' ? 'on' : 'needs-tap';
  };
  const emit = () => listeners.forEach((fn) => fn(state()));

  function ensureContext() {
    if (!ctx && AudioContextImpl) {
      ctx = new AudioContextImpl();
      ctx.addEventListener?.('statechange', emit);
    }
    return ctx;
  }

  return {
    state,
    /** Subscribe to state changes ('on' | 'muted' | 'needs-tap'). Returns an unsubscribe function. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setEnabled(value) {
      enabled = Boolean(value);
      emit();
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
    },
    /** Must be called from a tap/click handler. Safe to call repeatedly. */
    async unlock() {
      const c = ensureContext();
      if (!c) return false;
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback';
      } catch {
        /* unsupported: fine */
      }
      try {
        if (c.state !== 'running') await c.resume();
        // A one-sample silent buffer fully unlocks iOS output.
        const src = c.createBufferSource();
        src.buffer = c.createBuffer(1, 1, 22050);
        src.connect(c.destination);
        src.start(0);
      } catch {
        /* the next tap tries again */
      }
      emit();
      return c.state === 'running';
    },
    /** Listen for the first tap anywhere and unlock audio. Returns a cleanup function. */
    attachUnlockListeners(target = globalThis.document) {
      if (!target) return () => {};
      // Not `pointerdown`: unlocking flips the sound state, which can remove a "tap to enable" banner and
      // shift the layout between press and release, so the tap would miss its target. iOS counts
      // touchend/click as the user activation it needs.
      const events = ['touchend', 'click', 'keydown'];
      const handler = async () => {
        if (await this.unlock()) off();
      };
      const off = () => events.forEach((e) => target.removeEventListener(e, handler, true));
      events.forEach((e) => target.addEventListener(e, handler, { capture: true, passive: true }));
      return off;
    },
    /**
     * @param {'change'|'warning'|'end'} kind
     * @param {string|null} [chimeId] only used for 'change'
     * @returns {boolean} whether anything was actually played
     */
    play(kind = 'change', chimeId = null, { force = false } = {}) {
      if (chimeId === SILENT && kind === 'change') return false;
      if (!force && state() !== 'on') return false;
      const c = ensureContext();
      if (!c || c.state !== 'running') return false;
      renderSpec(c, getChimeSpec(kind, chimeId), { volume });
      return true;
    },
    /** The Settings "Play" button: unlocks audio and turns sound on for this visit. */
    async test(chimeId = null) {
      enabled = true;
      await this.unlock();
      emit();
      return this.play('change', chimeId, { force: true });
    },
    close() {
      ctx?.close?.();
      ctx = null;
    },
  };
}
