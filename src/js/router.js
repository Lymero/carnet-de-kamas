/**
 * @file Hash routing between the three views (#en-cours, #historique, #analyse).
 *
 * Only plain `#name` hashes are used: the artifact host passes nothing else
 * through to the page.
 */

import { VIEWS } from "./config.js";

/**
 * View to show for the current hash. Without a hash, open "En cours" when
 * something is for sale, otherwise "Historique".
 * @param {string} hash  location.hash
 * @param {boolean} hasOpenTrades
 * @returns {string}
 */
export function resolveView(hash, hasOpenTrades) {
  const name = hash.replace(/^#/, "");
  if (VIEWS.includes(name)) return name;
  return hasOpenTrades ? "en-cours" : "historique";
}

/**
 * Navigates to a view (updates the hash, which triggers `hashchange`).
 * @param {string} view
 */
export function go(view) {
  if (location.hash.slice(1) === view) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = view;
}
