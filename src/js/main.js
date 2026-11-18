/**
 * @file Entry point. Wires state, storage, catalog, actions and UI together.
 *
 * Start-up sequence:
 *   1. render the shell with a loading state;
 *   2. connect storage: the local server's data file (server/main.js), the claude.ai `db`
 *      capability when published as an artifact, or memory when neither is there;
 *   3. mount the form, dialogs and router; subscribe to trades;
 *   4. load the item catalog in the background (autocomplete works without it).
 */

import { createActions } from "./actions.js";
import { CATALOG_URL, DB_PATHS, LOAD_TIMEOUT_MS, LOCAL_API_URL } from "./config.js";
import { ItemCatalog } from "./data/catalog.js";
import { createCloudStore, createLocalStore, createMemoryStore, describeStoreError } from "./data/store.js";
import { todayIso } from "./domain/dates.js";
import { plural } from "./domain/text.js";
import { isOpen } from "./domain/trade.js";
import { go, resolveView } from "./router.js";
import { createState } from "./state.js";
import { createDialogs } from "./ui/dialogs.js";
import { $, $$ } from "./ui/dom.js";
import { mountEntryForm } from "./ui/entry-form.js";
import { enableKamasFields } from "./ui/kamas-field.js";
import { renderSummary } from "./ui/summary.js";
import { createAnalysisView } from "./ui/views/analysis.js";
import { createHistoryView } from "./ui/views/history.js";
import { createOpenView } from "./ui/views/open.js";

/** @type {ReturnType<typeof createState>} */
const state = createState({
  trades: [],
  loaded: false,
  canWrite: true,
  storage: null,
  prices: {},
  catalog: ItemCatalog.empty(),
  view: "en-cours",
  status: { text: "Chargement…", warn: false },
});

/**
 * Picks the storage. Published on claude.ai, the page uses the artifact capabilities
 * (`claude.use` resolves null for a signed-out viewer: memory then). Otherwise it uses
 * the local server's data API when the page was served by server/main.js, else memory.
 * @returns {Promise<{store: import("./data/store.js").TradeStore, user: any}>}
 */
async function connectStorage() {
  const host = /** @type {any} */ (window).claude;
  if (typeof host?.use !== "function") {
    return { store: (await hasLocalServer()) ? createLocalStore() : createMemoryStore(), user: null };
  }
  // Settled separately: a failing `user` capability must not throw away a working database.
  const [db, user] = await Promise.allSettled([host.use("db"), host.use("user")]);
  const namespace = db.status === "fulfilled" ? db.value : null;
  return {
    store: namespace ? createCloudStore(namespace) : createMemoryStore(),
    user: user.status === "fulfilled" ? user.value : null,
  };
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

/** @param {any} user @returns {Promise<boolean>} */
async function canWrite(user) {
  try {
    // null means "unknown": allow, and let a rejected write explain itself.
    return (await user?.can?.("data.write")) !== false;
  } catch {
    return true;
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

  const { store, user } = await connectStorage();
  const writable = await canWrite(user);
  const readOnlyStatus = { text: "Lecture seule : seul le propriétaire peut modifier ce carnet.", warn: false };
  state.set({
    storage: store.mode,
    canWrite: writable,
    status:
      store.mode === "memory"
        ? {
            text: "Sauvegarde indisponible : ouvre l'app avec son lanceur « Carnet de Kamas » pour garder tes données.",
            warn: true,
          }
        : writable
          ? { text: "Connexion…", warn: false }
          : readOnlyStatus,
  });

  const actions = createActions({ store, state });
  enableKamasFields();
  const dialogs = createDialogs(/** @type {HTMLDialogElement} */ ($("#dlg")), { state, actions });
  const historyView = createHistoryView(dialogs);
  /** @type {Record<string, import("./ui/views/view.js").View>} */
  const views = {
    "en-cours": createOpenView({ actions, openEditor: dialogs.openEditor }),
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
  form.applyWriteMode();

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
    if (changed.has("canWrite")) form.applyWriteMode();
    if (changed.has("catalog") || changed.has("prices")) form.refresh();
    // Views and the summary do not use the catalog: re-rendering them for it would only disturb typing.
    if (["trades", "loaded", "canWrite"].some((k) => changed.has(k))) {
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
        // Also replaces a "slow connection" warning shown by the timer.
        if (store.mode !== "memory") {
          const where = store.mode === "local" ? "enregistré sur ce PC" : "sauvegardé";
          state.set({
            status: writable
              ? { text: `${plural(trades.length, "opération")} · ${where}`, warn: false }
              : readOnlyStatus,
          });
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
    .catch((e) => console.warn(`Could not read ${DB_PATHS.PRICES}`, e));

  ItemCatalog.load(CATALOG_URL)
    .then((catalog) => state.set({ catalog }))
    .catch((e) => console.warn("Item catalog unavailable; autocomplete limited to own history.", e));
}

start().catch((error) => {
  console.error(error);
  const status = $("#status");
  if (status) {
    status.textContent = "Le carnet n'a pas pu démarrer : recharge la page (détails dans la console du navigateur).";
    status.classList.add("warn");
  }
  const view = $("#view");
  if (view) view.innerHTML = `<div class="empty">Impossible d'afficher le carnet.</div>`;
});
