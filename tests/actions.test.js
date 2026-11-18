import { test } from "node:test";
import assert from "node:assert/strict";
import { ImportError, createActions } from "../src/js/actions.js";
import { createMemoryStore } from "../src/js/data/store.js";
import { createState } from "../src/js/state.js";

const draft = {
  date: "2026-11-18",
  item: " Cape d'Ogivol ",
  cat: "craft",
  cost: 2_000_000,
  expected: 2_800_000,
  sold: false,
  soldPrice: null,
  soldDate: null,
};

function setup({ canWrite = true, store = createMemoryStore() } = {}) {
  const state = createState({ trades: [], prices: {}, canWrite });
  store.subscribe((trades) => state.set({ trades }));
  return { store, state, actions: createActions({ store, state }) };
}

test("actions add, sell and remove trades through the store", async () => {
  const { state, actions } = setup();
  const { trade, warning } = await actions.addTrade(draft, { 10: 1_000 });
  assert.equal(warning, null);
  assert.equal(trade.item, "Cape d'Ogivol", "name is trimmed");
  assert.equal(state.get().trades.length, 1);
  assert.deepEqual(state.get().prices, { 10: 1_000 });

  await actions.sell(trade, 3_000_000, "2026-11-20");
  assert.equal(state.get().trades[0].soldPrice, 3_000_000);

  await actions.removeTrade(trade.id);
  assert.equal(state.get().trades.length, 0);
});

test("actions reject invalid input and read-only viewers", async () => {
  await assert.rejects(setup().actions.addTrade({ ...draft, cost: NaN }), /Investissement/);
  await assert.rejects(setup({ canWrite: false }).actions.addTrade(draft), /Lecture seule/);
  await assert.rejects(setup({ canWrite: false }).actions.removeTrade("x"), /Lecture seule/);
});

test("a sale dated before the trade is refused", async () => {
  const { actions } = setup();
  const { trade } = await actions.addTrade(draft);
  await assert.rejects(actions.sell(trade, 1, "2026-11-01"), /avant/);
});

test("rememberPrices writes only valid prices that changed", async () => {
  const store = createMemoryStore();
  const written = [];
  const spy = { ...store, savePrices: async (changes) => (written.push(changes), store.savePrices(changes)) };
  const { state, actions } = setup({ store: spy });
  state.set({ prices: { 1: 100 } });

  await actions.rememberPrices({ 1: 100, 2: 200, 3: -5, 4: NaN, 5: 1.5 });
  assert.deepEqual(written, [{ 2: 200 }], "only the new, valid price is sent");
  assert.deepEqual(state.get().prices, { 1: 100, 2: 200 });

  await actions.rememberPrices({ 2: 200 });
  assert.equal(written.length, 1, "nothing changed, nothing written");
});

test("a failed price save never undoes the trade", async () => {
  const store = createMemoryStore();
  const failing = {
    ...store,
    savePrices: async () => {
      throw { code: "unavailable" };
    },
  };
  const { state, actions } = setup({ store: failing });
  const { trade, warning } = await actions.addTrade(draft, { 1: 100 });
  assert.equal(state.get().trades[0].id, trade.id);
  assert.match(warning, /Prix non mémorisés/);
});

test("importDrafts saves in order and reports progress", async () => {
  const { state, actions } = setup();
  const seen = [];
  const n = await actions.importDrafts([draft, { ...draft, cost: 1 }], (done, total) => seen.push(`${done}/${total}`));
  assert.equal(n, 2);
  assert.deepEqual(seen, ["1/2", "2/2"]);
  assert.equal(state.get().trades.length, 2);
});

test("importDrafts stops at the first failure and says how many were saved", async () => {
  const store = createMemoryStore();
  let calls = 0;
  const flaky = {
    ...store,
    save: async (t) => {
      calls += 1;
      if (calls === 2) throw { code: "quota_exceeded" };
      return store.save(t);
    },
  };
  const { state, actions } = setup({ store: flaky });
  const drafts = [draft, { ...draft, cost: 1 }, { ...draft, cost: 2 }];
  const error = await actions.importDrafts(drafts).catch((e) => e);
  assert.ok(error instanceof ImportError);
  assert.equal(error.saved, 1);
  assert.match(error.message, /^1 importées, puis arrêt : Stockage plein/);
  assert.equal(state.get().trades.length, 1);

  // Retrying with the remaining drafts completes the import without duplicates.
  await actions.importDrafts(drafts.slice(error.saved));
  assert.deepEqual(
    state
      .get()
      .trades.map((t) => t.cost)
      .sort((a, b) => a - b),
    [1, 2, 2_000_000],
  );
});
