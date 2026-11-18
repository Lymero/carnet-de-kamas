/**
 * @file Application state: a single object plus change notification.
 *
 * Data flows one way:
 *   store snapshot / user action → actions.js → state.set() → subscribers re-render.
 * Views read state; they never mutate it directly.
 */

/**
 * @typedef {Object} AppState
 * @property {import("./domain/trade.js").Trade[]} trades
 * @property {boolean} loaded             first snapshot received (or no database)
 * @property {"local"|"memory"|null} storage
 * @property {Record<string, number>} prices  last unit price per ingredient id
 * @property {import("./data/catalog.js").ItemCatalog} catalog
 * @property {string} view                one of config.VIEWS
 * @property {{text: string, warn: boolean}} status
 */

/**
 * Creates a tiny observable store.
 * @template {object} S
 * @param {S} initial
 * @returns {{get: () => S, set: (patch: Partial<S>) => void, subscribe: (fn: (state: S, changed: Set<keyof S>) => void) => () => void}}
 */
export function createState(initial) {
  let state = /** @type {S} */ (Object.assign({}, initial));
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const changed = new Set(Object.keys(patch).filter((k) => state[k] !== patch[k]));
      if (!changed.size) return;
      state = Object.assign({}, state, patch);
      listeners.forEach((fn) => fn(state, changed));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
