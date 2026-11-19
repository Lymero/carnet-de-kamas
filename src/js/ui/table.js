/**
 * @file Cells shared by the tables (Historique, Par objet), so they fit their card: amounts
 * are shown short ("1,85 M"), the exact amount on hover.
 */

import { formatCompact, formatKamas } from "../domain/kamas.js";

/**
 * A right-aligned amount cell.
 * @param {number|null|undefined} n  null or NaN: no amount, `empty` is shown
 * @param {{cls?: string, empty?: string}} [options]  extra classes (sign colour…), text for no amount
 */
export function amountCell(n, { cls = "", empty = "" } = {}) {
  const className = `n${cls ? ` ${cls}` : ""}`;
  if (n == null || Number.isNaN(n)) return `<td class="${className}">${empty}</td>`;
  return `<td class="${className}" title="${formatKamas(n)}">${formatCompact(n)}</td>`;
}
