/**
 * @file Date helpers. Dates are stored as ISO calendar strings ("2026-08-20"),
 * in the player's local time zone, never as timestamps. Pure functions only.
 */

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const DAY_MS = 86_400_000;

/**
 * Today's date in the local time zone.
 * @param {Date} [now] injectable clock, for tests
 * @returns {string} "YYYY-MM-DD"
 */
export function todayIso(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * True for a real calendar date written "YYYY-MM-DD" ("2026-02-30" is false).
 * @param {unknown} value
 * @returns {value is string}
 */
export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * "2026-08-20" → "20/08/26".
 * @param {string|null|undefined} iso
 * @returns {string} "—" when missing or not a valid date
 */
export function formatShortDate(iso) {
  if (!isIsoDate(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

/**
 * Whole days from one ISO date to another, never negative.
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {number}
 */
export function daysBetween(fromIso, toIso) {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS));
}

/**
 * Month key used for grouping: "2026-08-20" → "2026-08".
 * @param {string} iso
 * @returns {string}
 */
export function monthKey(iso) {
  return iso.slice(0, 7);
}

/**
 * "2026-08" → "août 2026", or "août" with `short`.
 * @param {string} key
 * @param {{short?: boolean}} [options]
 * @returns {string}
 */
export function monthLabel(key, { short = false } = {}) {
  const name = MONTHS[Number(key.slice(5, 7)) - 1];
  return short ? name : `${name} ${key.slice(0, 4)}`;
}

/**
 * Reads the date formats found in spreadsheets: ISO ("2026-08-20"),
 * day-first ("20/08/2026", "20.08.26"). Returns null when unreadable or when
 * the date does not exist, so a month-first date ("08/20/2026") is rejected
 * rather than silently swapped.
 * @param {unknown} raw
 * @returns {string|null} ISO date
 */
export function parseLooseDate(raw) {
  const s = String(raw ?? "").trim();
  let iso = null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/))) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    iso = `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return isIsoDate(iso) ? iso : null;
}
