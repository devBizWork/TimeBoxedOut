/**
 * A ticking clock for the now line, countdowns and chime scheduler.
 * Ticks on whole-second boundaries, stops while the page is hidden, and ticks immediately
 * when the page becomes visible again (iOS freezes timers in the background).
 */
export function createClock({ intervalMs = 1000, now = () => Date.now() } = {}) {
  const listeners = new Set();
  let timer = null;
  let running = false;

  const tick = () => {
    const t = now();
    listeners.forEach((fn) => fn(t));
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!running) return;
    const t = now();
    timer = setTimeout(() => {
      tick();
      schedule();
    }, intervalMs - (t % intervalMs) + 5);
  };
  const onVisibility = () => {
    if (!running) return;
    if (globalThis.document?.visibilityState === 'hidden') {
      clearTimeout(timer);
    } else {
      tick();
      schedule();
    }
  };

  return {
    now,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (running) return;
      running = true;
      globalThis.document?.addEventListener('visibilitychange', onVisibility);
      globalThis.addEventListener?.('pageshow', onVisibility);
      tick();
      schedule();
    },
    stop() {
      running = false;
      clearTimeout(timer);
      globalThis.document?.removeEventListener('visibilitychange', onVisibility);
      globalThis.removeEventListener?.('pageshow', onVisibility);
    },
    tick,
  };
}
