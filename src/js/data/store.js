/**
 * @file Persistence. The rest of the app talks to a `TradeStore` and never to
 * the database directly, which keeps storage swappable and testable.
 *
 * Three implementations share one interface:
 * - `createLocalStore()`: the local server's data API (server/main.js), which keeps
 *   everything in one JSON file on this computer: the normal way to run the app;
 * - `createCloudStore(db)`: the claude.ai artifact `db` capability, when the page
 *   is published as an artifact;
 * - `createMemoryStore()`: in-memory, when neither is available, and in tests.
 *
 * The same documents in every backend (details in docs/DATA-MODEL.md):
 *   trades/<id>        one document per trade
 *   settings/prices    { p: { "<ingredientId>": unitPrice } }
 */

import { DB_PATHS, LOCAL_API_URL, RETRY } from "../config.js";
import { normalizeTrade, toDocument } from "../domain/trade.js";

/** @typedef {import("../domain/trade.js").Trade} Trade */

/**
 * @typedef {Object} TradeStore
 * @property {"local"|"cloud"|"memory"} mode
 * @property {(onTrades: (trades: Trade[], meta: {confirmed: boolean}) => void, onError: (e: StoreError) => void) => () => void} subscribe
 *   Calls `onTrades` with the full list now and after every change. Returns an unsubscribe function.
 * @property {(trade: Trade) => Promise<void>} save     Create or replace one trade.
 * @property {(id: string) => Promise<void>} remove
 * @property {() => Promise<Record<string, number>>} loadPrices
 * @property {(changes: Record<string, number>) => Promise<void>} savePrices
 *   Merges `changes` into the stored prices; other remembered prices are kept.
 */

/**
 * @typedef {Object} StoreError
 * @property {string} code     the platform error code, e.g. "quota_exceeded", or for the
 *   local store "offline" (server unreachable) and "rejected" (request refused)
 * @property {string} message
 */

const TRANSIENT = new Set(["unavailable", "resource_exhausted"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `operation`, retrying transient failures with linear backoff and jitter.
 * Permanent errors (bad argument, quota, revoked access) are rethrown at once.
 * @template T
 * @param {() => Promise<T>} operation
 * @param {{attempts?: number, baseDelayMs?: number, jitterMs?: number, wait?: (ms: number) => Promise<void>}} [policy]
 * @returns {Promise<T>}
 */
export async function withRetry(
  operation,
  { attempts = RETRY.ATTEMPTS, baseDelayMs = RETRY.BASE_DELAY_MS, jitterMs = RETRY.JITTER_MS, wait = sleep } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !TRANSIENT.has(error?.code)) throw error;
      await wait(baseDelayMs * attempt + Math.random() * jitterMs);
    }
  }
}

/**
 * User-facing explanation for a storage error (French).
 * @param {unknown} error
 * @returns {string}
 */
export function describeStoreError(error) {
  switch (/** @type {StoreError} */ (error)?.code) {
    case "quota_exceeded":
      return "Stockage plein : supprime d'anciennes opérations.";
    case "invalid_argument":
      return "Tu n'as pas le droit de modifier ce carnet.";
    case "revoked":
      return "Accès retiré : recharge la page.";
    case "offline":
      return "Serveur local injoignable : relance Carnet de Kamas (ou « npm start »), puis réessaie.";
    case "rejected":
      return "Le serveur local a refusé l'enregistrement.";
    default:
      return "Enregistrement impossible pour l'instant. Réessaie dans un moment.";
  }
}

/**
 * Store backed by the artifact `db` capability.
 * @param {any} db  namespace returned by `claude.use("db")`
 * @param {{wait?: (ms: number) => Promise<void>}} [options]  injectable delay, for tests
 * @returns {TradeStore}
 */
export function createCloudStore(db, { wait = sleep } = {}) {
  const trades = db.collection(DB_PATHS.TRADES);
  const prices = db.doc(DB_PATHS.PRICES);
  /** Whether `settings/prices` exists: `update` (merge) rejects on a missing document. */
  let pricesExist = /** @type {boolean|null} */ (null);

  return {
    mode: "cloud",
    subscribe(onTrades, onError) {
      // The platform reconnects a listener on its own, so we keep one for the app's lifetime.
      // The one exception is `unavailable` on the error callback: the host stopped answering,
      // the listener is dead, and only a fresh `onSnapshot` recovers.
      let unsubscribe = () => {};
      let stopped = false;
      const listen = (attempt) => {
        unsubscribe = trades.onSnapshot(
          (snap) => {
            attempt = 1;
            onTrades(
              snap.docs.map((d) => normalizeTrade(d.id, d.data())),
              { confirmed: !snap.metadata.fromCache },
            );
          },
          async (error) => {
            if (error?.code !== "unavailable" || attempt >= RETRY.ATTEMPTS) return onError(error);
            await wait(RETRY.BASE_DELAY_MS * 2 ** attempt + Math.random() * RETRY.JITTER_MS);
            if (!stopped) listen(attempt + 1);
          },
        );
      };
      listen(1);
      return () => {
        stopped = true;
        unsubscribe();
      };
    },
    save: (trade) => withRetry(() => trades.doc(trade.id).set(toDocument(trade))),
    remove: (id) => withRetry(() => trades.doc(id).delete()),
    async loadPrices() {
      const snap = await withRetry(() => prices.get());
      pricesExist = snap.exists;
      return snap.exists ? { ...(snap.data().p ?? {}) } : {};
    },
    async savePrices(changes) {
      if (pricesExist === null) pricesExist = (await withRetry(() => prices.get())).exists;
      // Merge so that prices remembered elsewhere (or not loaded yet) are never overwritten.
      if (pricesExist) await withRetry(() => prices.update({ p: changes }));
      else await withRetry(() => prices.set({ p: { ...changes } }));
      pricesExist = true;
    },
  };
}

/**
 * Store backed by the local server's data API (server/app.js), which keeps every
 * trade and price in one JSON file. Every (re)connection of the server-sent event
 * stream reloads the full list, and a "change" event from another tab or window
 * reloads it too, so all open pages stay in sync. Our own writes reload the list
 * before resolving, so the UI shows them at once.
 * @param {{baseUrl?: string, fetchImpl?: typeof fetch, EventSourceImpl?: typeof EventSource, clientId?: string, wait?: (ms: number) => Promise<void>}} [options]
 *   injectable for tests
 * @returns {TradeStore}
 */
export function createLocalStore({
  baseUrl = LOCAL_API_URL,
  fetchImpl = (input, init) => fetch(input, init),
  EventSourceImpl = globalThis.EventSource,
  clientId = globalThis.crypto.randomUUID(),
  wait = sleep,
} = {}) {
  /** @type {Set<(trades: Trade[], meta: {confirmed: boolean}) => void>} */
  const listeners = new Set();
  const retry = (operation) => withRetry(operation, { wait });

  /**
   * @param {string} method
   * @param {string} path  relative to the API root
   * @param {unknown} [body]
   */
  async function request(method, path, body) {
    let response;
    try {
      response = await fetchImpl(baseUrl + path, {
        method,
        headers: { "x-client-id": clientId, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw { code: "offline", message: String(error?.message ?? error) };
    }
    if (!response.ok) {
      throw { code: response.status >= 500 ? "unavailable" : "rejected", message: `HTTP ${response.status}` };
    }
    return response.status === 204 ? null : response.json();
  }

  async function fetchTrades() {
    const { trades } = await request("GET", "trades");
    return Object.entries(trades).map(([id, doc]) => normalizeTrade(id, doc));
  }

  /** After our own write: reload and notify, ignoring a failure (the event stream will resync). */
  async function publish() {
    try {
      const trades = await fetchTrades();
      listeners.forEach((fn) => fn(trades, { confirmed: true }));
    } catch {
      // The next "change" event or reconnection reloads the list.
    }
  }

  return {
    mode: "local",
    subscribe(onTrades, onError) {
      listeners.add(onTrades);
      const events = new EventSourceImpl(`${baseUrl}events`);
      const reload = () =>
        fetchTrades().then(
          (trades) => listeners.has(onTrades) && onTrades(trades, { confirmed: true }),
          (error) => listeners.has(onTrades) && onError(error),
        );
      events.onopen = reload;
      events.addEventListener("change", (event) => {
        if (/** @type {MessageEvent} */ (event).data !== clientId) reload();
      });
      // EventSource reconnects by itself; until then, say the server cannot be reached.
      events.onerror = () => onError({ code: "offline", message: "Lost the connection to the local server" });
      return () => {
        listeners.delete(onTrades);
        events.close();
      };
    },
    async save(trade) {
      await retry(() => request("PUT", `trades/${encodeURIComponent(trade.id)}`, toDocument(trade)));
      await publish();
    },
    async remove(id) {
      await retry(() => request("DELETE", `trades/${encodeURIComponent(id)}`));
      await publish();
    },
    async loadPrices() {
      const { p } = await retry(() => request("GET", "prices"));
      return { ...p };
    },
    async savePrices(changes) {
      await retry(() => request("PATCH", "prices", { p: changes }));
    },
  };
}

/**
 * Store kept in memory. Same contract as the other stores.
 * @param {Trade[]} [initial]
 * @returns {TradeStore}
 */
export function createMemoryStore(initial = []) {
  const docs = new Map(initial.map((t) => [t.id, toDocument(t)]));
  let prices = {};
  const listeners = new Set();
  const snapshot = () => [...docs.entries()].map(([id, body]) => normalizeTrade(id, body));
  const emit = () => listeners.forEach((fn) => fn(snapshot(), { confirmed: true }));
  return {
    mode: "memory",
    subscribe(onTrades) {
      listeners.add(onTrades);
      queueMicrotask(() => onTrades(snapshot(), { confirmed: true }));
      return () => listeners.delete(onTrades);
    },
    async save(trade) {
      docs.set(trade.id, toDocument(trade));
      emit();
    },
    async remove(id) {
      docs.delete(id);
      emit();
    },
    async loadPrices() {
      return { ...prices };
    },
    async savePrices(changes) {
      prices = { ...prices, ...changes };
    },
  };
}
