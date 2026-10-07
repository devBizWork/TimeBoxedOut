/** Shared constants: palette, defaults and the chime catalogue. Pure data, no side effects. */

export const APP_ID = 'routine-tracker';
export const APP_NAME = 'Routine Tracker';
export const DB_NAME = 'routine-tracker';

/**
 * Block colours (hex from the design) and the category each one stands for.
 * The colour id is what is stored; `category` is the label shown in the picker.
 * (Category-to-colour pairing is inferred from the design's sample blocks; change it here only.)
 */
export const COLORS = [
  { id: 'mint', label: 'Mint', category: 'Movement', hex: '#D6F2E5' },
  { id: 'lilac', label: 'Lilac', category: 'Focus', hex: '#E4DFFC' },
  { id: 'butter', label: 'Butter', category: 'Admin', hex: '#FAF0C6' },
  { id: 'pink', label: 'Pink', category: 'Meetings', hex: '#F8DCEA' },
  { id: 'sky', label: 'Sky blue', category: 'Planning', hex: '#DCEBF8' },
  { id: 'peach', label: 'Peach', category: 'Personal', hex: '#FCE3D5' },
];
export const DEFAULT_COLOR = 'lilac';

export const QUICK_DURATIONS = [15, 30, 45, 60, 90, 120];

/** Weekday numbers follow Date#getDay(): 0 = Sunday … 6 = Saturday. */
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];

export const TASK_KINDS = ['routine', 'oneoff', 'inbox'];
export const REPEAT_TYPES = ['daily', 'weekdays', 'custom'];

export const MINUTES_PER_DAY = 1440;

/** Score weights: a done block earns 50, plus up to 25 for timing and up to 25 for length. */
export const SCORE_WEIGHTS = { base: 50, timing: 25, length: 25 };

/**
 * Chime catalogue. Each chime is synthesised with Web Audio (no audio files, so they
 * work offline). `partials` are [frequency ratio, relative gain, decay seconds].
 * `notes` are played in sequence: { f: Hz, at: seconds offset }.
 */
export const CHIMES = [
  { id: 'bamboo', label: 'Bamboo', wave: 'triangle', notes: [{ f: 660, at: 0 }, { f: 880, at: 0.13 }], partials: [[1, 1, 0.32], [2, 0.25, 0.18]] },
  { id: 'glass', label: 'Glass', wave: 'sine', notes: [{ f: 1046.5, at: 0 }], partials: [[1, 1, 1.4], [2, 0.3, 0.9], [3, 0.1, 0.5]] },
  { id: 'marimba', label: 'Marimba', wave: 'sine', notes: [{ f: 523.25, at: 0 }, { f: 659.25, at: 0.16 }], partials: [[1, 1, 0.55], [4, 0.2, 0.12]] },
  { id: 'bell', label: 'Bell', wave: 'sine', notes: [{ f: 880, at: 0 }], partials: [[1, 1, 1.8], [2.76, 0.4, 1.1], [5.4, 0.15, 0.6]] },
  { id: 'drop', label: 'Drop', wave: 'sine', notes: [{ f: 1200, at: 0, glideTo: 500, glide: 0.18 }], partials: [[1, 1, 0.3]] },
];
export const DEFAULT_CHIME = 'bamboo';
/** A task (or the app default) can be set to this to make no sound at all. */
export const SILENT = 'none';
export const CHIME_IDS = [...CHIMES.map((c) => c.id), SILENT];

/** Fixed sounds for the other two cues, so they are never confused with a task-change chime. */
export const CUE_SOUNDS = {
  warning: { wave: 'sine', notes: [{ f: 659.25, at: 0 }, { f: 783.99, at: 0.18 }], partials: [[1, 0.7, 0.35]] },
  end: { wave: 'sine', notes: [{ f: 783.99, at: 0 }, { f: 523.25, at: 0.2 }], partials: [[1, 0.8, 0.6], [2, 0.15, 0.3]] },
};

/** Defaults for the single `app` settings document. */
export const DEFAULT_SETTINGS = {
  sounds: {
    enabled: true, // the Today-header mute button
    volume: 0.8,
    chimeId: DEFAULT_CHIME, // task-change chime
    warning: true, // 5-minute warning before the next block
    warningLeadMin: 5,
    endSound: true, // when a block's time is up
    quietHours: { enabled: true, fromMin: 22 * 60, untilMin: 7 * 60 },
    keepScreenOn: true,
  },
  day: { startHour: 5, endHour: 23, hour12: true },
  scoring: { onTimeMin: 10, lengthPct: 10, zeroTimingMin: 60 },
  backup: { reminderDays: 7, lastBackupAt: null },
};
