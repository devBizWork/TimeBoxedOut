import { DEFAULT_SETTINGS } from './constants.js';
import { db } from './db.js';

const APP_KEY = 'app';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge `patch` over `base` (plain objects only; arrays and scalars replace). */
export function mergeSettings(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    out[k] = isObj(v) && isObj(base?.[k]) ? mergeSettings(base[k], v) : v;
  }
  return out;
}

/** Fill in anything missing, so settings written by an older version still work. */
export const withDefaults = (stored) => mergeSettings(DEFAULT_SETTINGS, stored ?? {});

export async function getSettings() {
  const row = await db.settings.get(APP_KEY);
  return withDefaults(row?.value);
}

export async function updateSettings(patch) {
  return db.transaction('rw', db.settings, async () => {
    const next = mergeSettings(await getSettings(), patch);
    await db.settings.put({ key: APP_KEY, value: next });
    return next;
  });
}

/** Device-local values (not part of backups): first-use date, last-active heartbeat, dismissed hints… */
export async function getMeta(name, fallback = null) {
  const row = await db.settings.get(`meta:${name}`);
  return row ? row.value : fallback;
}

export async function setMeta(name, value) {
  await db.settings.put({ key: `meta:${name}`, value });
}

/** Call once at startup: records first use (drives the backup reminder for brand-new installs). */
export async function ensureFirstUse(now = Date.now()) {
  const existing = await getMeta('firstUseAt');
  if (existing) return existing;
  await setMeta('firstUseAt', now);
  return now;
}
