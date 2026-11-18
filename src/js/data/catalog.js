/**
 * @file Read-only catalog of Dofus items and craft recipes, used for
 * autocomplete and the recipe cost helper.
 *
 * The data file is generated offline by scripts/build_catalog.py (see README).
 * Its shape is compact to keep the download small:
 *
 *   {
 *     "types":   ["Amulette", "Anneau", ...],                  // item type names
 *     "items":   [[id, "Nom FR", level, typeIndex], ...],
 *     "recipes": { "<resultId>": [[ingredientId, quantity], ...] }
 *   }
 *
 * Search ranking lives here (not in the UI) so it can be unit tested.
 */

import { AUTOCOMPLETE } from "../config.js";
import { normalize } from "../domain/text.js";

/**
 * @typedef {Object} CatalogItem
 * @property {number} id
 * @property {string} name
 * @property {number} level
 * @property {string} type
 * @property {string} key                    normalised name
 * @property {Array<[number, number]>|null} recipe  [ingredientId, quantity] pairs
 */

/**
 * @typedef {Object} Suggestion
 * @property {string} name
 * @property {string} detail       secondary text shown on the right
 * @property {boolean} own         true when the player has traded this item before
 * @property {CatalogItem|null} item
 */

export class ItemCatalog {
  /**
   * @param {{types: string[], items: Array<[number, string, number, number]>, recipes: Record<string, Array<[number, number]>>}} data
   */
  constructor(data) {
    /** @type {Map<number, CatalogItem>} */
    this.byId = new Map();
    /** @type {Map<string, CatalogItem>} one entry per distinct name */
    this.byKey = new Map();

    for (const [id, name, level, typeIndex] of data.items) {
      const recipe = data.recipes[id] ?? null;
      const item = { id, name, level, type: data.types[typeIndex] ?? "", key: normalize(name), recipe };
      this.byId.set(id, item);
      // Several game items can share a name (event or legacy versions): keep a craftable one.
      const previous = this.byKey.get(item.key);
      if (!previous || (!previous.recipe && recipe)) this.byKey.set(item.key, item);
    }
    /** @type {CatalogItem[]} */
    this.list = [...this.byKey.values()];
  }

  /** An empty catalog, used until the data file has loaded or if it fails to load. */
  static empty() {
    return new ItemCatalog({ types: [], items: [], recipes: {} });
  }

  /**
   * Downloads and builds the catalog.
   * @param {string} url
   * @param {typeof fetch} [fetchImpl]
   * @returns {Promise<ItemCatalog>}
   */
  static async load(url, fetchImpl = fetch) {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
    return new ItemCatalog(await response.json());
  }

  /**
   * Item with this exact name (accent- and case-insensitive).
   * @param {string} name
   * @returns {CatalogItem|null}
   */
  findByName(name) {
    return this.byKey.get(normalize(name)) ?? null;
  }

  /**
   * Display name for an ingredient id.
   * @param {number} id
   * @returns {string}
   */
  ingredientName(id) {
    return this.byId.get(Number(id))?.name ?? `Ingrédient #${id}`;
  }

  /**
   * Suggestions for the item field.
   *
   * Ranking:
   * 1. items the player already traded, most traded first (shown even for an empty query);
   * 2. catalog items whose name starts with the query, then items that contain it;
   *    within each group craftable items first, then higher level first.
   *
   * @param {string} query
   * @param {Map<string, {name: string, count: number}>} history  from stats.itemHistory
   * @param {{limit?: number, ownLimit?: number, minQuery?: number}} [options]
   * @returns {Suggestion[]}
   */
  suggest(
    query,
    history,
    { limit = AUTOCOMPLETE.LIMIT, ownLimit = AUTOCOMPLETE.OWN_LIMIT, minQuery = AUTOCOMPLETE.MIN_QUERY } = {},
  ) {
    const q = normalize(query);
    const out = [];
    const taken = new Set();

    const own = [...history.entries()]
      .filter(([key]) => !q || key.includes(q))
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, ownLimit);
    for (const [key, h] of own) {
      out.push({ name: h.name, detail: `${h.count}× déjà`, own: true, item: this.byKey.get(key) ?? null });
      taken.add(key);
    }

    if (q.length >= minQuery) {
      const starts = [];
      const contains = [];
      for (const item of this.list) {
        if (taken.has(item.key)) continue;
        const at = item.key.indexOf(q);
        if (at === 0) starts.push(item);
        else if (at > 0) contains.push(item);
      }
      const rank = (a, b) => Number(!!b.recipe) - Number(!!a.recipe) || b.level - a.level;
      for (const item of [...starts.sort(rank), ...contains.sort(rank)].slice(0, Math.max(0, limit - out.length))) {
        out.push({ name: item.name, detail: `${item.type} · niv. ${item.level}`, own: false, item });
      }
    }
    return out;
  }
}

/**
 * Cost of a craft from unit prices.
 * @param {Array<[number, number]>} recipe   [ingredientId, quantity] pairs
 * @param {(id: number) => number|undefined} priceOf  unit price lookup; missing prices count as 0
 * @param {number} [extra]   runes / forgemagie spend
 * @returns {{total: number, missing: number}} `missing` = ingredients without a price
 */
export function recipeCost(recipe, priceOf, extra = 0) {
  let total = 0;
  let missing = 0;
  for (const [id, quantity] of recipe) {
    const price = priceOf(id);
    if (price == null) missing += 1;
    else total += price * quantity;
  }
  return { total: total + (extra || 0), missing };
}
