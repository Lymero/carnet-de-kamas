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

/**
 * @param {HTMLFormElement} form
 * @param {{state: ReturnType<typeof import("../state.js").createState>, actions: ReturnType<typeof import("../actions.js").createActions>, onAdded: (trade: import("../domain/trade.js").Trade) => void}} ctx
 * @returns {{refresh: () => void, applyWriteMode: () => void}}
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
    costFollowsRecipe: true,
  };

  const priceOf = (id) => draft.unitPrices[id] ?? state.get().prices[id];
  const currentRecipeTotal = () =>
    draft.craftItem ? recipeCost(draft.craftItem.recipe, priceOf, draft.runes).total : 0;

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
      Object.assign(draft, { craftItem, unitPrices: {}, runes: 0, costFollowsRecipe: true });
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
    const { catalog, canWrite } = state.get();
    const ro = canWrite ? "" : "disabled";
    const rows = item.recipe
      .map(([id, qty]) => {
        const p = priceOf(id);
        const name = esc(catalog.ingredientName(id));
        return `<tr><td class="q num">${qty}×</td><td>${name}</td><td class="r"><input type="text" class="kamas" data-ing="${id}" value="${p != null ? formatKamas(p) : ""}" placeholder="prix/u" aria-label="Prix unitaire ${name}" ${ro}></td></tr>`;
      })
      .join("");
    el.recipe.innerHTML = `<div class="recipe">
      <div class="lbl">Recette · niv. ${item.level}</div>
      <table><tbody>${rows}
        <tr><td class="q"></td><td>Runes / FM</td><td class="r"><input type="text" class="kamas" id="f-runes" value="${draft.runes ? formatKamas(draft.runes) : ""}" placeholder="0" aria-label="Coût runes et forgemagie" ${ro}></td></tr>
      </tbody></table>
      <div class="tot"><span>Coût calculé</span><span class="num" id="r-tot">${formatKamas(currentRecipeTotal())}</span></div>
      <div class="hint">Les prix unitaires sont mémorisés pour la prochaine fois.
        ${draft.costFollowsRecipe ? "L'investissement suit ce calcul." : `<button type="button" class="btn small" id="r-use" ${ro}>Utiliser le coût calculé</button>`}</div>
    </div>`;
  }
  el.recipe.addEventListener("input", (e) => {
    const t = /** @type {HTMLInputElement} */ (e.target);
    const value = evaluateKamas(t.value);
    // Unreadable or negative amounts count as "no price yet".
    if (t.dataset.ing) {
      if (isKamas(value)) draft.unitPrices[t.dataset.ing] = value;
      else delete draft.unitPrices[t.dataset.ing];
    } else if (t.id === "f-runes") {
      draft.runes = isKamas(value) ? value : 0;
    } else return;
    $("#r-tot", el.recipe).textContent = formatKamas(currentRecipeTotal());
    if (draft.costFollowsRecipe) {
      el.cost.value = currentRecipeTotal() ? formatKamas(currentRecipeTotal()) : "";
      updatePreview();
    }
  });
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
    Object.assign(draft, { craftItem: null, unitPrices: {}, runes: 0, costFollowsRecipe: true });
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
        trade.recipe = draft.craftItem.recipe.map(([id, qty]) => [id, qty, priceOf(id) ?? null]);
        trade.runes = draft.runes;
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
    /** Disables the form for read-only viewers. */
    applyWriteMode() {
      const ro = !state.get().canWrite;
      $$("input, select, button", form).forEach((x) => {
        /** @type {HTMLInputElement} */ (x).disabled = ro;
      });
      renderRecipe();
    },
  };
}
