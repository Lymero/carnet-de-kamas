/**
 * @file Persistence. The rest of the app talks to a `TradeStore` and never to the
 * storage directly, which keeps storage swappable and testable.
 *
 * Three implementations share one interface:
 * - `createDesktopStore(file)`: the desktop app (Tauri), reading and writing the data
 *   file itself;
 * - `createLocalStore()`: the page served by the local server (server/main.js), through
 *   its data API;
 * - `createMemoryStore()`: in memory, when the page has neither, and in tests.
 *
 * The first two keep the same data file (data-file.js; format in docs/DATA-MODEL.md).
 */

import { LOCAL_API_URL, RETRY } from "../config.js";
import { normalizeTrade, toDocument } from "../domain/trade.js";
import { openDataFile } from "./data-file.js";

/** @typedef {import("../domain/trade.js").Trade} Trade */

/**
 * @typedef {Object} TradeStore
 * @property {"desktop"|"local"|"memory"} mode
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
 * @property {"offline"|"rejected"|"unavailable"|"unreadable"|"write_failed"} code
 *   offline: the local server cannot be reached; rejected: it refused the request;
 *   unavailable: it failed (worth retrying); unreadable: the data file cannot be read;
 *   write_failed: the data file could not be written
 * @property {string} message
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `operation`, retrying "unavailable" failures with linear backoff and jitter.
 * Any other error is rethrown at once.
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
      if (attempt >= attempts || error?.code !== "unavailable") throw error;
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
  const { code, message } = /** @type {StoreError} */ (error ?? {});
  switch (code) {
    case "offline":
      return "Serveur local injoignable : relance « npm start », puis réessaie.";
    case "rejected":
      return "Le serveur local a refusé l'enregistrement.";
    case "unreadable":
      return `Impossible d'ouvrir le fichier de données : ${message}`;
    case "write_failed":
      return `Enregistrement impossible : le fichier de données n'a pas pu être écrit (${message}).`;
    default:
      return "Enregistrement impossible pour l'instant. Réessaie dans un moment.";
  }
}

/**
 * Store for the desktop app: keeps the data file itself through `openDataFile`, with
 * no server in between. The app has a single window, so no other writer to follow.
 * If the file cannot be read, subscribers get the error and every write is refused,
 * so an unreadable file is never overwritten.
 * @param {import("./data-file.js").DiskFile} file  see tauri-file.js
 * @returns {TradeStore}
 */
export function createDesktopStore(file) {
  const opened = openDataFile(file);
  opened.catch(() => {}); // reported to subscribers, and by every write
  /** @type {Set<(trades: Trade[], meta: {confirmed: boolean}) => void>} */
  const listeners = new Set();

  /** @param {import("./data-file.js").DataFile} data */
  const tradesOf = (data) => Object.entries(data.trades()).map(([id, doc]) => normalizeTrade(id, doc));

  /** @returns {Promise<import("./data-file.js").DataFile>} */
  async function data() {
    try {
      return await opened;
    } catch (error) {
      throw { code: "unreadable", message: error.message };
    }
  }

  /**
   * @param {(data: import("./data-file.js").DataFile) => Promise<void>} operation
   * @param {{notify: boolean}} options  notify subscribers afterwards (trades changed)
   */
  async function write(operation, { notify }) {
    const file = await data();
    try {
      await operation(file);
    } catch (error) {
      throw { code: "write_failed", message: String(error?.message ?? error) };
    }
    if (notify) listeners.forEach((fn) => fn(tradesOf(file), { confirmed: true }));
  }

  return {
    mode: "desktop",
    subscribe(onTrades, onError) {
      listeners.add(onTrades);
      data().then(
        (file) => listeners.has(onTrades) && onTrades(tradesOf(file), { confirmed: true }),
        (error) => listeners.has(onTrades) && onError(error),
      );
      return () => listeners.delete(onTrades);
    },
    save: (trade) => write((file) => file.putTrade(trade.id, toDocument(trade)), { notify: true }),
    remove: (id) => write((file) => file.deleteTrade(id), { notify: true }),
    async loadPrices() {
      return { ...(await data()).prices() };
    },
    savePrices: (changes) => write((file) => file.mergePrices(changes), { notify: false }),
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
 * Store kept in memory (nothing is saved). Same contract as the other stores.
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
