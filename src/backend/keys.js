/** Identifiers and errors shared by pure and database modules (no Dexie import). */

export class ValidationError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** A block is one occurrence of a task on one day. Its key doubles as the key of its log, timer and override. */
export const blockKey = (seriesId, date) => `${seriesId}@${date}`;

export function parseBlockKey(key) {
  const i = key.lastIndexOf('@');
  if (i < 1) throw new ValidationError(`Bad block key: ${key}`, 'bad-key');
  return { seriesId: key.slice(0, i), date: key.slice(i + 1) };
}
