/**
 * @file "En cours" view: items listed for sale, newest first unless sorted otherwise,
 * with an inline "mark as sold" form. Clicking a row (outside its buttons and the
 * sale form) opens the editor.
 *
 * View contract (shared by all views, see docs/ARCHITECTURE.md):
 *   mount(el)      called when the view becomes visible; binds events once
 *   update(state)  called on every state change while visible
 *
 * The sale form's typed values live in `sale`, not only in the DOM, so a
 * re-render caused by a live update keeps what the player is typing.
 */

import { SLOW_SALE_DAYS } from "../../config.js";
import { daysBetween, formatShortDate, todayIso } from "../../domain/dates.js";
import {
  evaluateKamas,
  formatCompact,
  formatKamas,
  formatPercent,
  ratioPercent,
  signClass,
} from "../../domain/kamas.js";
import { fmCost } from "../../domain/stats.js";
import { normalize } from "../../domain/text.js";
import { dateOrder, isOpen, lotSize, profit, splitSale } from "../../domain/trade.js";
import { $, closest, esc, renderKeepingFocus, runAction, toast } from "../dom.js";
import { taxOptions } from "../hdv-tax.js";
import { categoryPill } from "../pills.js";
import { nextSort, sortButton, sortRows } from "../sort.js";

/** @typedef {import("../../domain/trade.js").Trade} Trade */

/** Sort keys, as in the history. @type {import("../sort.js").SortColumn<Trade>[]} */
const SORTS = [
  { key: "date", label: "Date", value: dateOrder, first: -1 },
  { key: "item", label: "Objet", value: (t) => normalize(t.item) },
  { key: "cat", label: "Type", value: (t) => t.cat },
  { key: "cost", label: "Investi", value: (t) => t.cost, numeric: true },
  { key: "expected", label: "Prévu", value: (t) => t.expected, numeric: true },
  { key: "pct", label: "Marge", value: (t) => ratioPercent(profit(t), t.cost), numeric: true },
];

/**
 * @param {{actions: ReturnType<typeof import("../../actions.js").createActions>, openEditor: (t: Trade) => void, redo: (t: Trade) => void}} ctx
 * @returns {import("./view.js").View}
 */
export function createOpenView({ actions, openEditor, redo }) {
  /** @type {HTMLElement} */ let root;
  /** @type {import("../../state.js").AppState} */ let current;
  /** The open sale form: which trade, and what has been typed so far. */
  let sale = /** @type {{id: string, price: string, date: string, tax: number, qty: string}|null} */ (null);
  /** Survives switching tabs. */
  let sort = { key: "date", dir: -1 };

  function render() {
    const today = todayIso();
    const open = sortRows(current.trades.filter(isOpen), SORTS, sort, (a, b) =>
      dateOrder(b).localeCompare(dateOrder(a)),
    );
    if (sale && !open.some((t) => t.id === sale?.id)) sale = null; // sold or deleted meanwhile
    if (!open.length) {
      root.innerHTML = `<div class="empty">Rien en vente pour l'instant.<br>Ajoute un craft ou un achat à gauche : il apparaîtra ici jusqu'à ce que tu le marques vendu.</div>`;
      return;
    }
    const sortBar = `<div class="open-sort" role="group" aria-label="Trier">${SORTS.map((c) => sortButton(c, sort)).join("")}</div>`;
    root.innerHTML = `${sortBar}<div class="open">${open
      .map((t) => {
        const p = profit(t);
        const fm = fmCost(t);
        const days = daysBetween(t.date, today);
        const age =
          days >= SLOW_SALE_DAYS ? `<span class="pill slow">${days} j en vente</span>` : `<span>${days} j</span>`;
        return `<div class="open-row" data-id="${esc(t.id)}" tabindex="0">
        <div class="it"><b>${esc(t.item)}</b><small><span>${esc(formatShortDate(t.date))} ·</span>${categoryPill(t)}${
          lotSize(t) > 1 ? `<span class="lot" title="Lot de ${lotSize(t)}">×${lotSize(t)}</span>` : ""
        }${age}</small></div>
        <div class="c"><small>Investi</small><span class="num">${formatCompact(t.cost)}</span>${
          fm ? `<small class="fm" title="${esc(formatKamas(fm))}">dont FM ${formatCompact(fm)}</small>` : ""
        }</div>
        <div class="c"><small>Prévu</small><span class="num">${formatCompact(t.expected)}</span></div>
        <div class="c"><small>Marge</small><span class="num ${signClass(p)}">${formatPercent(ratioPercent(p, t.cost))}</span></div>
        <div class="row-actions">
          <button class="btn small primary" data-act="sell">Vendu</button>
          <button class="btn small" data-act="redo" title="Remplir le formulaire avec cette opération">Refaire</button>
        </div>
        ${
          sale?.id === t.id
            ? `<div class="sell">
          ${
            lotSize(t) > 1
              ? `<div class="field qty"><label for="s-qty">Quantité</label><span class="of"><input type="text" inputmode="numeric" id="s-qty" class="num" value="${esc(sale.qty)}"><span class="muted">/ ${lotSize(t)}</span></span></div>`
              : ""
          }
          <div class="field"><label for="s-price">Vendu à</label><input type="text" id="s-price" class="kamas" value="${esc(sale.price)}"></div>
          <div class="field"><label for="s-date">Le</label><input type="date" id="s-date" value="${esc(sale.date)}"></div>
          <div class="field"><label for="s-tax">Taxe HDV</label><select id="s-tax">${taxOptions(sale.tax)}</select></div>
          <button class="btn primary" data-act="sell-ok">Confirmer</button>
          <button class="btn" data-act="sell-cancel">Annuler</button>
        </div>`
            : ""
        }
      </div>`;
      })
      .join("")}</div>`;
  }

  /** @param {MouseEvent} e */
  function onClick(e) {
    const sortBtn = closest(e, "[data-sort]");
    if (sortBtn) {
      const key = /** @type {string} */ (sortBtn.dataset.sort);
      sort = nextSort(sort, key, SORTS);
      render();
      /** @type {HTMLElement|null} */ ($(`[data-sort="${key}"]`, root))?.focus();
      return;
    }
    const button = /** @type {HTMLButtonElement|null} */ (closest(e, "[data-act]"));
    const row = closest(e, "[data-id]");
    if (!row) return;
    const trade = current.trades.find((t) => t.id === row.dataset.id);
    if (!trade) return;
    if (!button) {
      // A click on the row itself edits it; clicks inside the sale form stay there.
      if (!closest(e, ".sell")) openEditor(trade);
      return;
    }
    switch (button.dataset.act) {
      case "sell":
        sale = {
          id: trade.id,
          price: formatKamas(trade.expected),
          date: todayIso(),
          tax: trade.hdvTax,
          qty: String(lotSize(trade)),
        };
        render();
        /** @type {HTMLInputElement|null} */ ($("#s-price", root))?.select();
        break;
      case "sell-cancel":
        sale = null;
        render();
        /** @type {HTMLElement|null} */ ($(`[data-id="${CSS.escape(trade.id)}"] [data-act="sell"]`, root))?.focus();
        break;
      case "redo":
        redo(trade);
        break;
      case "sell-ok": {
        const price = evaluateKamas(sale?.price);
        const date = sale?.date || todayIso();
        const tax = sale?.tax ?? trade.hdvTax;
        const qty = Number(sale?.qty ?? lotSize(trade));
        runAction(button, async () => {
          const sold = await actions.sell(trade, price, date, tax, qty);
          sale = null;
          render(); // the rest of a lot is still listed, under the same id: close its form
          const part = qty < lotSize(trade) ? ` (${qty} sur ${lotSize(trade)})` : "";
          toast(`${trade.item} vendu${part} : ${formatPercent(ratioPercent(profit(sold), sold.cost))}`);
        });
        break;
      }
    }
  }

  /** @param {Event} e */
  function onInput(e) {
    const target = /** @type {HTMLInputElement} */ (e.target);
    if (!sale) return;
    if (target.id === "s-qty") setQuantity(target.value);
    else if (target.id === "s-price") sale.price = target.value;
    else if (target.id === "s-date") sale.date = target.value;
    else if (target.id === "s-tax") sale.tax = Number(target.value);
  }

  /**
   * Changes how many items of the lot are sold. While the price is still the one
   * suggested, it follows: the planned price of that many items.
   * @param {string} raw
   */
  function setQuantity(raw) {
    if (!sale) return;
    const trade = current.trades.find((t) => t.id === sale?.id);
    if (!trade) return;
    const suggested = (/** @type {string} */ qty) => {
      const n = Number(qty);
      if (!Number.isInteger(n) || n < 1 || n > lotSize(trade)) return null;
      return formatKamas(splitSale(trade, n, 0, todayIso(), "").sold.expected);
    };
    const wasSuggested = sale.price === suggested(sale.qty);
    sale.qty = raw;
    const next = suggested(raw);
    if (wasSuggested && next != null) {
      sale.price = next;
      const field = /** @type {HTMLInputElement|null} */ ($("#s-price", root));
      if (field) field.value = next;
    }
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    if (e.key === "Enter" && ["s-price", "s-qty"].includes(target.id)) {
      /** @type {HTMLElement|null} */ ($('[data-act="sell-ok"]', root))?.click();
    } else if (e.key === "Enter" && target.matches(".open-row")) {
      e.preventDefault(); // otherwise the same Enter submits the editor that just opened
      target.click();
    }
  }

  return {
    mount(el) {
      root = el;
      sale = null;
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("keydown", onKeydown);
    },
    unmount() {
      root.removeEventListener("click", onClick);
      root.removeEventListener("input", onInput);
      root.removeEventListener("keydown", onKeydown);
    },
    update(state) {
      current = state;
      renderKeepingFocus(root, render);
    },
  };
}
