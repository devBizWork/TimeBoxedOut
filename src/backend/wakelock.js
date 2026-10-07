/**
 * "Keep screen on": holds a screen wake lock so chimes keep playing during the routine.
 * The browser releases the lock whenever the page is hidden, so it is re-acquired on return.
 */
export function createWakeLock() {
  let sentinel = null;
  let wanted = false;

  async function acquire() {
    if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
    try {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => (sentinel = null));
      return true;
    } catch {
      return false; // denied (low battery, unsupported): chimes still work while the screen is on
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible' && wanted && !sentinel) acquire();
  };

  return {
    get supported() {
      return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
    },
    async set(on) {
      wanted = Boolean(on);
      if (wanted) {
        document.addEventListener('visibilitychange', onVisible);
        return acquire();
      }
      document.removeEventListener('visibilitychange', onVisible);
      await sentinel?.release();
      sentinel = null;
      return false;
    },
  };
}
