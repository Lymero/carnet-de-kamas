/**
 * @file Modal dialogs: edit a trade, import rows from a spreadsheet, copy an export by hand.
 * All use the single native <dialog id="dlg"> in index.html, whose content is a
 * <form class="dlg"> (so Enter submits) and whose title is the element with id "dlg-title".
 */

import { CATEGORY, CATEGORY_LABEL } from "../config.js";
import { ImportError } from "../actions.js";
import { todayIso } from "../domain/dates.js";
import { evaluateKamas, formatCompact, formatKamas } from "../domain/kamas.js";
import { parseSheetPaste, withoutDuplicates } from "../domain/sheet-io.js";
import { plural } from "../domain/text.js";
import { $, esc, runAction, toast } from "./dom.js";
import { taxOptions } from "./hdv-tax.js";

/** @typedef {import("../domain/trade.js").Trade} Trade */

/**
 * @param {HTMLDialogElement} dialog
 * @param {{state: ReturnType<typeof import("../state.js").createState>, actions: ReturnType<typeof import("../actions.js").createActions>}} ctx
 */
export function createDialogs(dialog, { state, actions }) {
  const body = /** @type {HTMLFormElement} */ ($(".dlg", dialog));
  /** @param {string} selector */
  const input = (selector) => /** @type {HTMLInputElement} */ ($(selector, body));

  /**
   * Replaces the dialog content and opens it.
   * @param {string} html  must contain the title element with id "dlg-title"
   * @param {() => void} [onSubmit]  Enter in a field, or the submit button
   */
  function show(html, onSubmit = () => {}) {
    body.innerHTML = html;
    body.onsubmit = (e) => {
      e.preventDefault();
      onSubmit();
    };
    if (!dialog.open) dialog.showModal();
  }

  /** @param {Trade} trade */
  function openEditor(trade) {
    const { catalog } = state.get();
    const recipe = trade.recipe?.length
      ? `<div class="hint">Recette enregistrée : ${trade.recipe
          .map(
            ([id, qty, price]) =>
              `${esc(qty)}× ${esc(catalog.ingredientName(id))}${price != null ? ` à ${formatCompact(price)}` : ""}`,
          )
          .join(", ")}${trade.runes ? ` · runes ${formatCompact(trade.runes)}` : ""}</div>`
      : "";
    show(
      `
      <h2 id="dlg-title">${esc(trade.item)}</h2>
      <div class="field"><label for="e-item">Objet</label><input type="text" id="e-item" value="${esc(trade.item)}"></div>
      <div class="row2">
        <div class="field"><label for="e-date">Date</label><input type="date" id="e-date" value="${esc(trade.date)}"></div>
        <div class="field"><label for="e-cat">Type</label><select id="e-cat">
          <option value="${CATEGORY.CRAFT}">${CATEGORY_LABEL.craft}</option>
          <option value="${CATEGORY.RESALE}" ${trade.cat === CATEGORY.RESALE ? "selected" : ""}>${CATEGORY_LABEL.resale}</option>
        </select></div>
      </div>
      <div class="row2">
        <div class="field"><label for="e-cost">Investissement</label><input type="text" id="e-cost" class="kamas" value="${formatKamas(trade.cost)}"></div>
        <div class="field"><label for="e-exp">Vente prévue</label><input type="text" id="e-exp" class="kamas" value="${formatKamas(trade.expected)}"></div>
      </div>
      <div class="row2">
        <div class="field"><label for="e-tax">Taxe HDV</label><select id="e-tax">${taxOptions(trade.hdvTax)}</select></div>
        <div class="field end"><label class="check" for="e-sold"><input type="checkbox" id="e-sold" ${trade.sold ? "checked" : ""}> Vendu</label></div>
      </div>
      <div class="row2">
        <div class="field"><label for="e-sp">Vendu à</label><input type="text" id="e-sp" class="kamas" value="${trade.sold ? formatKamas(trade.soldPrice) : ""}" placeholder="${formatKamas(trade.expected)}"></div>
        <div class="field"><label for="e-sd">Le</label><input type="date" id="e-sd" value="${esc(trade.soldDate ?? "")}"></div>
      </div>
      ${recipe}
      <div class="actions">
        <button type="button" class="btn danger left" id="e-del">Supprimer</button>
        <button type="button" class="btn" id="e-cancel">Annuler</button>
        <button type="submit" class="btn primary" id="e-save">Enregistrer</button>
      </div>`,
      () => save(),
    );

    $("#e-cancel", body).onclick = () => dialog.close();

    // Ticking "Vendu" fills in the usual answers: the planned price, today.
    input("#e-sold").onchange = () => {
      if (!input("#e-sold").checked) return;
      if (!input("#e-sp").value.trim()) input("#e-sp").value = input("#e-exp").value;
      if (!input("#e-sd").value) input("#e-sd").value = todayIso();
    };

    const del = /** @type {HTMLButtonElement} */ ($("#e-del", body));
    del.onclick = () => {
      // Two-step delete instead of window.confirm, which the sandbox blocks.
      if (del.dataset.armed !== "1") {
        del.dataset.armed = "1";
        del.textContent = "Confirmer la suppression";
        return;
      }
      runAction(del, async () => {
        await actions.removeTrade(trade.id);
        dialog.close();
        toast(`${trade.item} supprimé`);
      });
    };

    function save() {
      runAction(/** @type {HTMLButtonElement} */ ($("#e-save", body)), async () => {
        const sold = input("#e-sold").checked;
        const expected = evaluateKamas(input("#e-exp").value);
        const typedSale = input("#e-sp").value.trim();
        await actions.updateTrade({
          ...trade,
          item: input("#e-item").value.trim(),
          date: input("#e-date").value,
          cat: input("#e-cat").value === CATEGORY.RESALE ? CATEGORY.RESALE : CATEGORY.CRAFT,
          cost: evaluateKamas(input("#e-cost").value),
          expected,
          sold,
          // An unreadable price is an error (NaN fails validation), never silently replaced.
          soldPrice: sold ? (typedSale ? evaluateKamas(typedSale) : expected) : null,
          // An empty sale date is allowed: it means "unknown", as for imported rows.
          soldDate: sold ? input("#e-sd").value || null : null,
          hdvTax: Number(input("#e-tax").value),
        });
        dialog.close();
      });
    }
  }

  function openImport() {
    show(`
      <h2 id="dlg-title">Importer depuis ton tableau</h2>
      <p class="hint">Dans Google Sheets ou Excel, sélectionne tes lignes (en-tête compris si tu veux), copie-les, puis colle-les ici.
      Colonnes attendues : Date, Item, Catégorie, Investissement, Vente potentielle, Vendu ? et, si tu les as, Prix de vente et Date de vente.
      Une ligne n'est comptée vendue que si « Vendu ? » est coché. Les lignes déjà présentes (même date et même investissement) sont ignorées.</p>
      <textarea id="i-text" aria-label="Lignes collées" placeholder="2026-08-20&#9;Cape d'Ogivol&#9;Craft/FM&#9;3,368,480.00&#9;4,350,000.00&#9;…&#9;TRUE"></textarea>
      <div class="hint" id="i-sum" aria-live="polite">Colle tes lignes pour voir l'aperçu.</div>
      <div class="actions"><button type="button" class="btn" id="i-cancel">Annuler</button><button type="button" class="btn primary" id="i-go" disabled>Importer</button></div>`);

    const go = /** @type {HTMLButtonElement} */ ($("#i-go", body));
    const summary = /** @type {HTMLElement} */ ($("#i-sum", body));
    /** @type {Omit<Trade, "id">[]} */
    let fresh = [];

    /** @type {HTMLTextAreaElement} */ ($("#i-text", body)).oninput = (e) => {
      const { rows, invalid } = parseSheetPaste(/** @type {HTMLTextAreaElement} */ (e.target).value);
      const result = withoutDuplicates(rows, state.get().trades);
      fresh = result.fresh;
      const soldCount = fresh.filter((r) => r.sold).length;
      summary.textContent = [
        plural(fresh.length, "nouvelle ligne", "nouvelles lignes") +
          (fresh.length ? ` (dont ${plural(soldCount, "vendue")})` : ""),
        result.duplicates ? plural(result.duplicates, "déjà présente", "déjà présentes") : "",
        invalid ? plural(invalid, "illisible ignorée", "illisibles ignorées") : "",
      ]
        .filter(Boolean)
        .join(" · ");
      go.disabled = !fresh.length;
    };
    $("#i-cancel", body).onclick = () => dialog.close();
    go.onclick = async () => {
      go.disabled = true;
      try {
        const n = await actions.importDrafts(fresh, (done, total) => {
          go.textContent = `${done} / ${total}…`;
        });
        dialog.close();
        toast(plural(n, "opération importée", "opérations importées"));
      } catch (error) {
        // Resume after the rows already saved, so a retry never duplicates them.
        fresh = fresh.slice(error instanceof ImportError ? error.saved : 0);
        summary.textContent = `${error.message} · ${plural(fresh.length, "ligne restante", "lignes restantes")}`;
        go.textContent = "Réessayer";
        go.disabled = !fresh.length;
      }
    };
  }

  /**
   * Shows text to copy by hand, for when the browser refuses clipboard access.
   * @param {string} text
   */
  function openCopy(text) {
    show(`
      <h2 id="dlg-title">Copier le tableau</h2>
      <p class="hint">Le navigateur a refusé la copie automatique. Le texte ci-dessous est sélectionné :
      copie-le (Ctrl+C, ou ⌘C sur Mac), puis colle-le dans ton tableur.</p>
      <textarea id="x-text" readonly aria-label="Lignes à copier"></textarea>
      <div class="actions"><button type="button" class="btn" id="x-close">Fermer</button></div>`);
    const area = /** @type {HTMLTextAreaElement} */ ($("#x-text", body));
    area.value = text;
    area.select();
    $("#x-close", body).onclick = () => dialog.close();
  }

  return { openEditor, openImport, openCopy };
}
