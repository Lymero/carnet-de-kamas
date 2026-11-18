/**
 * @file Moving data between the tracker and spreadsheets (Google Sheets, Excel).
 * Pure functions only.
 *
 * Import reads cells pasted from a spreadsheet (tab-separated, or `;`-separated CSV).
 * Export produces tab-separated text that pastes straight back into a sheet.
 */

import { CATEGORY, CATEGORY_LABEL } from "../config.js";
import { parseLooseDate } from "./dates.js";
import { parseKamas, ratioPercent } from "./kamas.js";
import { normalize } from "./text.js";
import { isCraft, profit, validateTrade } from "./trade.js";

/** @typedef {import("./trade.js").Trade} Trade */
/** @typedef {Omit<Trade, "id">} TradeDraft */
/** @typedef {"date"|"item"|"cat"|"cost"|"expected"|"sold"|"soldPrice"|"soldDate"} Field */

/**
 * Column order of the original spreadsheet, extended with the two sale columns
 * written by `toTsv`. Used when the paste has no header row:
 * Date | Item | Catégorie | Investissement | Vente potentielle | Bénéfice | Bénéfice % | Vendu ? | Prix de vente | Date de vente
 * @type {Readonly<Record<Field, number>>}
 */
const DEFAULT_COLUMNS = Object.freeze({
  date: 0,
  item: 1,
  cat: 2,
  cost: 3,
  expected: 4,
  sold: 7,
  soldPrice: 8,
  soldDate: 9,
});

/**
 * Header patterns (on normalised text) recognised for each field.
 * The sale columns are excluded from the generic ones ("date", "prix", "vendu").
 * @type {Readonly<Record<Field, RegExp>>}
 */
const HEADER_PATTERNS = Object.freeze({
  date: /^date(?! de vente)/,
  item: /^(item|objet)/,
  cat: /^(categ|type)/,
  cost: /^(invest|cout|achat)/,
  expected: /^(vente|prix)(?! de vente)/,
  sold: /^vendu(?! a\b)/,
  soldPrice: /^(prix de vente|vendu a)/,
  soldDate: /^date de vente/,
});

const TRUTHY = /^(true|vrai|oui|yes|x|1|✓|✔|☑)$/i;

/** Export header; the first eight columns match the original spreadsheet. */
const EXPORT_HEADER = Object.freeze([
  "Date",
  "Item",
  "Catégorie",
  "Investissement",
  "Vente potentielle",
  "Bénéfice",
  "Bénéfice %",
  "Vendu ?",
  "Prix de vente",
  "Date de vente",
]);

/**
 * Parses pasted spreadsheet rows into trade drafts.
 *
 * - A header row is detected by its labels; columns are then matched by name.
 * - Without a header, the column order of `DEFAULT_COLUMNS` is assumed.
 * - A row is counted as sold only when its "Vendu ?" cell is ticked; without
 *   that column every row is still for sale (never invent realised profit).
 * - A sold row uses "Prix de vente" when present, else the planned price
 *   (as the old sheet did), and "Date de vente" when present, else no sale date.
 * - Rows that would fail `validateTrade` are counted in `invalid` and skipped,
 *   so the preview matches what will actually be saved.
 *
 * @param {string} text
 * @returns {{rows: TradeDraft[], invalid: number}}
 */
export function parseSheetPaste(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  if (!lines.length) return { rows: [], invalid: 0 };

  const separator = lines[0].includes("\t") ? "\t" : ";";
  let cells = lines.map((l) => l.split(separator));
  /** @type {Record<Field, number>} */
  let cols = { ...DEFAULT_COLUMNS };

  const header = cells[0].map(normalize);
  if (header.some((h) => HEADER_PATTERNS.date.test(h) || HEADER_PATTERNS.item.test(h))) {
    cols = /** @type {Record<Field, number>} */ (
      Object.fromEntries(
        Object.entries(HEADER_PATTERNS).map(([field, re]) => [field, header.findIndex((h) => re.test(h))]),
      )
    );
    cells = cells.slice(1);
  }

  /** @type {TradeDraft[]} */
  const rows = [];
  let invalid = 0;
  for (const c of cells) {
    /** @param {Field} field */
    const cell = (field) => (cols[field] >= 0 ? String(c[cols[field]] ?? "").trim() : "");
    const expected = parseKamas(cell("expected"));
    const sold = TRUTHY.test(cell("sold"));
    const typedSalePrice = parseKamas(cell("soldPrice"));
    /** @type {TradeDraft} */
    const draft = {
      date: parseLooseDate(cell("date")) ?? "",
      item: cell("item"),
      cat: /achat|revente|resale/i.test(cell("cat")) ? CATEGORY.RESALE : CATEGORY.CRAFT,
      cost: parseKamas(cell("cost")),
      expected,
      sold,
      soldPrice: sold ? (Number.isNaN(typedSalePrice) ? expected : typedSalePrice) : null,
      soldDate: sold ? parseLooseDate(cell("soldDate")) : null,
      source: "sheet",
    };
    if (validateTrade(draft).length) invalid += 1;
    else rows.push(draft);
  }
  return { rows, invalid };
}

/**
 * Key used to recognise a row that is already in the tracker.
 * Date and amount only, so a spelling fix on the name does not create duplicates.
 * @param {{date: string, cost: number}} t
 * @returns {string}
 */
export function duplicateKey(t) {
  return `${t.date}|${t.cost}`;
}

/**
 * Splits drafts into those not yet in the tracker and those already present.
 *
 * Matching counts occurrences: each existing trade accounts for at most one
 * draft with the same key. Two identical crafts on the same day therefore both
 * import, while pasting the same rows a second time imports nothing.
 * @param {TradeDraft[]} drafts
 * @param {Trade[]} existing
 * @returns {{fresh: TradeDraft[], duplicates: number}}
 */
export function withoutDuplicates(drafts, existing) {
  /** @type {Map<string, number>} unmatched existing trades per key */
  const available = new Map();
  for (const t of existing) {
    const key = duplicateKey(t);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  const fresh = [];
  for (const d of drafts) {
    const key = duplicateKey(d);
    const left = available.get(key) ?? 0;
    if (left > 0) available.set(key, left - 1);
    else fresh.push(d);
  }
  return { fresh, duplicates: drafts.length - fresh.length };
}

/**
 * Tab-separated export, oldest first, with a header row. Every stored figure
 * (planned price, sale price, sale date) has its own column, so the text
 * re-imports through `parseSheetPaste` without loss. Recipe breakdowns are not exported.
 * @param {Trade[]} trades
 * @returns {string}
 */
export function toTsv(trades) {
  const rows = [...trades]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((t) => {
      const percent = ratioPercent(profit(t), t.cost);
      return [
        t.date,
        t.item,
        CATEGORY_LABEL[isCraft(t) ? CATEGORY.CRAFT : CATEGORY.RESALE],
        t.cost,
        t.expected,
        profit(t),
        Number.isNaN(percent) ? "" : percent.toFixed(2),
        t.sold ? "TRUE" : "FALSE",
        t.sold ? (t.soldPrice ?? t.expected) : "",
        t.soldDate ?? "",
      ];
    });
  return [EXPORT_HEADER, ...rows].map((r) => r.map(tsvCell).join("\t")).join("\n");
}

/**
 * A value as one spreadsheet cell: tabs and line breaks would split the row.
 * @param {unknown} value
 * @returns {string}
 */
function tsvCell(value) {
  return String(value).replace(/[\t\r\n]+/g, " ");
}
