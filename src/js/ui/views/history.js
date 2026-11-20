/**
 * @file "Historique" view: every trade in a sortable, filterable table with totals,
 * plus import from and export to a spreadsheet.
 *
 * The toolbar is rendered once per mount so the search box keeps focus while
 * typing; only the results region re-renders. The type/month/status selects sit
 * in a row the filter button shows or hides, so the toolbar fits on one line.
 */

import { CATEGORY, CATEGORY_LABEL } from "../../config.js";
import { formatShortDate, monthKey, monthLabel } from "../../domain/dates.js";
import { formatPercent, ratioPercent, signClass } from "../../domain/kamas.js";
import { toTsv } from "../../domain/sheet-io.js";
import { fmCost } from "../../domain/stats.js";
import { normalize, plural } from "../../domain/text.js";
import { profit, salePrice } from "../../domain/trade.js";
import { $, closest, esc, toast } from "../dom.js";
import { categoryPill, statusDot } from "../pills.js";
import { amountCell } from "../table.js";
import { nextSort, sortHeader, sortRows } from "../sort.js";

/** @typedef {import("../../domain/trade.js").Trade} Trade */

/** @type {import("../sort.js").SortColumn<Trade>[]} */
const COLUMNS = [
  { key: "date", label: "Date", value: (t) => t.date, first: -1 },
  { key: "item", label: "Objet", value: (t) => normalize(t.item) },
  { key: "cat", label: "Type", value: (t) => t.cat },
  { key: "cost", label: "Investi", value: (t) => t.cost, numeric: true },
  { key: "fm", label: "dont FM", value: fmCost, numeric: true },
  { key: "price", label: "Vente", value: salePrice, numeric: true },
  { key: "profit", label: "Bénéfice", value: profit, numeric: true },
  { key: "pct", label: "%", value: (t) => ratioPercent(profit(t), t.cost), numeric: true },
  { key: "sold", label: "●", title: "Statut", value: (t) => (t.sold ? 1 : 0), first: -1 },
];

/** Status filter predicates. */
const STATUS = {
  open: (t) => !t.sold,
  sold: (t) => t.sold,
  loss: (t) => t.sold && profit(t) < 0,
};

/**
 * @param {{openEditor: (t: Trade) => void, openImport: () => void, openCopy: (text: string) => void}} ctx
 * @returns {import("./view.js").View & {showItem: (name: string) => void}}
 */
export function createHistoryView({ openEditor, openImport, openCopy }) {
  /** @type {HTMLElement} */ let root;
  /** @type {import("../../state.js").AppState} */ let current;
  /** Filters and sort survive switching tabs. */
  const filters = { text: "", cat: "", month: "", status: "" };
  let sort = { key: "date", dir: -1 };
  /** Whether the filter row is shown; survives switching tabs like the filters. */
  let filtersOpen = false;

  /** Number of select filters in use (the search box is always visible, so it doesn't count). */
  const activeFilterCount = () => [filters.cat, filters.month, filters.status].filter(Boolean).length;

  /** Syncs the filter button (pressed state, count badge) and the filter row's visibility. */
  function syncFilterToggle() {
    const btn = $("#h-filter-btn", root);
    const row = $("#h-filters", root);
    if (!btn || !row) return;
    const n = activeFilterCount();
    btn.setAttribute("aria-expanded", String(filtersOpen));
    btn.classList.toggle("active", n > 0);
    btn.title = n ? `Filtres (${n} actif${n > 1 ? "s" : ""})` : "Filtres";
    btn.setAttribute("aria-label", btn.title);
    $(".count", btn).textContent = n ? String(n) : "";
    row.hidden = !filtersOpen;
  }

  /** @returns {Trade[]} */
  function visibleTrades() {
    const q = normalize(filters.text);
    return current.trades.filter(
      (t) =>
        (!q || normalize(t.item).includes(q)) &&
        (!filters.cat || t.cat === filters.cat) &&
        (!filters.month || monthKey(t.date) === filters.month) &&
        (!filters.status || STATUS[filters.status](t)),
    );
  }

  function renderToolbar() {
    const months = [...new Set(current.trades.map((t) => monthKey(t.date)))].sort().reverse();
    /** @param {string} value @param {string} label @param {string} selected */
    const opt = (value, label, selected) =>
      `<option value="${esc(value)}" ${selected === value ? "selected" : ""}>${esc(label)}</option>`;
    root.innerHTML = `
      <div class="toolbar">
        <input type="text" id="h-q" class="grow" placeholder="Chercher un objet…" value="${esc(filters.text)}" aria-label="Chercher un objet">
        <button class="btn filter-btn" id="h-filter-btn" data-act="filters" aria-controls="h-filters" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></svg><span class="count"></span>
        </button>
        <button class="btn" data-act="import">Importer depuis Sheets</button>
        <button class="btn" data-act="export">Copier en tableau</button>
      </div>
      <div class="toolbar" id="h-filters">
        <select id="h-cat" aria-label="Type">${opt("", "Tous types", filters.cat)}${opt(CATEGORY.CRAFT, CATEGORY_LABEL.craft, filters.cat)}${opt(CATEGORY.RESALE, CATEGORY_LABEL.resale, filters.cat)}</select>
        <select id="h-month" aria-label="Mois">${opt("", "Tous les mois", filters.month)}${months.map((m) => opt(m, monthLabel(m), filters.month)).join("")}</select>
        <select id="h-status" aria-label="Statut">${opt("", "Tous statuts", filters.status)}${opt("open", "En vente", filters.status)}${opt("sold", "Vendus", filters.status)}${opt("loss", "Ventes à perte", filters.status)}</select>
        <button class="btn" data-act="clear-filters">Effacer les filtres</button>
      </div>
      <div id="h-results"></div>`;
    syncFilterToggle();
  }

  function renderResults() {
    const out = $("#h-results", root);
    const rows = sortRows(visibleTrades(), COLUMNS, sort, (a, b) => b.date.localeCompare(a.date));
    if (!rows.length) {
      out.innerHTML = `<div class="empty">${
        current.trades.length
          ? "Aucune opération ne correspond à ces filtres."
          : "Ton carnet est vide. Ajoute une opération à gauche, ou importe ton ancien tableau avec « Importer depuis Sheets »."
      }</div>`;
      return;
    }
    const totalCost = rows.reduce((s, t) => s + t.cost, 0);
    const totalFm = rows.reduce((s, t) => s + fmCost(t), 0);
    const totalSale = rows.reduce((s, t) => s + salePrice(t), 0);
    const totalProfit = rows.reduce((s, t) => s + profit(t), 0);
    out.innerHTML = `<div class="scroll"><table class="grid">
      <thead>${sortHeader(COLUMNS, sort)}</thead>
      <tbody>${rows
        .map((t) => {
          const p = profit(t);
          return `<tr data-id="${esc(t.id)}" tabindex="0">
          <td class="num">${esc(formatShortDate(t.date))}</td>
          <td class="obj" title="${esc(t.item)}">${esc(t.item)}</td>
          <td>${categoryPill(t)}</td>
          ${amountCell(t.cost)}
          ${amountCell(t.runes || null, { cls: "fm" })}
          ${amountCell(salePrice(t))}
          ${amountCell(p, { cls: signClass(p) })}
          <td class="n ${signClass(p)}">${formatPercent(ratioPercent(p, t.cost))}</td>
          <td class="st">${statusDot(t)}</td>
        </tr>`;
        })
        .join("")}</tbody>
      <tfoot><tr>
        <td colspan="3">${plural(rows.length, "opération")}</td>
        ${amountCell(totalCost)}${amountCell(totalFm || null, { cls: "fm" })}
        ${amountCell(totalSale)}
        ${amountCell(totalProfit, { cls: signClass(totalProfit) })}
        <td class="n ${signClass(totalProfit)}">${formatPercent(ratioPercent(totalProfit, totalCost))}</td><td></td>
      </tr></tfoot>
    </table></div>`;
  }

  async function copyExport() {
    const rows = visibleTrades();
    const text = toTsv(rows);
    try {
      await navigator.clipboard.writeText(text);
      toast(`${plural(rows.length, "ligne copiée", "lignes copiées")} : colle-les dans un tableur`);
    } catch {
      // Clipboard access can be blocked (sandboxed frame, browser setting): let the player copy by hand.
      openCopy(text);
    }
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    const sortBtn = closest(e, "[data-sort]");
    if (sortBtn) {
      sort = nextSort(sort, sortBtn.dataset.sort, COLUMNS);
      return renderResults();
    }
    const act = closest(e, "[data-act]")?.dataset.act;
    if (act === "filters") {
      filtersOpen = !filtersOpen;
      return syncFilterToggle();
    }
    if (act === "clear-filters") {
      Object.assign(filters, { cat: "", month: "", status: "" });
      for (const id of ["h-cat", "h-month", "h-status"])
        /** @type {HTMLSelectElement} */ ($(`#${id}`, root)).value = "";
      syncFilterToggle();
      return renderResults();
    }
    if (act === "import") return openImport();
    if (act === "export") return copyExport();
    const row = closest(e, "tr[data-id]");
    const trade = row && current.trades.find((t) => t.id === row.dataset.id);
    if (trade) openEditor(trade);
  }
  function onInput(e) {
    if (e.target.id !== "h-q") return;
    filters.text = e.target.value;
    renderResults();
  }
  function onChange(e) {
    const field = { "h-cat": "cat", "h-month": "month", "h-status": "status" }[e.target.id];
    if (!field) return;
    filters[field] = e.target.value;
    syncFilterToggle();
    renderResults();
  }
  function onKeydown(e) {
    if (e.key !== "Enter" || !e.target.matches("tr[data-id]")) return;
    e.preventDefault(); // otherwise the same Enter submits the editor that just opened
    e.target.click();
  }

  return {
    mount(el) {
      root = el;
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("change", onChange);
      root.addEventListener("keydown", onKeydown);
      root.innerHTML = "";
    },
    unmount() {
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("change", onChange);
      root.removeEventListener("keydown", onKeydown);
    },
    update(state) {
      const firstRender = !current || !$("#h-results", root);
      const monthsChanged = current && current.trades !== state.trades;
      current = state;
      // Rebuild the toolbar only when the month list may have changed, and never while one of its
      // controls has focus (typing in the search box, an open select).
      const toolbarFocused = [...root.querySelectorAll(".toolbar")].some((bar) => bar.contains(document.activeElement));
      if (firstRender || (monthsChanged && !toolbarFocused)) renderToolbar();
      renderResults();
    },
    /** Shows only one item's trades (used from the Analyse view). @param {string} name */
    showItem(name) {
      Object.assign(filters, { text: name, cat: "", month: "", status: "" });
    },
  };
}
