/**
 * @file "Analyse" view: craft vs. resale, profit per month, and results per item.
 */

import { CATEGORY, CHART_MONTHS } from "../../config.js";
import { formatCompact, formatKamas, formatPercent, ratioPercent, signClass } from "../../domain/kamas.js";
import { byCategory, byItem, byMonth } from "../../domain/stats.js";
import { plural } from "../../domain/text.js";
import { monthlyProfitChart } from "../chart.js";
import { closest, esc } from "../dom.js";

/**
 * @param {{onItem: (name: string) => void}} ctx  called when the player clicks an item row
 * @returns {import("./view.js").View}
 */
export function createAnalysisView({ onItem }) {
  /** @type {HTMLElement} */ let root;

  function render(state) {
    if (!state.trades.some((t) => t.sold)) {
      root.innerHTML = `<div class="empty">L'analyse apparaît dès ta première vente.</div>`;
      return;
    }
    const cats = byCategory(state.trades);
    const items = byItem(state.trades);
    const panel = (key, label) => {
      const b = cats[key];
      return `<div class="panel"><h3>${label}</h3><div class="big ${signClass(b.profit)}">${formatCompact(b.profit)}</div>
        <div class="hint">${plural(b.count, "vente")} · rendement ${formatPercent(ratioPercent(b.profit, b.cost))} · ${formatCompact(b.count ? b.profit / b.count : NaN)} par vente</div>
        ${key === CATEGORY.CRAFT && b.fm ? `<div class="hint">dont FM ${formatCompact(b.fm)} · ${formatPercent(ratioPercent(b.fm, b.cost)).replace("+", "")} de l'investi</div>` : ""}</div>`;
    };
    root.innerHTML = `
      <div class="split">${panel(CATEGORY.CRAFT, "Craft / FM")}${panel(CATEGORY.RESALE, "Achat / revente")}</div>
      <div class="panel chart"><h3>Bénéfice réalisé par mois</h3>${monthlyProfitChart(byMonth(state.trades, CHART_MONTHS))}</div>
      <div class="panel"><h3>Par objet</h3><div class="scroll"><table class="grid">
        <thead><tr><th>Objet</th><th class="n">Ventes</th><th class="n">En vente</th><th class="n">dont FM</th><th class="n">Bénéfice</th><th class="n">Rendement</th><th class="n">Moy. / vente</th><th class="n">Gagnantes</th></tr></thead>
        <tbody>${items
          .map(
            (s) => `<tr data-item="${esc(s.name)}" tabindex="0">
          <td>${esc(s.name)}</td><td class="n">${s.sold}</td><td class="n">${s.open || ""}</td>
          <td class="n fm">${s.fm ? formatKamas(s.fm) : ""}</td>
          <td class="n ${signClass(s.profit)}">${s.sold ? formatKamas(s.profit) : "—"}</td>
          <td class="n ${signClass(s.profit)}">${s.sold ? formatPercent(ratioPercent(s.profit, s.cost)) : "—"}</td>
          <td class="n">${s.sold ? formatCompact(s.profit / s.sold) : "—"}</td>
          <td class="n">${s.sold ? `${s.wins}/${s.sold}` : "—"}</td>
        </tr>`,
          )
          .join("")}</tbody>
      </table></div></div>`;
  }

  const onClick = (e) => {
    const row = closest(e, "tr[data-item]");
    if (row) onItem(row.dataset.item);
  };
  const onKeydown = (e) => {
    if (e.key === "Enter" && e.target.matches("tr[data-item]")) e.target.click();
  };

  return {
    mount(el) {
      root = el;
      root.addEventListener("click", onClick);
      root.addEventListener("keydown", onKeydown);
    },
    unmount() {
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeydown);
    },
    update: render,
  };
}
