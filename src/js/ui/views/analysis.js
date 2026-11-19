/**
 * @file "Analyse" view: craft vs. resale, profit per month, and results per item.
 */

import { CATEGORY, CHART_MONTHS } from "../../config.js";
import { formatCompact, formatKamas, formatPercent, ratioPercent, signClass } from "../../domain/kamas.js";
import { byCategory, byItem, byMonth } from "../../domain/stats.js";
import { normalize, plural } from "../../domain/text.js";
import { monthlyProfitChart } from "../chart.js";
import { closest, esc } from "../dom.js";
import { nextSort, sortHeader, sortRows } from "../sort.js";

/** @typedef {ReturnType<typeof byItem>[number]} ItemStats */

/** Items with no sale yet rank below every sold one on the result columns. */
const UNSOLD = -Infinity;
/** @type {import("../sort.js").SortColumn<ItemStats>[]} */
const COLUMNS = [
  { key: "item", label: "Objet", value: (s) => normalize(s.name) },
  { key: "sold", label: "Ventes", value: (s) => s.sold, numeric: true },
  { key: "open", label: "En vente", value: (s) => s.open, numeric: true },
  { key: "fm", label: "dont FM", value: (s) => s.fm, numeric: true },
  { key: "profit", label: "Bénéfice", value: (s) => (s.sold ? s.profit : UNSOLD), numeric: true },
  { key: "pct", label: "Rendement", value: (s) => (s.sold ? ratioPercent(s.profit, s.cost) : UNSOLD), numeric: true },
  { key: "avg", label: "Moy.", value: (s) => (s.sold ? s.profit / s.sold : UNSOLD), numeric: true },
  { key: "wins", label: "Gagnantes", value: (s) => (s.sold ? s.wins / s.sold : UNSOLD), numeric: true },
];

/**
 * @param {{onItem: (name: string) => void}} ctx  called when the player clicks an item row
 * @returns {import("./view.js").View}
 */
export function createAnalysisView({ onItem }) {
  /** @type {HTMLElement} */ let root;
  /** @type {import("../../state.js").AppState} */ let current;
  /** Survives switching tabs; most profitable first, as before. */
  let sort = { key: "profit", dir: -1 };

  function render(state = current) {
    current = state;
    if (!state.trades.some((t) => t.sold)) {
      root.innerHTML = `<div class="empty">L'analyse apparaît dès ta première vente.</div>`;
      return;
    }
    const cats = byCategory(state.trades);
    const items = sortRows(byItem(state.trades), COLUMNS, sort, (a, b) => b.profit - a.profit);
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
        <thead>${sortHeader(COLUMNS, sort)}</thead>
        <tbody>${items
          .map(
            (s) => `<tr data-item="${esc(s.name)}" tabindex="0" title="Voir dans l'historique">
          <td class="go">${esc(s.name)}</td><td class="n">${s.sold}</td><td class="n">${s.open || ""}</td>
          <td class="n fm" title="${s.fm ? formatKamas(s.fm) : ""}">${s.fm ? formatCompact(s.fm) : ""}</td>
          <td class="n ${signClass(s.profit)}" title="${s.sold ? formatKamas(s.profit) : ""}">${s.sold ? formatCompact(s.profit) : "—"}</td>
          <td class="n ${signClass(s.profit)}">${s.sold ? formatPercent(ratioPercent(s.profit, s.cost)) : "—"}</td>
          <td class="n">${s.sold ? formatCompact(s.profit / s.sold) : "—"}</td>
          <td class="n">${s.sold ? `${s.wins}/${s.sold}` : "—"}</td>
        </tr>`,
          )
          .join("")}</tbody>
      </table></div></div>`;
  }

  const onClick = (e) => {
    const sortBtn = closest(e, "[data-sort]");
    if (sortBtn) {
      sort = nextSort(sort, sortBtn.dataset.sort, COLUMNS);
      render();
      /** @type {HTMLElement|null} */ (root.querySelector(`[data-sort="${sortBtn.dataset.sort}"]`))?.focus();
      return;
    }
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
