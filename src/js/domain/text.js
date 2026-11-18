/**
 * @file Text helpers shared by the domain and the UI. Pure functions only.
 */

/**
 * Normalises a string for comparison and search: lower case, accents removed,
 * French ligatures expanded, punctuation (apostrophes, hyphens) turned into single spaces.
 * "Coiffe d’Ogivol", "coiffe d'ogivol" and "COIFFE D OGIVOL" share the key "coiffe d ogivol",
 * so players can type names without apostrophes or accents.
 * @param {unknown} value
 * @returns {string}
 */
export function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining diacritics left by NFD
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/**
 * Escapes a value for safe interpolation into HTML text or a quoted attribute.
 * Every user-provided string must pass through this before reaching innerHTML.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * Count with a correctly pluralised French noun: plural(1, "vente") → "1 vente", plural(3, "vente") → "3 ventes".
 * @param {number} n
 * @param {string} singular
 * @param {string} [pluralForm] defaults to singular + "s"
 * @returns {string}
 */
export function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${Math.abs(n) >= 2 ? pluralForm : singular}`;
}
