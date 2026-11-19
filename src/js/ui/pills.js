/**
 * @file The trade type badge (Craft/FM, Achat/revente), the same in every list: one shape,
 * only the colour tells the types apart.
 */

import { CATEGORY_LABEL } from "../config.js";
import { isCraft } from "../domain/trade.js";

/** @param {import("../domain/trade.js").Trade} trade */
export const categoryPill = (trade) =>
  `<span class="pill ${isCraft(trade) ? "craft" : "resale"}">${CATEGORY_LABEL[trade.cat]}</span>`;
