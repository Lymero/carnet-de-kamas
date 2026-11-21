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
import { dateOrder, lotSize, profit, salePrice } from "../../domain/trade.js";
import { $, closest, esc, toast } from "../dom.js";
import { categoryPill, statusDot } from "../pills.js";
import { amountCell } from "../table.js";
import { nextSort, sortHeader, sortRows } from "../sort.js";

/** @typedef {import("../../domain/trade.js").Trade} Trade */

/** @type {import("../sort.js").SortColumn<Trade>[]} */
const COLUMNS = [
  { key: "date", label: "Date", value: dateOrder, first: -1 },
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

/** Status filter labels, for the select and the chips. */
const STATUS_LABEL = { open: "En vente", sold: "Vendus", loss: "Ventes à perte" };

const CROSS = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>`;

/**
 * @param {{openEditor: (t: Trade) => void, openImport: () => void, openCopy: (text: string) => void, redo: (t: Trade) => void}} ctx
 * @returns {import("./view.js").View & {showItem: (name: string) => void}}
 */
export function createHistoryView({ openEditor, openImport, openCopy, redo }) {
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
    const clear = $("#h-q-clear", root);
    if (clear) clear.hidden = !filters.text;
    renderChips();
  }

  /** One removable chip per filter in use, so they show even with the filter row hidden. */
  function renderChips() {
    const box = $("#h-chips", root);
    if (!box) return;
    const labels = {
      cat: filters.cat && CATEGORY_LABEL[filters.cat],
      month: filters.month && monthLabel(filters.month),
      status: filters.status && STATUS_LABEL[filters.status],
    };
    const chips = Object.entries(labels)
      .filter(([, label]) => label)
      .map(
        ([field, label]) =>
          `<button type="button" class="filter-chip" data-clear="${field}" aria-label="Retirer le filtre ${esc(label)}">${esc(label)}${CROSS}</button>`,
      );
    box.hidden = !chips.length;
    box.innerHTML = chips.length
      ? `${chips.join("")}<button type="button" class="link" data-act="reset">Tout effacer</button>`
      : "";
  }

  /**
   * Empties the given filters ("text" is the search box), then refreshes the list.
   * Focus goes to the search box, as the chip or button clicked may be gone.
   * @param {("text"|"cat"|"month"|"status")[]} fields
   */
  function clearFilters(fields) {
    const ids = { text: "h-q", cat: "h-cat", month: "h-month", status: "h-status" };
    for (const field of fields) {
      filters[field] = "";
      /** @type {HTMLInputElement|HTMLSelectElement} */ ($(`#${ids[field]}`, root)).value = "";
    }
    syncFilterToggle();
    renderResults();
    /** @type {HTMLInputElement} */ ($("#h-q", root)).focus();
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
        <div class="search grow">
          <input type="text" id="h-q" placeholder="Chercher un objet…" value="${esc(filters.text)}" aria-label="Chercher un objet" title="Raccourci : /" aria-keyshortcuts="/">
          <button type="button" class="clear" id="h-q-clear" data-act="clear-search" title="Effacer la recherche" aria-label="Effacer la recherche" hidden>${CROSS}</button>
        </div>
        <button class="btn filter-btn" id="h-filter-btn" data-act="filters" aria-controls="h-filters" aria-expanded="false">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></svg><span class="count"></span>
        </button>
        <button class="btn" data-act="import">Importer depuis Sheets</button>
        <button class="btn" data-act="export">Copier en tableau</button>
      </div>
      <div class="toolbar" id="h-filters">
        <select id="h-cat" aria-label="Type">${opt("", "Tous types", filters.cat)}${opt(CATEGORY.CRAFT, CATEGORY_LABEL.craft, filters.cat)}${opt(CATEGORY.RESALE, CATEGORY_LABEL.resale, filters.cat)}</select>
        <select id="h-month" aria-label="Mois">${opt("", "Tous les mois", filters.month)}${months.map((m) => opt(m, monthLabel(m), filters.month)).join("")}</select>
        <select id="h-status" aria-label="Statut">${opt("", "Tous statuts", filters.status)}${Object.entries(
          STATUS_LABEL,
        )
          .map(([value, label]) => opt(value, label, filters.status))
          .join("")}</select>
      </div>
      <div class="filter-chips" id="h-chips" aria-label="Filtres actifs" hidden></div>
      <div id="h-results"></div>`;
    syncFilterToggle();
  }

  function renderResults() {
    const out = $("#h-results", root);
    const rows = sortRows(visibleTrades(), COLUMNS, sort, (a, b) => dateOrder(b).localeCompare(dateOrder(a)));
    if (!rows.length) {
      out.innerHTML = `<div class="empty">${
        current.trades.length
          ? `Aucune opération ne correspond à ces filtres.<br><button type="button" class="btn" data-act="reset">Tout effacer</button>`
          : "Ton carnet est vide. Ajoute une opération à gauche, ou importe ton ancien tableau avec « Importer depuis Sheets »."
      }</div>`;
      return;
    }
    const totalCost = rows.reduce((s, t) => s + t.cost, 0);
    const totalFm = rows.reduce((s, t) => s + fmCost(t), 0);
    const totalSale = rows.reduce((s, t) => s + salePrice(t), 0);
    const totalProfit = rows.reduce((s, t) => s + profit(t), 0);
    out.innerHTML = `<div class="scroll"><table class="grid">
      <thead>${sortHeader(COLUMNS, sort, '<th class="redo" aria-label="Refaire"></th>')}</thead>
      <tbody>${rows
        .map((t) => {
          const p = profit(t);
          return `<tr data-id="${esc(t.id)}" tabindex="0">
          <td class="num">${esc(formatShortDate(t.date))}</td>
          <td class="obj" title="${esc(t.item)}">${lotSize(t) > 1 ? `<span class="lot">${lotSize(t)}×</span> ` : ""}${esc(t.item)}</td>
          <td>${categoryPill(t)}</td>
          ${amountCell(t.cost)}
          ${amountCell(t.runes || null, { cls: "fm" })}
          ${amountCell(salePrice(t))}
          ${amountCell(p, { cls: signClass(p) })}
          <td class="n ${signClass(p)}">${formatPercent(ratioPercent(p, t.cost))}</td>
          <td class="st">${statusDot(t)}</td>
          <td class="redo"><button type="button" class="btn small" data-act="redo" title="Refaire : remplir le formulaire avec cette opération" aria-label="Refaire ${esc(t.item)}">↻</button></td>
        </tr>`;
        })
        .join("")}</tbody>
      <tfoot><tr>
        <td colspan="3">${plural(rows.length, "opération")}</td>
        ${amountCell(totalCost)}${amountCell(totalFm || null, { cls: "fm" })}
        ${amountCell(totalSale)}
        ${amountCell(totalProfit, { cls: signClass(totalProfit) })}
        <td class="n ${signClass(totalProfit)}">${formatPercent(ratioPercent(totalProfit, totalCost))}</td><td></td><td></td>
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
    if (act === "clear-search") return clearFilters(["text"]);
    if (act === "reset") return clearFilters(["text", "cat", "month", "status"]);
    const chip = closest(e, "[data-clear]");
    if (chip) return clearFilters([/** @type {"cat"|"month"|"status"} */ (chip.dataset.clear)]);
    if (act === "import") return openImport();
    if (act === "export") return copyExport();
    const row = closest(e, "tr[data-id]");
    const trade = row && current.trades.find((t) => t.id === row.dataset.id);
    if (!trade) return;
    if (act === "redo") redo(trade);
    else openEditor(trade);
  }
  function onInput(e) {
    if (e.target.id !== "h-q") return;
    filters.text = e.target.value;
    syncFilterToggle();
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
    if (e.key === "Escape" && e.target.id === "h-q" && filters.text) {
      e.preventDefault();
      return clearFilters(["text"]);
    }
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
