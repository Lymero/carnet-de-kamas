/**
 * @file Every change the user can make goes through here.
 *
 * Actions validate input, write through the store, and let the store's
 * snapshot update the state (single source of truth: the database).
 * They throw `ActionError` with a French, user-facing message on failure,
 * so the UI only has to display `error.message`.
 */

import { describeStoreError } from "./data/store.js";
import { isKamas } from "./domain/kamas.js";
import { markSold, newTradeId, validateTrade } from "./domain/trade.js";

/** @typedef {import("./domain/trade.js").Trade} Trade */
/** @typedef {Omit<Trade, "id">} TradeDraft */

/** Error whose message can be shown to the user as is. */
export class ActionError extends Error {
  /** @param {string} message @param {unknown} [cause] */
  constructor(message, cause) {
    super(message);
    this.name = "ActionError";
    this.cause = cause;
  }
}

/** An import that stopped part-way. The first `saved` drafts were written. */
export class ImportError extends ActionError {
  /** @param {string} message @param {number} saved @param {unknown} [cause] */
  constructor(message, saved, cause) {
    super(message, cause);
    this.name = "ImportError";
    this.saved = saved;
  }
}

/**
 * @param {{store: import("./data/store.js").TradeStore, state: ReturnType<typeof import("./state.js").createState>}} deps
 */
export function createActions({ store, state }) {
  function guardWrite() {
    if (!state.get().canWrite) throw new ActionError("Lecture seule : seul le propriétaire peut modifier ce carnet.");
  }

  /** Validates then saves; wraps storage errors. @param {Trade} trade */
  async function persist(trade) {
    guardWrite();
    const errors = validateTrade(trade);
    if (errors.length) throw new ActionError(errors[0]);
    try {
      await store.save(trade);
    } catch (error) {
      throw new ActionError(describeStoreError(error), error);
    }
    return trade;
  }

  /**
   * Merges new unit prices into the remembered list, writing only the prices that
   * changed. Shown at once; the store merges them, so prices not loaded yet are kept.
   * @param {Record<string, number>} changes  ingredient id → unit price
   */
  async function rememberPrices(changes) {
    const current = state.get().prices;
    const updates = Object.fromEntries(
      Object.entries(changes).filter(([id, price]) => isKamas(price) && current[id] !== price),
    );
    if (!Object.keys(updates).length || !state.get().canWrite) return;
    state.set({ prices: { ...current, ...updates } });
    try {
      await store.savePrices(updates);
    } catch (error) {
      throw new ActionError(`Prix non mémorisés : ${describeStoreError(error)}`, error);
    }
  }

  /**
   * Records a new trade. Unit prices typed in the recipe helper are remembered;
   * that part is a convenience, so its failure never undoes the trade.
   * @param {TradeDraft} draft
   * @param {Record<string, number>} [unitPrices]
   * @returns {Promise<{trade: Trade, warning: string|null}>}
   */
  async function addTrade(draft, unitPrices = {}) {
    const trade = await persist({ ...draft, item: String(draft.item ?? "").trim(), id: newTradeId() });
    try {
      await rememberPrices(unitPrices);
      return { trade, warning: null };
    } catch (error) {
      return { trade, warning: error.message };
    }
  }

  /** @param {string} id */
  async function removeTrade(id) {
    guardWrite();
    try {
      await store.remove(id);
    } catch (error) {
      throw new ActionError(describeStoreError(error), error);
    }
  }

  /**
   * Saves imported rows one at a time: the store allows one write per document at a
   * time, and sequential writes stay under the per-viewer rate limit.
   * Stops at the first failure with an `ImportError` saying how many were saved,
   * so a retry can resume with `drafts.slice(error.saved)`.
   * @param {TradeDraft[]} drafts
   * @param {(done: number, total: number) => void} [onProgress]
   * @returns {Promise<number>} number saved
   */
  async function importDrafts(drafts, onProgress = () => {}) {
    let done = 0;
    for (const draft of drafts) {
      try {
        await persist({ ...draft, id: newTradeId() });
      } catch (error) {
        throw new ImportError(`${done} importées, puis arrêt : ${error.message}`, done, error);
      }
      done += 1;
      onProgress(done, drafts.length);
    }
    return done;
  }

  return {
    addTrade,
    /** Replaces a trade after editing. @param {Trade} trade */
    updateTrade: (trade) => persist(trade),
    /**
     * Marks an open trade as sold, optionally with another tax rate (a price updated at the HDV pays less).
     * @param {Trade} trade @param {number} price @param {string} dateIso @param {number} [hdvTax]
     */
    sell: (trade, price, dateIso, hdvTax = trade.hdvTax) => persist(markSold({ ...trade, hdvTax }, price, dateIso)),
    removeTrade,
    importDrafts,
    rememberPrices,
  };
}
