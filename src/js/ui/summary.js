/**
 * @file Summary strip at the top of the page (five KPI tiles).
 */

import { monthLabel, monthKey } from "../domain/dates.js";
import { formatCompact, formatPercent, ratioPercent, signClass } from "../domain/kamas.js";
import { summarize } from "../domain/stats.js";
import { plural } from "../domain/text.js";

/**
 * @param {HTMLElement} el
 * @param {import("../state.js").AppState} state
 * @param {string} todayIso
 */
export function renderSummary(el, state, todayIso) {
  const s = summarize(state.trades, todayIso);
  const losses = s.soldCount - s.winCount;
  const tiles = [
    ["Bénéfice réalisé", formatCompact(s.realisedProfit), signClass(s.realisedProfit), plural(s.soldCount, "vente")],
    [
      "Rendement moyen",
      formatPercent(ratioPercent(s.realisedProfit, s.realisedCost)),
      signClass(s.realisedProfit),
      `sur ${formatCompact(s.realisedCost)} investis`,
    ],
    ["Ce mois-ci", formatCompact(s.monthProfit), signClass(s.monthProfit), monthLabel(monthKey(todayIso))],
    [
      "Kamas immobilisés",
      formatCompact(s.openCost),
      "",
      `${s.openCount} en vente · ${s.openExpected >= 0 ? "+" : ""}${formatCompact(s.openExpected)} attendus`,
    ],
    [
      "Ventes gagnantes",
      s.soldCount ? `${Math.round((s.winCount / s.soldCount) * 100)} %` : "—",
      "",
      `${losses} à perte`,
    ],
  ];
  el.innerHTML = tiles
    .map(
      ([label, value, cls, note]) =>
        `<div class="kpi"><span>${label}</span><b class="${cls}">${value}</b><small>${note}</small></div>`,
    )
    .join("");
}
