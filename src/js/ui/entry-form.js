/**
 * @file "Nouvelle opération" form: item autocomplete, category toggle,
 * recipe cost helper and profit preview.
 *
 * The form owns its own draft state (what is being typed). It reads app state
 * for history and remembered prices, and submits through `actions.addTrade`.
 */

import { CATEGORY } from "../config.js";
import { recipeCost } from "../data/catalog.js";
import { todayIso } from "../domain/dates.js";
import { evaluateKamas, formatKamas, formatPercent, isKamas, ratioPercent, signClass } from "../domain/kamas.js";
import { itemHistory } from "../domain/stats.js";
import { normalize } from "../domain/text.js";
import { auctionTax, profit } from "../domain/trade.js";
import { attachAutocomplete } from "./autocomplete.js";
import { loadTaxPreference, saveTaxPreference, taxOptions } from "./hdv-tax.js";
import { $, $$, esc, runAction, toast } from "./dom.js";

/** Largest number of crafts the recipe helper accepts in one operation. */
const QTY_MAX = 9999;

/**
 * @param {HTMLFormElement} form
 * @param {{state: ReturnType<typeof import("../state.js").createState>, actions: ReturnType<typeof import("../actions.js").createActions>, onAdded: (trade: import("../domain/trade.js").Trade) => void}} ctx
 * @returns {{refresh: () => void}}
 */
export function mountEntryForm(form, { state, actions, onAdded }) {
  const el = {
    item: /** @type {HTMLInputElement} */ ($("#f-item", form)),
    list: $("#f-item-list", form),
    cat: $("#f-cat", form),
    recipe: $("#recipeBox", form),
    cost: /** @type {HTMLInputElement} */ ($("#f-cost", form)),
    expected: /** @type {HTMLInputElement} */ ($("#f-exp", form)),
    date: /** @type {HTMLInputElement} */ ($("#f-date", form)),
    sold: /** @type {HTMLInputElement} */ ($("#f-sold", form)),
    tax: /** @type {HTMLSelectElement} */ ($("#f-tax", form)),
    previewLabel: $("#f-preview span", form),
    preview: $("#f-preview b", form),
    submit: /** @type {HTMLButtonElement} */ ($("#f-submit", form)),
  };

  /** Draft state of the recipe helper. `costFollowsRecipe` turns off once the user edits the cost by hand. */
  const draft = {
    cat: CATEGORY.CRAFT,
    /** @type {import("../data/catalog.js").CatalogItem|null} */ craftItem: null,
    /** @type {Record<string, number>} */ unitPrices: {},
    runes: 0,
    /** Number of crafts: multiplies the ingredient quantities and the runes. Unit prices stay per unit. */
    qty: 1,
    costFollowsRecipe: true,
  };

  const priceOf = (id) => draft.unitPrices[id] ?? state.get().prices[id];
  const currentRecipeTotal = () =>
    draft.craftItem ? recipeCost(draft.craftItem.recipe, priceOf, draft.runes).total * draft.qty : 0;
  const qtyLabel = (n) => (n === 1 ? "" : `${n}×`);

  // ----- category -----
  function setCategory(cat) {
    draft.cat = cat;
    $$("button", el.cat).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === cat)));
    renderRecipe();
  }
  el.cat.addEventListener("click", (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest("button");
    if (b) setCategory(b.dataset.v);
  });

  // ----- item + autocomplete -----
  function syncItem() {
    const match = state.get().catalog.findByName(el.item.value);
    const craftItem = match?.recipe ? match : null;
    if (craftItem?.id !== draft.craftItem?.id) {
      Object.assign(draft, { craftItem, unitPrices: {}, runes: 0, qty: 1, costFollowsRecipe: true });
    }
    renderRecipe();
  }
  attachAutocomplete({
    input: el.item,
    list: el.list,
    getSuggestions: (q) => state.get().catalog.suggest(q, itemHistory(state.get().trades)),
    onInput: syncItem,
    onPick: (s) => {
      // Default the category to what the player did last time with this item.
      const past = itemHistory(state.get().trades).get(normalize(s.name));
      if (past) setCategory(past.lastCat);
      syncItem();
      el.cost.focus();
    },
  });

  // ----- recipe helper -----
  function renderRecipe() {
    const item = draft.craftItem;
    if (!item || draft.cat !== CATEGORY.CRAFT) {
      el.recipe.innerHTML = "";
      return;
    }
    const { catalog } = state.get();
    const rows = item.recipe
      .map(([id, qty]) => {
        const p = priceOf(id);
        const name = esc(catalog.ingredientName(id));
        return `<tr><td class="q num" data-q="${qty}">${qty * draft.qty}×</td><td>${name}</td><td class="r"><input type="text" class="kamas" data-ing="${id}" value="${p != null ? formatKamas(p) : ""}" placeholder="prix/u" aria-label="Prix unitaire ${name}"></td></tr>`;
      })
      .join("");
    el.recipe.innerHTML = `<div class="recipe">
      <div class="head"><span class="lbl">Recette · niv. ${item.level}</span><label class="qty">×<input type="text" inputmode="numeric" id="f-qty" class="num" value="${draft.qty}" aria-label="Nombre de crafts"></label></div>
      <table><tbody>${rows}
        <tr><td class="q num" data-q="runes">${qtyLabel(draft.qty)}</td><td>Runes / FM</td><td class="r"><input type="text" class="kamas" id="f-runes" value="${draft.runes ? formatKamas(draft.runes) : ""}" placeholder="0" aria-label="Coût runes et forgemagie"></td></tr>
      </tbody></table>
      <div class="tot"><span>Coût calculé</span><span class="num" id="r-tot">${formatKamas(currentRecipeTotal())}</span></div>
      <div class="hint">Les prix unitaires sont mémorisés pour la prochaine fois.
        ${draft.costFollowsRecipe ? "L'investissement suit ce calcul." : `<button type="button" class="btn small" id="r-use">Utiliser le coût calculé</button>`}</div>
    </div>`;
  }
  el.recipe.addEventListener("input", (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    if (t.id === "f-qty") return setQuantity(t.value);
    const value = evaluateKamas(t.value);
    // Unreadable or negative amounts count as "no price yet".
    if (t.dataset.ing) {
      if (isKamas(value)) draft.unitPrices[t.dataset.ing] = value;
      else delete draft.unitPrices[t.dataset.ing];
    } else if (t.id === "f-runes") {
      draft.runes = isKamas(value) ? value : 0;
    } else return;
    refreshTotals();
  });
  function refreshTotals() {
    $("#r-tot", el.recipe).textContent = formatKamas(currentRecipeTotal());
    if (draft.costFollowsRecipe) {
      el.cost.value = currentRecipeTotal() ? formatKamas(currentRecipeTotal()) : "";
      updatePreview();
    }
  }
  /**
   * Changes the number of crafts. Everything follows: ingredient quantities, the
   * computed cost, and the investment and planned sale already typed.
   * @param {string} raw
   */
  function setQuantity(raw) {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 1 || n > QTY_MAX || n === draft.qty) return;
    const ratio = n / draft.qty;
    draft.qty = n;
    $$("td[data-q]", el.recipe).forEach((td) => {
      td.textContent = td.dataset.q === "runes" ? qtyLabel(n) : `${Number(td.dataset.q) * n}×`;
    });
    const scale = (/** @type {HTMLInputElement} */ input) => {
      const v = evaluateKamas(input.value);
      if (input.value.trim() && isKamas(v)) input.value = formatKamas(Math.round(v * ratio));
    };
    scale(el.expected);
    if (!draft.costFollowsRecipe) scale(el.cost);
    refreshTotals();
    updatePreview();
  }
  el.recipe.addEventListener("click", (e) => {
    if (/** @type {HTMLElement} */ (e.target).id !== "r-use") return;
    draft.costFollowsRecipe = true;
    el.cost.value = formatKamas(currentRecipeTotal());
    renderRecipe();
    updatePreview();
  });

  // ----- amounts + preview -----
  el.cost.addEventListener("input", () => {
    if (draft.craftItem && draft.cat === CATEGORY.CRAFT && draft.costFollowsRecipe) {
      draft.costFollowsRecipe = false;
      renderRecipe();
    }
    updatePreview();
  });
  el.expected.addEventListener("input", updatePreview);
  el.tax.addEventListener("change", () => {
    saveTaxPreference(Number(el.tax.value));
    updatePreview();
  });
  function updatePreview() {
    const cost = evaluateKamas(el.cost.value);
    const expected = evaluateKamas(el.expected.value);
    const planned = { cost, expected, sold: false, soldPrice: null, hdvTax: Number(el.tax.value) };
    const tax = Number.isNaN(expected) ? 0 : auctionTax(planned);
    const detail = document.createElement("small");
    detail.textContent = `taxe HDV de ${formatKamas(tax)} (${planned.hdvTax} %) déduite`;
    el.previewLabel.replaceChildren("Bénéfice prévu", ...(tax ? [detail] : []));
    if (Number.isNaN(cost) || Number.isNaN(expected)) {
      el.preview.textContent = "—";
      el.preview.className = "num";
      return;
    }
    const p = profit(/** @type {import("../domain/trade.js").Trade} */ (planned));
    el.preview.textContent = `${formatKamas(p)} (${formatPercent(ratioPercent(p, cost))})`;
    el.preview.className = `num ${signClass(p)}`;
  }

  // ----- submit -----
  function reset() {
    form.reset();
    el.date.value = todayIso();
    el.tax.value = String(loadTaxPreference());
    Object.assign(draft, { craftItem: null, unitPrices: {}, runes: 0, qty: 1, costFollowsRecipe: true });
    setCategory(draft.cat);
    updatePreview();
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runAction(el.submit, async () => {
      const sold = el.sold.checked;
      const expected = evaluateKamas(el.expected.value);
      /** @type {Omit<import("../domain/trade.js").Trade, "id">} */
      const trade = {
        date: el.date.value || todayIso(),
        item: el.item.value,
        cat: draft.cat,
        cost: evaluateKamas(el.cost.value),
        expected,
        sold,
        soldPrice: sold ? expected : null,
        soldDate: sold ? todayIso() : null,
        hdvTax: Number(el.tax.value),
      };
      if (draft.craftItem && draft.cat === CATEGORY.CRAFT) {
        trade.recipe = draft.craftItem.recipe.map(([id, qty]) => [id, qty * draft.qty, priceOf(id) ?? null]);
        trade.runes = draft.runes * draft.qty;
      }
      const { trade: saved, warning } = await actions.addTrade(trade, draft.unitPrices);
      reset();
      toast(warning ? `${saved.item} ajouté. ${warning}` : `${saved.item} ajouté`);
      onAdded(saved);
      el.item.focus();
    });
  });

  el.date.value = todayIso();
  el.tax.innerHTML = taxOptions(loadTaxPreference());

  return {
    /** Re-render parts that depend on loaded data (catalog, remembered prices). */
    refresh: syncItem,
  };
}
