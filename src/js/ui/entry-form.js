/**
 * @file "Nouvelle opération" form: item autocomplete, category toggle,
 * recipe cost helper and profit preview.
 *
 * The form owns its own draft state (what is being typed). It reads app state
 * for history and remembered prices, and submits through `actions.addTrade`.
 */

import { CATEGORY, LOT_MAX } from "../config.js";
import { recipeCost } from "../data/catalog.js";
import { todayIso } from "../domain/dates.js";
import { evaluateKamas, formatKamas, formatPercent, isKamas, ratioPercent, signClass } from "../domain/kamas.js";
import { itemHistory } from "../domain/stats.js";
import { normalize } from "../domain/text.js";
import { profit } from "../domain/trade.js";
import { attachAutocomplete } from "./autocomplete.js";
import { closeOnClickOutside } from "./dismiss.js";
import { loadTaxPreference, saveTaxPreference, taxOptions } from "./hdv-tax.js";
import { $, $$, esc, runAction, toast } from "./dom.js";

/**
 * @typedef {Object} RecipeHook  Lets the screenshot reader (ui/purchase-import.js) fill the recipe.
 * @property {() => {id: number, ingredients: {id: number, name: string}[], slot: HTMLElement}|null} current
 *   the recipe shown, with a place for the screenshot buttons; null when none is shown.
 *   The form fires "recipechange" each time it redraws the recipe box.
 * @property {(prices: Record<string, number>) => void} setUnitPrices  fills these unit prices; the
 *   investment follows the computed cost again
 */

/**
 * @param {HTMLFormElement} form
 * @param {{state: ReturnType<typeof import("../state.js").createState>, actions: ReturnType<typeof import("../actions.js").createActions>, onAdded: (trade: import("../domain/trade.js").Trade) => void}} ctx
 * @returns {{refresh: () => void, fill: (trade: import("../domain/trade.js").Trade) => void, recipe: RecipeHook}}
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
    preview: $("#f-preview b", form),
    submit: /** @type {HTMLButtonElement} */ ($("#f-submit", form)),
    reset: /** @type {HTMLButtonElement} */ ($("#f-reset", form)),
  };

  /** Draft state of the recipe helper. `costFollowsRecipe` turns off once the user edits the cost by hand. */
  const draft = {
    cat: CATEGORY.CRAFT,
    /** @type {import("../data/catalog.js").CatalogItem|null} */ craftItem: null,
    /** @type {Record<string, number>} */ unitPrices: {},
    runes: 0,
    /**
     * Kamas and rune value held before and after forging (kb, rb, ka, ra). When a "before" and an
     * "after" are set, what was spent, (kb + rb) − (ka + ra), is the FM cost of the whole operation:
     * it replaces the FM cost typed, and the ingredients still count on top.
     * @type {Partial<Record<"kb"|"rb"|"ka"|"ra", number>>}
     */
    balance: {},
    /** Number of crafts: multiplies the ingredient quantities. Unit prices stay per unit; FM is a total. */
    qty: 1,
    costFollowsRecipe: true,
    /** Which folds are open (ingredients, FM); both start closed for each new item. */
    open: { ing: false, fm: false },
  };

  const priceOf = (id) => draft.unitPrices[id] ?? state.get().prices[id];
  /**
   * Kamas spent on forgemagie, read from the balance before and after: (kamas + runes before) −
   * (kamas + runes after). Null while a side is empty; negative when "after" is higher.
   */
  const balanceUsed = () => {
    const { kb, rb, ka, ra } = draft.balance;
    if ((kb == null && rb == null) || (ka == null && ra == null)) return null;
    return (kb ?? 0) + (rb ?? 0) - (ka ?? 0) - (ra ?? 0);
  };
  /** FM cost once the balance gives a usable amount; null otherwise (the cost typed counts then). */
  const balanceFm = () => {
    const used = balanceUsed();
    return used != null && used >= 0 ? used : null;
  };
  /** FM cost of the whole operation: from the balance when set, else the cost typed. */
  const runesTotal = () => balanceFm() ?? draft.runes;
  const ingredientsTotal = () => (draft.craftItem ? recipeCost(draft.craftItem.recipe, priceOf).total * draft.qty : 0);
  const currentRecipeTotal = () => (draft.craftItem ? ingredientsTotal() + runesTotal() : 0);
  const runesValue = () => {
    const v = balanceFm() ?? draft.runes;
    return v ? formatKamas(v) : "";
  };
  /** The number of crafts in the recipe header, so it shows while folded. */
  const qtyTag = () => (draft.qty > 1 ? ` · ×${draft.qty}` : "");
  const balanceInput = (key, label) =>
    `<td class="r"><input type="text" class="kamas" data-bal="${key}" value="${draft.balance[key] != null ? formatKamas(draft.balance[key]) : ""}" placeholder="0" aria-label="${key[0] === "k" ? "Kamas" : "Valeur des runes"} ${label.toLowerCase()}"></td>`;
  /** What the balance gives: the amount (or the "after is higher" warning) and the subtraction. */
  const balanceSummary = () => {
    const used = balanceUsed();
    if (used == null) return { text: "—", calc: "", cls: "muted" };
    const { kb = 0, rb = 0, ka = 0, ra = 0 } = draft.balance;
    const calc = `(${formatKamas(kb)} + ${formatKamas(rb)}) − (${formatKamas(ka)} + ${formatKamas(ra)})`;
    if (used < 0) return { text: "Après > Avant", calc, cls: "neg" };
    return { text: formatKamas(used), calc: `= ${calc}`, cls: "" };
  };

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
      Object.assign(draft, {
        craftItem,
        unitPrices: {},
        runes: 0,
        balance: {},
        qty: 1,
        costFollowsRecipe: true,
        open: { ing: false, fm: false },
      });
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
      form.dispatchEvent(new Event("recipechange"));
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
    // The recipe (× crafts, ingredients), then FM in a box of its own: forging comes after the
    // craft and is counted once for the whole operation. Both fold with their subtotal in view;
    // the screenshot buttons stay under the recipe, folded or not.
    el.recipe.innerHTML = `<div class="recipe">
      <details class="fold" data-fold="ing"${draft.open.ing ? " open" : ""}>
        <summary><span>Recette · niv. ${item.level}<span class="muted" id="r-qty">${qtyTag()}</span></span><span class="num" id="r-ing"></span></summary>
        <table><tbody>
          <tr class="qty-row"><td></td><td><label for="f-qty">Crafts</label></td><td class="r"><span class="qty">×<input type="text" inputmode="numeric" id="f-qty" class="num" value="${draft.qty}" aria-label="Nombre de crafts"></span></td></tr>
          ${rows}
        </tbody></table>
      </details>
      <div class="slot"></div>
    </div>
    <div class="recipe fm">
      <details class="fold" data-fold="fm"${draft.open.fm ? " open" : ""}>
        <summary><span>FM<span id="bal-used"></span></span><input type="text" class="kamas sum" id="f-runes" value="${runesValue()}" placeholder="—" aria-label="Coût FM"${balanceFm() == null ? "" : " readonly"}></summary>
        <table class="bal"><thead><tr><td></td><th>Kamas</th><th>Runes</th></tr></thead><tbody>
          <tr><td>Avant</td>${balanceInput("kb", "Avant")}${balanceInput("rb", "Avant")}</tr>
          <tr><td>Après</td>${balanceInput("ka", "Après")}${balanceInput("ra", "Après")}</tr>
        </tbody></table>
      </details>
    </div>
    <div class="recipe-tot">
      <div class="tot"><span>Coût calculé</span><span class="num" id="r-tot">${formatKamas(currentRecipeTotal())}</span></div>
      ${draft.costFollowsRecipe ? "" : `<button type="button" class="btn small" id="r-use">Utiliser le coût calculé</button>`}
    </div>`;
    syncBalance();
    form.dispatchEvent(new Event("recipechange"));
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
    } else if (t.dataset.bal) {
      const key = /** @type {"kb"|"rb"|"ka"|"ra"} */ (t.dataset.bal);
      if (isKamas(value)) draft.balance[key] = value;
      else delete draft.balance[key];
      syncBalance();
    } else return;
    refreshTotals();
  });
  /** Updates the live difference and shows it, read only, in the FM cost once it is set. */
  function syncBalance() {
    const { text, calc, cls } = balanceSummary();
    const used = $("#bal-used", el.recipe);
    used.textContent = text;
    used.className = cls;
    // A usable amount already shows in the cost field: only the "after is higher" warning shows.
    used.hidden = cls !== "neg";
    const runes = /** @type {HTMLInputElement} */ ($("#f-runes", el.recipe));
    runes.title = calc; // the subtraction, on hover
    runes.readOnly = balanceFm() != null;
    runes.value = runesValue();
    syncSubtotals();
  }
  /** Subtotals on the folds, so the cost reads without opening them. */
  function syncSubtotals() {
    const show = (v) => (v ? formatKamas(v) : "—");
    $("#r-ing", el.recipe).textContent = show(ingredientsTotal());
  }
  el.recipe.addEventListener(
    "toggle",
    (e) => {
      const fold = /** @type {HTMLDetailsElement} */ (e.target);
      if (fold.dataset?.fold) draft.open[/** @type {"ing"|"fm"} */ (fold.dataset.fold)] = fold.open;
    },
    true,
  );
  closeOnClickOutside(
    () => /** @type {HTMLDetailsElement[]} */ ($$("details.fold[open]", el.recipe)),
    (fold) => (fold.open = false),
  );
  function refreshTotals() {
    $("#r-tot", el.recipe).textContent = formatKamas(currentRecipeTotal());
    syncSubtotals();
    if (draft.costFollowsRecipe) {
      el.cost.value = currentRecipeTotal() ? formatKamas(currentRecipeTotal()) : "";
      updatePreview();
    }
  }
  /**
   * Changes the number of crafts. Ingredient quantities, the computed cost, and the
   * investment and planned sale already typed follow; the FM cost, a total, does not.
   * @param {string} raw
   */
  function setQuantity(raw) {
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 1 || n > LOT_MAX || n === draft.qty) return;
    const ratio = n / draft.qty;
    draft.qty = n;
    $$("td[data-q]", el.recipe).forEach((td) => {
      td.textContent = `${Number(td.dataset.q) * n}×`;
    });
    $("#r-qty", el.recipe).textContent = qtyTag();
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
    const target = /** @type {HTMLElement} */ (e.target);
    // The FM total in the fold's header is typed in: clicking it must not fold or unfold.
    if (target.id === "f-runes") return e.preventDefault();
    if (target.id !== "r-use") return;
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
    if (Number.isNaN(cost) || Number.isNaN(expected)) {
      el.preview.textContent = "—";
      el.preview.className = "num";
      return;
    }
    // After the auction tax, which is not spelled out.
    const p = profit(/** @type {import("../domain/trade.js").Trade} */ (planned));
    el.preview.textContent = `${formatKamas(p)} (${formatPercent(ratioPercent(p, cost))})`;
    el.preview.className = `num ${signClass(p)}`;
  }

  // ----- submit -----
  function reset() {
    form.reset();
    el.date.value = todayIso();
    el.tax.value = String(loadTaxPreference());
    Object.assign(draft, {
      craftItem: null,
      unitPrices: {},
      runes: 0,
      balance: {},
      qty: 1,
      costFollowsRecipe: true,
      open: { ing: false, fm: false },
    });
    setCategory(draft.cat);
    updatePreview();
  }
  /**
   * Fills the form from a past trade to record it again ("Refaire"): same item, type, planned
   * price and auction tax, dated today and not sold. A craft keeps its number of crafts and FM
   * cost; ingredients take the remembered prices, else the ones paid then. The investment follows
   * the recipe when it did on that trade, else it is the amount typed then.
   * @param {import("../domain/trade.js").Trade} trade
   */
  function fill(trade) {
    reset();
    el.item.value = trade.item;
    setCategory(trade.cat);
    syncItem();
    el.expected.value = formatKamas(trade.expected);
    el.tax.value = String(trade.hdvTax);
    const item = draft.craftItem;
    const withRecipe = Boolean(item && trade.cat === CATEGORY.CRAFT && trade.recipe?.length);
    if (item && withRecipe) {
      const [firstId, firstQty] = item.recipe[0];
      const line = trade.recipe.find(([id]) => id === firstId);
      const qty = line ? line[1] / firstQty : 1;
      draft.qty = Number.isInteger(qty) && qty >= 1 && qty <= LOT_MAX ? qty : 1;
      for (const [id, , price] of trade.recipe) {
        if (price != null && state.get().prices[id] == null) draft.unitPrices[id] = price;
      }
      draft.runes = trade.runes ?? 0;
      const pastTotal = trade.recipe.reduce((s, [, q, p]) => s + q * (p ?? 0), 0) + (trade.runes ?? 0);
      draft.costFollowsRecipe = pastTotal === trade.cost;
    } else draft.costFollowsRecipe = false;
    renderRecipe();
    const followed = withRecipe && draft.costFollowsRecipe && currentRecipeTotal();
    el.cost.value = formatKamas(followed ? currentRecipeTotal() : trade.cost);
    updatePreview();
    form.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.cost.focus();
  }
  el.reset.addEventListener("click", () => {
    reset();
    el.item.focus();
  });
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
        trade.runes = runesTotal();
        if (draft.qty > 1) trade.qty = draft.qty;
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
    fill,
    recipe: {
      current() {
        const item = draft.craftItem;
        const slot = $(".slot", el.recipe);
        if (!item || draft.cat !== CATEGORY.CRAFT || !slot) return null;
        const { catalog } = state.get();
        const ingredients = item.recipe.map(([id]) => ({ id, name: catalog.ingredientName(id) }));
        return { id: item.id, ingredients, slot };
      },
      setUnitPrices(prices) {
        Object.assign(draft.unitPrices, prices);
        draft.costFollowsRecipe = true;
        el.cost.value = currentRecipeTotal() ? formatKamas(currentRecipeTotal()) : "";
        renderRecipe();
        updatePreview();
      },
    },
  };
}
