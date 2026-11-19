/**
 * @file Small trade markers, the same in every list: the type badge (Craft/FM, Achat/revente),
 * one shape where only the colour tells the types apart, and the status dot.
 */

import { CATEGORY_LABEL } from "../config.js";
import { isCraft, profit } from "../domain/trade.js";

/** @param {import("../domain/trade.js").Trade} trade */
export const categoryPill = (trade) =>
  `<span class="pill ${isCraft(trade) ? "craft" : "resale"}">${CATEGORY_LABEL[trade.cat]}</span>`;

/**
 * Status dot: hollow while for sale, filled once sold (red when sold at a loss); the word on hover.
 * @param {import("../domain/trade.js").Trade} trade
 */
export function statusDot(trade) {
  const [cls, label] = !trade.sold
    ? ["open", "En vente"]
    : profit(trade) < 0
      ? ["ko", "Vendu à perte"]
      : ["ok", "Vendu"];
  return `<span class="dot ${cls}" role="img" title="${label}" aria-label="${label}"></span>`;
}
