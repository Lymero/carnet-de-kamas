/**
 * @file Aggregations behind the summary strip and the Analyse view. Pure functions only.
 *
 * Conventions:
 * - "Realised" figures only count sold trades.
 * - A sale is attributed to the month it was sold, or to the trade date when the
 *   sale date is unknown (rows imported from the old spreadsheet).
 */

import { CATEGORY } from "../config.js";
import { monthKey } from "./dates.js";
import { normalize } from "./text.js";
import { isCraft, profit } from "./trade.js";

/** @typedef {import("./trade.js").Trade} Trade */

const sum = (list, fn) => list.reduce((acc, x) => acc + fn(x), 0);

/**
 * Kamas spent on runes / forgemagie, part of the investment; 0 when not recorded.
 * @param {Trade} t
 */
export const fmCost = (t) => t.runes ?? 0;

/**
 * @typedef {Object} Summary
 * @property {number} realisedProfit
 * @property {number} realisedCost
 * @property {number} soldCount
 * @property {number} winCount        sold trades with a positive profit
 * @property {number} monthProfit     realised profit in the current month
 * @property {number} openCost        kamas tied up in unsold items
 * @property {number} openExpected    expected profit of unsold items
 * @property {number} openCount
 */

/**
 * Figures for the summary strip.
 * @param {Trade[]} trades
 * @param {string} todayIso
 * @returns {Summary}
 */
export function summarize(trades, todayIso) {
  const sold = trades.filter((t) => t.sold);
  const open = trades.filter((t) => !t.sold);
  const month = monthKey(todayIso);
  return {
    realisedProfit: sum(sold, profit),
    realisedCost: sum(sold, (t) => t.cost),
    soldCount: sold.length,
    winCount: sold.filter((t) => profit(t) > 0).length,
    monthProfit: sum(
      sold.filter((t) => saleMonth(t) === month),
      profit,
    ),
    openCost: sum(open, (t) => t.cost),
    openExpected: sum(open, profit),
    openCount: open.length,
  };
}

/**
 * Month a sale counts towards.
 * @param {Trade} t
 * @returns {string} "YYYY-MM"
 */
function saleMonth(t) {
  return monthKey(t.soldDate || t.date);
}

/**
 * @typedef {{cost: number, fm: number, profit: number, count: number}} Bucket
 *   fm: the part of `cost` spent on runes / forgemagie
 */

/**
 * Realised results split by category.
 * @param {Trade[]} trades
 * @returns {Record<"craft"|"resale", Bucket>}
 */
export function byCategory(trades) {
  const out = { [CATEGORY.CRAFT]: emptyBucket(), [CATEGORY.RESALE]: emptyBucket() };
  for (const t of trades) {
    if (!t.sold) continue;
    const b = out[isCraft(t) ? CATEGORY.CRAFT : CATEGORY.RESALE];
    b.cost += t.cost;
    b.fm += fmCost(t);
    b.profit += profit(t);
    b.count += 1;
  }
  return out;
}

/**
 * Realised profit per month, oldest first, limited to the most recent `limit` months that have sales.
 * @param {Trade[]} trades
 * @param {number} limit
 * @returns {{month: string, profit: number, count: number}[]}
 */
export function byMonth(trades, limit) {
  const map = new Map();
  for (const t of trades) {
    if (!t.sold) continue;
    const key = saleMonth(t);
    const b = map.get(key) ?? { month: key, profit: 0, count: 0 };
    b.profit += profit(t);
    b.count += 1;
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-limit);
}

/**
 * @typedef {Object} ItemStats
 * @property {string} name     display name (first spelling seen)
 * @property {number} sold
 * @property {number} open
 * @property {number} cost     realised cost
 * @property {number} fm       realised runes / forgemagie cost, part of `cost`
 * @property {number} profit   realised profit
 * @property {number} wins
 * @property {string} lastDate
 */

/**
 * Per-item results, best realised profit first. Names are grouped
 * accent- and case-insensitively.
 * @param {Trade[]} trades
 * @returns {ItemStats[]}
 */
export function byItem(trades) {
  const map = new Map();
  for (const t of trades) {
    const key = normalize(t.item);
    const s = map.get(key) ?? {
      name: t.item,
      sold: 0,
      open: 0,
      cost: 0,
      fm: 0,
      profit: 0,
      wins: 0,
      lastDate: t.date,
    };
    if (t.sold) {
      s.sold += 1;
      s.cost += t.cost;
      s.fm += fmCost(t);
      s.profit += profit(t);
      if (profit(t) > 0) s.wins += 1;
    } else {
      s.open += 1;
    }
    if (t.date > s.lastDate) s.lastDate = t.date;
    map.set(key, s);
  }
  return [...map.values()].sort((a, b) => b.profit - a.profit);
}

/**
 * How many times the player traded each item, keyed by normalised name.
 * Used to rank autocomplete suggestions.
 * @param {Trade[]} trades
 * @returns {Map<string, {name: string, count: number, lastCat: string, lastDate: string}>}
 */
export function itemHistory(trades) {
  const map = new Map();
  for (const t of trades) {
    const key = normalize(t.item);
    const h = map.get(key) ?? { name: t.item, count: 0, lastCat: t.cat, lastDate: "" };
    h.count += 1;
    if (t.date >= h.lastDate) {
      h.lastDate = t.date;
      h.lastCat = t.cat;
    }
    map.set(key, h);
  }
  return map;
}

function emptyBucket() {
  return { cost: 0, fm: 0, profit: 0, count: 0 };
}
