/**
 * @file The Trade entity: its shape, validation and derived values. Pure functions only.
 *
 * A trade is one item bought or crafted to be sold at the auction house (HDV).
 * The full field reference is in docs/DATA-MODEL.md.
 */

import { CATEGORY, ITEM_NAME_MAX, SCHEMA_VERSION } from "../config.js";
import { isIsoDate } from "./dates.js";
import { isKamas } from "./kamas.js";

/**
 * One ingredient line of a craft, frozen at the time of the craft.
 * @typedef {[ingredientId: number, quantity: number, unitPrice: number|null]} RecipeLine
 */

/**
 * @typedef {Object} Trade
 * @property {string} id            Document id in the `trades` collection.
 * @property {string} date          ISO date the item was crafted or bought.
 * @property {string} item          Item name as the player typed or picked it.
 * @property {"craft"|"resale"} cat Craft/FM or Achat/revente.
 * @property {number} cost          Kamas invested (whole number, ≥ 0).
 * @property {number} expected      Price the player plans to sell at.
 * @property {boolean} sold         Whether the item has been sold.
 * @property {number|null} soldPrice Actual sale price, set when sold.
 * @property {string|null} soldDate ISO date of the sale, when known.
 * @property {RecipeLine[]} [recipe] Ingredient breakdown, for crafts priced with the recipe helper.
 * @property {number} [runes]       Kamas spent on runes / forgemagie for this craft.
 * @property {string} [source]      Where the row came from: "sheet" for imported rows.
 * @property {string} [updatedAt]   ISO timestamp of the last write.
 * @property {number} [schemaVersion]
 */

/**
 * Builds a Trade from a stored document, filling defaults for documents written
 * by older versions of the app. Never throws: unknown shapes become safe values.
 *
 * Stored data is treated as untrusted (anyone with write access, or a script,
 * can put anything in the database), so every field the UI renders is checked
 * for type and shape here, not only escaped at render time.
 * @param {string} id
 * @param {Record<string, unknown>} raw
 * @returns {Trade}
 */
export function normalizeTrade(id, raw = {}) {
  const num = (v, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const sold = raw.sold === true;
  /** @type {Trade} */
  const trade = {
    ...raw,
    id,
    date: isIsoDate(raw.date) ? raw.date : "1970-01-01",
    item: typeof raw.item === "string" ? raw.item : "(sans nom)",
    cat: raw.cat === CATEGORY.RESALE ? CATEGORY.RESALE : CATEGORY.CRAFT,
    cost: num(raw.cost),
    expected: num(raw.expected),
    sold,
    soldPrice: sold ? num(raw.soldPrice, num(raw.expected)) : null,
    soldDate: sold && isIsoDate(raw.soldDate) ? raw.soldDate : null,
  };
  // Optional fields: keep them only when well formed (never write `undefined` back).
  const recipe = normalizeRecipe(raw.recipe);
  if (recipe) trade.recipe = recipe;
  else delete trade.recipe;
  if (typeof raw.runes !== "number" || !Number.isFinite(raw.runes)) delete trade.runes;
  if (typeof raw.source !== "string") delete trade.source;
  return trade;
}

/**
 * Keeps the well-formed lines of a stored recipe.
 * @param {unknown} raw
 * @returns {RecipeLine[]|null} null when there is no usable line
 */
function normalizeRecipe(raw) {
  if (!Array.isArray(raw)) return null;
  const lines = raw
    .filter(
      (line) =>
        Array.isArray(line) &&
        Number.isInteger(line[0]) &&
        typeof line[1] === "number" &&
        line[1] > 0 &&
        (line[2] == null || (typeof line[2] === "number" && Number.isFinite(line[2]))),
    )
    .map(
      ([ingredientId, quantity, unitPrice]) => /** @type {RecipeLine} */ ([ingredientId, quantity, unitPrice ?? null]),
    );
  return lines.length ? lines : null;
}

/**
 * Checks a trade before it is written. Returns user-facing messages (French).
 * @param {Partial<Trade>} t
 * @returns {string[]} empty when valid
 */
export function validateTrade(t) {
  const errors = [];
  const item = typeof t.item === "string" ? t.item.trim() : "";
  if (!item) errors.push("Indique le nom de l'objet.");
  else if (item.length > ITEM_NAME_MAX) errors.push(`Nom trop long (${ITEM_NAME_MAX} caractères au plus).`);
  if (!isIsoDate(t.date)) errors.push("Date invalide.");
  if (!Object.values(CATEGORY).includes(t.cat)) errors.push("Type inconnu.");
  if (!isKamas(t.cost)) errors.push("Investissement illisible : écris par ex. 1.8m ou 1 800 000.");
  if (!isKamas(t.expected)) errors.push("Vente prévue illisible : écris par ex. 2.6m.");
  if (t.sold && !isKamas(t.soldPrice)) errors.push("Prix de vente illisible.");
  if (t.soldDate != null && !isIsoDate(t.soldDate)) errors.push("Date de vente invalide.");
  else if (t.soldDate && isIsoDate(t.date) && t.soldDate < t.date) {
    errors.push("La date de vente est avant la date de l'opération.");
  }
  return errors;
}

/**
 * Price used for profit: the real sale price once sold, the planned price before.
 * @param {Trade} t
 * @returns {number}
 */
export function salePrice(t) {
  return t.sold ? (t.soldPrice ?? t.expected) : t.expected;
}

/**
 * Realised profit for sold trades, expected profit for open ones.
 * @param {Trade} t
 * @returns {number}
 */
export function profit(t) {
  return salePrice(t) - t.cost;
}

/** @param {Trade} t */
export const isCraft = (t) => t.cat !== CATEGORY.RESALE;

/** @param {Trade} t */
export const isOpen = (t) => !t.sold;

/**
 * Returns a copy of the trade marked as sold.
 * @param {Trade} t
 * @param {number} price
 * @param {string} dateIso
 * @returns {Trade}
 */
export function markSold(t, price, dateIso) {
  return { ...t, sold: true, soldPrice: price, soldDate: dateIso };
}

/**
 * New, collision-resistant document id ("t" + time + random).
 * @returns {string}
 */
export function newTradeId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Converts a trade into the document body stored in the database:
 * drops the id (it is the document path) and stamps version and time.
 * @param {Trade} t
 * @param {Date} [now]
 * @returns {Record<string, unknown>}
 */
export function toDocument(t, now = new Date()) {
  const body = { ...t };
  delete body.id;
  return { ...body, schemaVersion: SCHEMA_VERSION, updatedAt: now.toISOString() };
}
