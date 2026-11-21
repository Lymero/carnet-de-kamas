/**
 * @file Entry point. Wires state, storage, catalog, actions and UI together.
 *
 * Start-up sequence:
 *   1. render the shell with a loading state;
 *   2. connect storage: the data file through the desktop shell (Tauri) or through the
 *      local server's API (server/main.js), or memory when the page has neither;
 *   3. mount the form, dialogs and router; subscribe to trades;
 *   4. load the item catalog in the background (autocomplete works without it);
 *   5. in the desktop app, look for a newer version and offer it.
 */

import { createActions } from "./actions.js";
import { CATALOG_URL, LOAD_TIMEOUT_MS, LOCAL_API_URL } from "./config.js";
import { ItemCatalog } from "./data/catalog.js";
import { createDesktopStore, createLocalStore, createMemoryStore, describeStoreError } from "./data/store.js";
import { tauriFile } from "./data/tauri-file.js";
import { todayIso } from "./domain/dates.js";
import { plural } from "./domain/text.js";
import { isOpen } from "./domain/trade.js";
import { go, resolveView } from "./router.js";
import { createState } from "./state.js";
import { createDialogs } from "./ui/dialogs.js";
import { $, $$ } from "./ui/dom.js";
import { mountEntryForm } from "./ui/entry-form.js";
import { mountPurchaseImport } from "./ui/purchase-import.js";
import { enableKamasFields } from "./ui/kamas-field.js";
import { renderSummary } from "./ui/summary.js";
import { offerUpdate } from "./ui/update-notice.js";
import { createAnalysisView } from "./ui/views/analysis.js";
import { createHistoryView } from "./ui/views/history.js";
import { createOpenView } from "./ui/views/open.js";

/** @type {ReturnType<typeof createState>} */
const state = createState({
  trades: [],
  loaded: false,
  storage: null,
  prices: {},
  catalog: ItemCatalog.empty(),
  view: "en-cours",
  status: { text: "Chargement…", warn: false },
});

/**
 * Picks the storage: inside the desktop app, the data file through its shell; in a
 * page served by the local server, its data API; otherwise memory (nothing saved).
 * @returns {Promise<{store: import("./data/store.js").TradeStore, dataPath: string|null}>}
 */
async function connectStorage() {
  const tauri = /** @type {any} */ (window).__TAURI__;
  if (tauri) {
    const file = await tauriFile(tauri.core);
    return { store: createDesktopStore(file), dataPath: file.path };
  }
  if (await hasLocalServer()) return { store: createLocalStore(), dataPath: null };
  return { store: createMemoryStore(), dataPath: null };
}

/** True when the page was served by the local server with its data API (server/app.js). */
async function hasLocalServer() {
  try {
    const response = await fetch(`${LOCAL_API_URL}info`);
    return response.ok && (await response.json()).store === "file";
  } catch {
    return false;
  }
}

async function start() {
  const els = {
    status: $("#status"),
    summary: $("#kpis"),
    view: $("#view"),
    countOpen: $("#c-open"),
    countAll: $("#c-all"),
  };

  const { store, dataPath } = await connectStorage();
  if (dataPath) els.status.title = `Fichier de données : ${dataPath}`;
  state.set({
    storage: store.mode,
    status:
      store.mode === "memory"
        ? { text: "Sauvegarde indisponible : rien n'est enregistré dans ce mode.", warn: true }
        : { text: "Connexion…", warn: false },
  });

  const actions = createActions({ store, state });
  enableKamasFields();
  const dialogs = createDialogs(/** @type {HTMLDialogElement} */ ($("#dlg")), { state, actions });
  /** "Refaire" on a past trade: the form starts again from it. @param {import("./domain/trade.js").Trade} trade */
  const redo = (trade) => form.fill(trade);
  const historyView = createHistoryView({ ...dialogs, redo });
  /** @type {Record<string, import("./ui/views/view.js").View>} */
  const views = {
    "en-cours": createOpenView({ actions, openEditor: dialogs.openEditor, redo }),
    historique: historyView,
    analyse: createAnalysisView({
      onItem: (name) => {
        historyView.showItem(name);
        go("historique");
      },
    }),
  };

  const form = mountEntryForm(/** @type {HTMLFormElement} */ ($("#addForm")), {
    state,
    actions,
    onAdded: (trade) => {
      if (isOpen(trade) && state.get().view !== "en-cours") go("en-cours");
    },
  });

  mountPurchaseImport({
    dialog: /** @type {HTMLDialogElement} */ ($("#dlg")),
    form: /** @type {HTMLFormElement} */ ($("#addForm")),
    recipe: form.recipe,
  });

  // ----- routing -----
  /** @type {import("./ui/views/view.js").View|null} */
  let mounted = null;
  function showView() {
    const s = state.get();
    const name = resolveView(location.hash, s.trades.some(isOpen));
    mounted?.unmount();
    mounted = views[name];
    mounted.mount(els.view);
    state.set({ view: name });
    paint(state.get(), new Set(["trades"]));
  }
  window.addEventListener("hashchange", showView);

  // ----- keyboard shortcuts -----
  // "/" searches the Historique and "n" starts a new trade, as in many web apps; never while
  // typing in a field, with a modifier key, or with a dialog open.
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || $("dialog[open]")) return;
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.isContentEditable || target.closest?.("input, textarea, select")) return;
    if (e.key === "/") {
      e.preventDefault();
      const focusSearch = () => /** @type {HTMLInputElement|null} */ ($("#h-q"))?.focus();
      if (state.get().view === "historique") focusSearch();
      else {
        // showView, registered first, renders the view before this runs.
        window.addEventListener("hashchange", focusSearch, { once: true });
        go("historique");
      }
    } else if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      /** @type {HTMLInputElement|null} */ ($("#f-item"))?.focus();
    }
  });

  // ----- rendering -----
  /** @param {import("./state.js").AppState} s @param {Set<string>} changed */
  function paint(s, changed) {
    if (changed.has("status")) {
      els.status.textContent = s.status.text;
      els.status.classList.toggle("warn", s.status.warn);
    }
    if (changed.has("view")) {
      $$("#tabs a").forEach((a) => a.toggleAttribute("aria-current", false));
      $(`#tabs a[data-v="${s.view}"]`)?.setAttribute("aria-current", "page");
    }
    if (changed.has("catalog") || changed.has("prices")) form.refresh();
    // Views and the summary do not use the catalog: re-rendering them for it would only disturb typing.
    if (changed.has("trades") || changed.has("loaded")) {
      renderSummary(els.summary, s, todayIso());
      els.countOpen.textContent = String(s.trades.filter(isOpen).length);
      els.countAll.textContent = String(s.trades.length);
      if (!s.loaded) els.view.innerHTML = `<div class="empty">Chargement de ton carnet…</div>`;
      else mounted?.update(s);
    }
  }
  state.subscribe(paint);
  paint(state.get(), new Set(["status", "view", "trades"]));

  // ----- data -----
  const loadTimer = setTimeout(() => {
    state.set({
      status: {
        text: state.get().loaded
          ? "Données peut-être pas à jour (connexion lente)."
          : "Impossible de joindre la sauvegarde pour l'instant.",
        warn: true,
      },
    });
  }, LOAD_TIMEOUT_MS);

  store.subscribe(
    (trades, { confirmed }) => {
      const first = !state.get().loaded;
      state.set({ trades, loaded: true });
      if (confirmed) {
        clearTimeout(loadTimer);
        // Also replaces a warning shown by the timer or a lost connection.
        if (store.mode !== "memory") {
          state.set({ status: { text: `${plural(trades.length, "opération")} · enregistré sur ce PC`, warn: false } });
        }
      }
      if (first) showView();
    },
    (error) => {
      clearTimeout(loadTimer);
      state.set({ loaded: true, status: { text: describeStoreError(error), warn: true } });
    },
  );

  store
    .loadPrices()
    // Prices typed before the load finished are newer than the stored ones: keep them.
    .then((stored) => state.set({ prices: { ...stored, ...state.get().prices } }))
    .catch((e) => console.warn("Could not read the remembered prices", e));

  ItemCatalog.load(CATALOG_URL)
    .then((catalog) => state.set({ catalog }))
    .catch((e) => console.warn("Item catalog unavailable; autocomplete limited to own history.", e));

  const tauri = /** @type {any} */ (window).__TAURI__;
  if (tauri) offerUpdate(tauri.core, $("#update"));
}

start().catch((error) => {
  console.error(error);
  const status = $("#status");
  if (status) {
    status.textContent = "Le carnet n'a pas pu démarrer : relance-le.";
    status.classList.add("warn");
  }
  const view = $("#view");
  if (view) view.innerHTML = `<div class="empty">Impossible d'afficher le carnet.</div>`;
});
