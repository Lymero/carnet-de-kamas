/**
 * @file Fills the investment field from screenshots of the game chat listing purchases
 * (`10 x [Griffe de Buboxor] (228 223 kamas)`), read on this computer by the offline text
 * reader (ui/screenshot-ocr.js).
 *
 * Screenshots come in by pasting one anywhere on the page (Ctrl+V, no other dialog open),
 * dropping them on the entry form, or "Lire des captures du chat…". Each is read at once
 * and the total goes straight into the investment field: the reading is trusted. Further
 * screenshots add to the same purchase, lines repeated where two overlap left out.
 *
 * "Vérifier les N lots lus" opens the list of lines read, each next to its picture cut
 * from the screenshot, to double-check and fix (counted or not, price; lines added or
 * removed) with a running total; "Utiliser ce total" writes it to the field.
 *
 * The screenshots belong to the investment shown: changing the field by hand or adding
 * the trade forgets them. Nothing is saved, so no action is involved.
 */

import { SCREENSHOTS } from "../config.js";
import { evaluateKamas, formatKamas, isKamas } from "../domain/kamas.js";
import { combineReadings, purchaseTotal, readOcrLines, reviewLines } from "../domain/purchases.js";
import { plural } from "../domain/text.js";
import { $, $$, closest, esc, toast } from "./dom.js";
import { createScreenshotReader } from "./screenshot-ocr.js";

/** @typedef {import("../domain/purchases.js").ReviewLine} Row */
/** @typedef {import("../domain/purchases.js").PurchaseLine} PurchaseLine */

/**
 * @typedef {Object} Shot  One screenshot read.
 * @property {string} name
 * @property {ImageBitmap} image  to cut each line's picture from
 * @property {PurchaseLine[]} lines  as read, to spot repeats with the next screenshot
 */

/** Room left around a line's picture, in screenshot pixels. */
const PICTURE_MARGIN = 2;
/** The reader's engines are freed after this long without a screenshot (ms). */
const IDLE_CLOSE = 60_000;
const STATUS_IDLE = "ou colle une capture (Ctrl+V)";

/**
 * @param {{dialog: HTMLDialogElement, form: HTMLFormElement}} options
 */
export function mountPurchaseImport({ dialog, form }) {
  const body = /** @type {HTMLFormElement} */ ($(".dlg", dialog));
  const costInput = /** @type {HTMLInputElement} */ ($("#f-cost", form));
  const pick = /** @type {HTMLButtonElement} */ ($("#f-shots", form));
  const check = /** @type {HTMLButtonElement} */ ($("#f-shots-check", form));
  const status = /** @type {HTMLElement} */ ($("#f-shots-status", form));
  const fileInput = /** @type {HTMLInputElement} */ ($("#f-shots-file", form));
  const reader = createScreenshotReader();

  /** @type {Shot[]} */
  let shots = [];
  /** @type {Row[]} the lines of all screenshots, as last used for the investment */
  let rows = [];
  /** @type {Row[]|null} the list being checked in the dialog: a copy, kept only by "Utiliser ce total" */
  let draft = null;
  /** The value written to the investment field, to notice when it is changed by hand. */
  let written = "";
  /** Screenshots are read one after the other, in the order they came. */
  let queue = Promise.resolve();
  let waiting = 0;
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let idle;

  // ----- screenshots in -----
  fileInput.accept = SCREENSHOTS.TYPES.join(",");
  pick.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    addFiles([...(fileInput.files ?? [])]);
    fileInput.value = "";
  });

  document.addEventListener("paste", (e) => {
    // Another dialog (edit, import…) keeps its own paste.
    if (dialog.open && !draft) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });

  const hasFiles = (/** @type {DragEvent} */ e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  form.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    form.classList.add("drop-over");
  });
  form.addEventListener("dragleave", (e) => {
    if (!form.contains(/** @type {Node|null} */ (e.relatedTarget))) form.classList.remove("drop-over");
  });
  form.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    form.classList.remove("drop-over");
    addFiles([...(e.dataTransfer?.files ?? [])]);
  });

  // ----- the screenshots belong to the investment shown -----
  costInput.addEventListener("input", () => {
    if (costInput.value !== written) forget();
  });
  form.addEventListener("reset", forget);

  function forget() {
    if (!shots.length && !rows.length) return;
    shots.forEach((shot) => shot.image.close());
    shots = [];
    rows = [];
    written = "";
    renderBar();
  }

  /** @param {File[]} files */
  function addFiles(files) {
    const accepted = [];
    for (const file of files) {
      if (!SCREENSHOTS.TYPES.includes(file.type)) {
        toast(`${file.name || "Ce fichier"} n'est pas une image PNG, JPEG, WebP, GIF ou BMP.`);
        continue;
      }
      if (shots.length + waiting + accepted.length >= SCREENSHOTS.MAX) {
        toast(`${SCREENSHOTS.MAX} captures au plus pour un même investissement.`);
        break;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;
    waiting += accepted.length;
    clearTimeout(idle);
    queue = queue.then(() => readFiles(accepted));
  }

  // ----- reading -----
  /** @param {File[]} files */
  async function readFiles(files) {
    let added = 0;
    pick.disabled = true;
    for (const file of files) {
      status.textContent = waiting > 1 ? `Lecture des captures… (${waiting} restantes)` : "Lecture de la capture…";
      try {
        const { readings, image } = await reader.read(file);
        const lines = combineReadings(readings.map(readOcrLines));
        const previous = shots.at(-1);
        const index = shots.length;
        shots.push({ name: file.name || `Capture collée ${index + 1}`, image, lines });
        // Repeats are spotted against the screenshot before, as read.
        const fresh = previous
          ? reviewLines([previous.lines, lines]).filter((row) => row.shot === 1)
          : reviewLines([lines]);
        const newRows = fresh.map((row) => ({ ...row, shot: index }));
        rows.push(...newRows);
        draft?.push(...newRows.map((row) => ({ ...row })));
        added += newRows.length;
      } catch (error) {
        console.warn("Could not read a screenshot", error);
        toast(`${file.name || "La capture"} n'a pas pu être lue.`);
      }
      waiting -= 1;
    }
    pick.disabled = false;
    if (waiting === 0) {
      idle = setTimeout(() => {
        reader.close().catch((error) => console.warn("Could not stop the text reader", error));
      }, IDLE_CLOSE);
    }
    if (added) apply(rows);
    else toast(files.length > 1 ? "Aucun achat trouvé dans ces captures." : "Aucun achat trouvé dans cette capture.");
    renderBar();
    if (draft) renderRows();
  }

  /**
   * Writes the total of the counted lines to the investment field.
   * @param {Row[]} lines
   */
  function apply(lines) {
    const counted = lines.filter((row) => row.counted && isKamas(row.price));
    const total = purchaseTotal(counted);
    written = formatKamas(total);
    costInput.value = written;
    // The form reacts as to typing: preview, and the recipe stops filling the field.
    costInput.dispatchEvent(new Event("input", { bubbles: true }));
    toast(`Investissement : ${written} (${plural(counted.length, "lot")})`);
  }

  function renderBar() {
    const counted = rows.filter((row) => row.counted);
    const missing = counted.filter((row) => !isKamas(row.price)).length;
    check.hidden = !rows.length;
    check.textContent = counted.length === 1 ? "Vérifier le lot lu" : `Vérifier les ${counted.length} lots lus`;
    check.classList.toggle("warn", missing > 0);
    status.textContent = !rows.length
      ? STATUS_IDLE
      : missing
        ? `${plural(missing, "ligne illisible non comptée", "lignes illisibles non comptées")}`
        : `${plural(shots.length, "capture")} · colle la suivante pour l'ajouter`;
  }

  // ----- checking the lines read -----
  check.addEventListener("click", showReview);

  dialog.addEventListener("close", () => {
    if (!draft) return;
    draft = null;
    dialog.classList.remove("wide");
  });

  function showReview() {
    draft = rows.map((row) => ({ ...row }));
    dialog.classList.add("wide");
    body.innerHTML = `
      <h2 id="dlg-title">Vérifie les achats lus</h2>
      <p class="hint">Compare chaque prix à la ligne de la capture, corrige-le si besoin, décoche ce qui ne compte pas.
      « à vérifier » : la lecture est douteuse. « ligne sautée ? » : une ligne semble manquer ici ; tape son prix ou décoche-la.
      « doublon ? » : la ligne apparaît aussi au bord de la capture précédente, elle n'est pas comptée ; coche-la si ce sont bien deux achats.</p>
      <div class="scroll"><table class="grid lots">
        <thead><tr><th><span class="sr">Compter</span></th><th>Ligne de la capture</th><th class="n">Prix du lot</th><th><span class="sr">Retirer</span></th></tr></thead>
        <tbody id="r-rows"></tbody>
      </table></div>
      <div class="add-lot">
        <button type="button" class="btn small" id="r-add">Ajouter une ligne</button>
        <button type="button" class="btn small" id="r-more">Ajouter des captures…</button>
      </div>
      <div class="preview"><span id="r-count"></span><b class="num" id="r-total"></b></div>
      <div class="actions">
        <button type="button" class="btn" data-close>Annuler</button>
        <button type="submit" class="btn primary" id="r-use">Utiliser ce total</button>
      </div>`;
    body.onsubmit = (e) => {
      e.preventDefault();
      useTotal();
    };
    if (!dialog.open) dialog.showModal();
    $("[data-close]", body)?.addEventListener("click", () => dialog.close());
    renderRows();
    const tbody = /** @type {HTMLElement} */ ($("#r-rows", body));
    tbody.addEventListener("input", (e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const row = draft?.[Number(input.closest("tr")?.dataset.i)];
      if (!row) return;
      if (input.dataset.f === "counted") row.counted = input.checked;
      else if (input.dataset.f === "item") row.item = input.value;
      else if (input.dataset.f === "price") row.price = evaluateKamas(input.value);
      input.closest("tr")?.classList.toggle("off", !row.counted);
      renderTotal();
    });
    tbody.addEventListener("click", (e) => {
      const remove = closest(e, "[data-remove]");
      if (!remove || !draft) return;
      draft.splice(Number(remove.dataset.remove), 1);
      renderRows();
    });
    $("#r-add", body)?.addEventListener("click", () => {
      if (!draft) return;
      draft.push({ shot: -1, text: "", quantity: NaN, item: "", price: NaN, counted: true, flag: "", box: null });
      renderRows();
      /** @type {HTMLInputElement|null} */ ($(`tr[data-i="${draft.length - 1}"] [data-f="item"]`, body))?.focus();
    });
    $("#r-more", body)?.addEventListener("click", () => fileInput.click());
  }

  function renderRows() {
    const tbody = $("#r-rows", body);
    if (!tbody || !draft) return;
    const list = draft;
    let html = "";
    shots.forEach((shot, s) => {
      const count = list.filter((row) => row.shot === s).length;
      html += `<tr class="shot"><td colspan="4">${s + 1}. ${esc(shot.name)} · ${plural(count, "ligne", "lignes")}</td></tr>`;
      list.forEach((row, i) => {
        if (row.shot === s) html += rowHtml(row, i);
      });
    });
    const added = list.map((row, i) => (row.shot === -1 ? rowHtml(row, i) : "")).join("");
    if (added) html += `<tr class="shot"><td colspan="4">Ajoutées à la main</td></tr>${added}`;
    tbody.innerHTML = html || `<tr><td colspan="4" class="hint">Aucun achat lu.</td></tr>`;
    $$("canvas[data-pic]", tbody).forEach((canvas) => drawPicture(/** @type {HTMLCanvasElement} */ (canvas)));
    renderTotal();
  }

  /** @param {Row} row @param {number} i */
  function rowHtml(row, i) {
    const flag = {
      "": "",
      check: `<span class="pill warn">à vérifier</span>`,
      skipped: `<span class="pill warn">ligne sautée ?</span>`,
      overlap: `<span class="pill warn">doublon ?</span>`,
    }[row.flag];
    const label = esc(row.item || (row.flag === "skipped" ? "ligne sautée" : "ligne ajoutée"));
    const read =
      row.shot === -1
        ? `<input type="text" data-f="item" value="${esc(row.item)}" placeholder="Objet (facultatif)" aria-label="Objet">`
        : `<canvas data-pic="${i}" role="img" aria-label="${esc(row.text || "Zone sans ligne lue")}"></canvas>
           <div class="read">${row.item ? `${Number.isNaN(row.quantity) ? "" : `${row.quantity} × `}${esc(row.item)}` : ""} ${flag}</div>`;
    return `<tr data-i="${i}" class="${row.counted ? "" : "off"}">
      <td><input type="checkbox" data-f="counted" ${row.counted ? "checked" : ""} aria-label="Compter ${label}"></td>
      <td class="pic">${read}</td>
      <td class="n"><input type="text" class="kamas" data-f="price" value="${Number.isNaN(row.price) ? "" : formatKamas(row.price)}" placeholder="prix" aria-label="Prix du lot ${label}"></td>
      <td><button type="button" class="btn small" data-remove="${i}" aria-label="Retirer ${label}">✕</button></td>
    </tr>`;
  }

  /** Cuts the row's line out of its screenshot. @param {HTMLCanvasElement} canvas */
  function drawPicture(canvas) {
    const row = draft?.[Number(canvas.dataset.pic)];
    const image = row ? shots[row.shot]?.image : undefined;
    if (!row?.box || !image) {
      canvas.hidden = true;
      return;
    }
    const x = Math.max(0, Math.floor(row.box.x0 - PICTURE_MARGIN));
    const y = Math.max(0, Math.floor(row.box.y0 - PICTURE_MARGIN));
    const w = Math.min(image.width - x, Math.ceil(row.box.x1 - row.box.x0 + 2 * PICTURE_MARGIN));
    const h = Math.min(image.height - y, Math.ceil(row.box.y1 - row.box.y0 + 2 * PICTURE_MARGIN));
    if (w <= 0 || h <= 0) {
      canvas.hidden = true;
      return;
    }
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(image, x, y, w, h, 0, 0, w, h);
  }

  function renderTotal() {
    const counted = (draft ?? []).filter((row) => row.counted);
    const unreadable = counted.filter((row) => !isKamas(row.price)).length;
    const total = purchaseTotal(counted.filter((row) => isKamas(row.price)));
    /** @type {HTMLElement} */ ($("#r-count", body)).textContent =
      `Total de ${plural(counted.length, "lot")}` +
      (unreadable ? ` · ${plural(unreadable, "prix manquant", "prix manquants")}` : "");
    /** @type {HTMLElement} */ ($("#r-total", body)).textContent = formatKamas(total);
    /** @type {HTMLButtonElement} */ ($("#r-use", body)).disabled = !counted.length || unreadable > 0;
  }

  function useTotal() {
    if (!draft) return;
    const counted = draft.filter((row) => row.counted);
    if (!counted.length || counted.some((row) => !isKamas(row.price))) return;
    rows = draft;
    apply(rows);
    dialog.close();
    renderBar();
  }
}
