/**
 * @file "Investissement depuis des captures du chat…": fills the investment field from
 * screenshots of the game chat listing purchases (`10 x [Griffe de Buboxor] (228 223
 * kamas)`), read on this computer by the offline text reader (ui/screenshot-ocr.js).
 *
 * Two steps, in the shared <dialog id="dlg">: the screenshots (picked, dropped or
 * pasted), then the lines read, each next to its picture cut from the screenshot, in a
 * list the player checks and fixes (counted or not, price; lines added or removed) with
 * a running total. Only "Utiliser ce total" writes to the field; typing in the field by
 * hand works as before.
 *
 * The list is local to the dialog: nothing is saved, so no action is involved.
 */

import { SCREENSHOTS } from "../config.js";
import { evaluateKamas, formatKamas, isKamas } from "../domain/kamas.js";
import { combineReadings, purchaseTotal, readOcrLines, reviewLines } from "../domain/purchases.js";
import { plural } from "../domain/text.js";
import { $, $$, closest, esc, toast } from "./dom.js";
import { createScreenshotReader } from "./screenshot-ocr.js";

/** @typedef {import("../domain/purchases.js").ReviewLine} Row */

/**
 * @typedef {Object} Shot  One screenshot.
 * @property {string} name
 * @property {Blob} file
 * @property {ImageBitmap} [image]  once read, to cut each line's picture from
 * @property {string} [error]  why it could not be read
 */

/** Room left around a line's picture, in screenshot pixels. */
const PICTURE_MARGIN = 2;

/**
 * @param {{dialog: HTMLDialogElement, button: HTMLButtonElement, costInput: HTMLInputElement}} options
 */
export function mountPurchaseImport({ dialog, button, costInput }) {
  const body = /** @type {HTMLFormElement} */ ($(".dlg", dialog));
  const reader = createScreenshotReader();

  /** @type {Shot[]} */
  let shots = [];
  /** @type {Row[]} */
  let rows = [];
  /** Set while the screenshot step is shown, so pasting an image adds it. */
  let acceptsPaste = false;
  /** Set while this feature owns the dialog (it is shared with the other dialogs). */
  let open = false;

  /**
   * @param {string} html  contains the title element with id "dlg-title"
   * @param {() => void} [onSubmit]
   */
  function show(html, onSubmit = () => {}) {
    open = true;
    acceptsPaste = false;
    // Wide enough for the review list; the other dialogs keep their size.
    dialog.classList.toggle("wide", html.includes('id="r-rows"'));
    body.innerHTML = html;
    body.onsubmit = (e) => {
      e.preventDefault();
      onSubmit();
    };
    if (!dialog.open) dialog.showModal();
    $("[data-close]", body)?.addEventListener("click", () => dialog.close());
  }

  dialog.addEventListener("close", () => {
    if (!open) return;
    open = false;
    acceptsPaste = false;
    dialog.classList.remove("wide");
    shots.forEach((shot) => shot.image?.close());
    shots = [];
    rows = [];
    // Frees the reader's memory; it starts again on the next use.
    reader.close().catch((error) => console.warn("Could not stop the text reader", error));
  });

  dialog.addEventListener("paste", (e) => {
    if (!acceptsPaste) return;
    const files = [...(e.clipboardData?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });

  button.addEventListener("click", () => {
    shots = [];
    rows = [];
    showShots();
  });

  // ----- step 1: the screenshots -----
  function showShots() {
    show(
      `
      <h2 id="dlg-title">Investissement depuis des captures</h2>
      <p class="hint">Choisis une ou plusieurs captures du chat où le jeu liste tes achats
      (« 10 x [Griffe de Buboxor] (228 223 kamas) »), dans l'ordre. Tu peux aussi les glisser ici ou les coller (Ctrl+V).
      Elles sont lues sur ce PC, sans internet ; tu vérifies les lignes lues avant que le total remplisse l'investissement.</p>
      <label class="drop" id="s-drop">
        <input type="file" id="s-files" accept="${SCREENSHOTS.TYPES.join(",")}" multiple>
        <span>ou glisse tes captures ici</span>
      </label>
      <ul class="shots" id="s-list" aria-live="polite"></ul>
      <div class="actions">
        <button type="button" class="btn" data-close>Annuler</button>
        <button type="submit" class="btn primary" id="s-read" disabled>Lire les captures</button>
      </div>`,
      readShots,
    );
    acceptsPaste = true;
    renderShotList();
    const input = /** @type {HTMLInputElement} */ ($("#s-files", body));
    input.addEventListener("change", () => {
      addFiles([...(input.files ?? [])]);
      input.value = "";
    });
    const drop = /** @type {HTMLElement} */ ($("#s-drop", body));
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      addFiles([...(e.dataTransfer?.files ?? [])]);
    });
    $("#s-list", body)?.addEventListener("click", (e) => {
      const remove = closest(e, "[data-remove]");
      if (!remove) return;
      shots.splice(Number(remove.dataset.remove), 1);
      renderShotList();
    });
  }

  /** @param {File[]} files */
  function addFiles(files) {
    for (const file of files) {
      if (shots.length >= SCREENSHOTS.MAX) {
        toast(`${SCREENSHOTS.MAX} captures au plus à la fois.`);
        break;
      }
      if (!SCREENSHOTS.TYPES.includes(file.type)) {
        toast(`${file.name || "Ce fichier"} n'est pas une image PNG, JPEG, WebP, GIF ou BMP.`);
        continue;
      }
      shots.push({ name: file.name || `Capture collée ${shots.length + 1}`, file });
    }
    if (acceptsPaste) renderShotList();
  }

  function renderShotList() {
    const list = $("#s-list", body);
    if (!list) return;
    list.innerHTML = shots
      .map(
        (shot, i) =>
          `<li><span>${i + 1}. ${esc(shot.name)}</span><button type="button" class="btn small" data-remove="${i}" aria-label="Retirer ${esc(shot.name)}">Retirer</button></li>`,
      )
      .join("");
    /** @type {HTMLButtonElement} */ ($("#s-read", body)).disabled = !shots.length;
  }

  // ----- reading -----
  async function readShots() {
    const read = /** @type {HTMLButtonElement} */ ($("#s-read", body));
    if (!shots.length || read.disabled) return;
    read.disabled = true;
    acceptsPaste = false;
    /** @type {import("../domain/purchases.js").PurchaseLine[][]} */
    const perShot = [];
    // One at a time: the reader works on one image anyway, and the count stays honest.
    for (const [i, shot] of shots.entries()) {
      if (!read.isConnected) return; // closed meanwhile
      read.textContent = `Lecture… ${i + 1} / ${shots.length}`;
      delete shot.error;
      try {
        shot.image?.close();
        const { readings, image } = await reader.read(shot.file);
        shot.image = image;
        perShot.push(combineReadings(readings.map(readOcrLines)));
      } catch (error) {
        console.warn("Could not read a screenshot", error);
        shot.error = "Cette image n'a pas pu être lue.";
        perShot.push([]);
      }
    }
    if (!read.isConnected) return;
    rows = reviewLines(perShot);
    showReview();
  }

  // ----- step 2: review -----
  function showReview() {
    show(
      `
      <h2 id="dlg-title">Vérifie les achats lus</h2>
      <p class="hint">Compare chaque prix à la ligne de la capture, corrige-le si besoin, décoche ce qui ne compte pas.
      « à vérifier » : la lecture est douteuse. « ligne sautée ? » : une ligne semble manquer ici ; tape son prix ou décoche-la.
      « doublon ? » : la ligne apparaît aussi au bord de la capture précédente, elle n'est pas comptée ; coche-la si ce sont bien deux achats.</p>
      <div class="scroll"><table class="grid lots">
        <thead><tr><th><span class="sr">Compter</span></th><th>Ligne de la capture</th><th class="n">Prix du lot</th><th><span class="sr">Retirer</span></th></tr></thead>
        <tbody id="r-rows"></tbody>
      </table></div>
      <button type="button" class="btn small add-lot" id="r-add">Ajouter une ligne</button>
      <div class="preview"><span id="r-count"></span><b class="num" id="r-total"></b></div>
      <div class="actions">
        <button type="button" class="btn left" id="r-back">Autres captures</button>
        <button type="button" class="btn" data-close>Annuler</button>
        <button type="submit" class="btn primary" id="r-use">Utiliser ce total</button>
      </div>`,
      useTotal,
    );
    renderRows();
    const tbody = /** @type {HTMLElement} */ ($("#r-rows", body));
    tbody.addEventListener("input", (e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const row = rows[Number(input.closest("tr")?.dataset.i)];
      if (!row) return;
      if (input.dataset.f === "counted") row.counted = input.checked;
      else if (input.dataset.f === "item") row.item = input.value;
      else if (input.dataset.f === "price") row.price = evaluateKamas(input.value);
      input.closest("tr")?.classList.toggle("off", !row.counted);
      renderTotal();
    });
    tbody.addEventListener("click", (e) => {
      const remove = closest(e, "[data-remove]");
      if (!remove) return;
      rows.splice(Number(remove.dataset.remove), 1);
      renderRows();
    });
    $("#r-add", body)?.addEventListener("click", () => {
      rows.push({ shot: -1, text: "", quantity: NaN, item: "", price: NaN, counted: true, flag: "", box: null });
      renderRows();
      /** @type {HTMLInputElement|null} */ ($(`tr[data-i="${rows.length - 1}"] [data-f="item"]`, body))?.focus();
    });
    $("#r-back", body)?.addEventListener("click", showShots);
  }

  function renderRows() {
    const tbody = $("#r-rows", body);
    if (!tbody) return;
    let html = "";
    shots.forEach((shot, s) => {
      const count = rows.filter((row) => row.shot === s).length;
      const detail = shot.error ? `<span class="bad-text">${esc(shot.error)}</span>` : plural(count, "ligne", "lignes");
      html += `<tr class="shot"><td colspan="4">${s + 1}. ${esc(shot.name)} · ${detail}</td></tr>`;
      rows.forEach((row, i) => {
        if (row.shot === s) html += rowHtml(row, i);
      });
    });
    const added = rows.map((row, i) => (row.shot === -1 ? rowHtml(row, i) : "")).join("");
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
    const row = rows[Number(canvas.dataset.pic)];
    const image = shots[row?.shot]?.image;
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
    const counted = rows.filter((row) => row.counted);
    const unreadable = counted.filter((row) => !isKamas(row.price)).length;
    const total = purchaseTotal(counted.filter((row) => isKamas(row.price)));
    /** @type {HTMLElement} */ ($("#r-count", body)).textContent =
      `Total de ${plural(counted.length, "lot")}` +
      (unreadable ? ` · ${plural(unreadable, "prix manquant", "prix manquants")}` : "");
    /** @type {HTMLElement} */ ($("#r-total", body)).textContent = formatKamas(total);
    /** @type {HTMLButtonElement} */ ($("#r-use", body)).disabled = !counted.length || unreadable > 0;
  }

  function useTotal() {
    const counted = rows.filter((row) => row.counted);
    if (!counted.length || counted.some((row) => !isKamas(row.price))) return;
    const total = purchaseTotal(counted);
    costInput.value = formatKamas(total);
    // The form reacts as to typing: preview, and the recipe stops filling the field.
    costInput.dispatchEvent(new Event("input", { bubbles: true }));
    dialog.close();
    toast(`Investissement : ${formatKamas(total)} (${plural(counted.length, "lot")})`);
  }
}
