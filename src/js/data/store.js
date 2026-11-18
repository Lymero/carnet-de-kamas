/**
 * @file Persistence. The rest of the app talks to a `TradeStore` and never to
 * the database directly, which keeps storage swappable and testable.
 *
 * Two implementations share one interface:
 * - `createCloudStore(db)`: the artifact's `db` capability (shared, survives
 *   devices and reloads, readable by Claude for imports and fixes);
 * - `createMemoryStore()`: in-memory, used when the page runs without the
 *   capability (local preview, signed out) and in tests.
 *
 * Layout in the database (details in docs/DATA-MODEL.md):
 *   trades/<id>        one document per trade
 *   settings/prices    { p: { "<ingredientId>": unitPrice } }
 */

import { DB_PATHS, RETRY } from "../config.js";
import { normalizeTrade, toDocument } from "../domain/trade.js";

/** @typedef {import("../domain/trade.js").Trade} Trade */

/**
 * @typedef {Object} TradeStore
 * @property {"cloud"|"memory"} mode
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
 * @property {string} code     the platform error code, e.g. "quota_exceeded"
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
 * Store kept in memory. Same contract as the cloud store.
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
