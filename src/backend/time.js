/**
 * Date and time helpers.
 *
 * Conventions used everywhere in the backend:
 *   - a day is a local-calendar string "YYYY-MM-DD"
 *   - a time of day is whole minutes since local midnight (0–1440)
 *   - an instant is epoch milliseconds
 */

const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(value = Date.now()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toDateStr(parseDateStr(s)) === s;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr, n) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateStr) {
  return parseDateStr(dateStr).getDay();
}

/** Inclusive list of days from `start` to `end`. */
export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The instant a wall-clock time of day falls on, for a given day. Minutes may overflow into the next day. */
export function dateTimeMs(dateStr, minutes) {
  const d = parseDateStr(dateStr);
  d.setMinutes(minutes);
  return d.getTime();
}

/**
 * Wall-clock minutes (fractional) between local midnight of `dateStr` and instant `ms`.
 * Works on wall-clock fields, so a daylight-saving change never shifts a block.
 */
export function minutesSinceMidnight(ms, dateStr) {
  const d = new Date(ms);
  const [y, m, day] = dateStr.split('-').map(Number);
  const dayDiff = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(y, m - 1, day)) / 86400000);
  return dayDiff * 1440 + d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000;
}

export const minutesOfDay = (ms) => Math.floor(minutesSinceMidnight(ms, toDateStr(ms)));

/** Monday-first week containing `dateStr`. */
export function weekDates(dateStr) {
  const offset = (weekdayOf(dateStr) + 6) % 7;
  const monday = addDays(dateStr, -offset);
  return dateRange(monday, addDays(monday, 6));
}

/** Month grid, Monday-first, padded with neighbouring days: [[{date, inMonth}×7]×4–6]. */
export function monthGrid(year, monthIndex) {
  const first = toDateStr(new Date(year, monthIndex, 1));
  const last = toDateStr(new Date(year, monthIndex + 1, 0));
  const start = weekDates(first)[0];
  const end = weekDates(last)[6];
  const days = dateRange(start, end).map((date) => ({ date, inMonth: date >= first && date <= last }));
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** "6:30 am" / "18:30". Pass `suffix: false` to get "6:30" for ranges such as "6:30 – 7:30". */
export function formatTime(minutes, { hour12 = true, suffix = true } = {}) {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!hour12) return `${pad(h)}:${pad(m)}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)}${suffix ? (h < 12 ? ' am' : ' pm') : ''}`;
}

/** Hour-line label: "7 am", "12 pm" / "07:00". */
export function formatHourLabel(hour, hour12 = true) {
  if (!hour12) return `${pad(hour % 24)}:00`;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour % 24 < 12 ? 'am' : 'pm'}`;
}

export function formatRange(startMin, endMin, opts = {}) {
  return `${formatTime(startMin, { ...opts, suffix: false })} – ${formatTime(endMin, { ...opts, suffix: false })}`;
}

/** Countdown/timer text: 1072 s → "17:52", 3725 s → "1:02:05". */
export function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function formatDateLabel(dateStr, options = { weekday: 'long', month: 'short', day: 'numeric' }, locale = 'en-US') {
  return new Intl.DateTimeFormat(locale, options).format(parseDateStr(dateStr));
}

/** "8 days ago" style label for the backup status line. */
export function daysBetween(fromDateStr, toDateStr_) {
  return Math.round((parseDateStr(toDateStr_) - parseDateStr(fromDateStr)) / 86400000);
}
