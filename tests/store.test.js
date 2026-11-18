import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore, describeStoreError, withRetry } from "../src/js/data/store.js";

const trade = {
  id: "t1",
  date: "2026-11-18",
  item: "Cape d'Ogivol",
  cat: "craft",
  cost: 2_000_000,
  expected: 2_800_000,
  sold: false,
  soldPrice: null,
  soldDate: null,
  hdvTax: 0,
};
const noWait = { wait: async () => {} };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("memory store saves, emits and removes trades", async () => {
  const store = createMemoryStore();
  const seen = [];
  store.subscribe((trades, meta) => seen.push([trades.length, meta.confirmed]));
  await tick();
  await store.save(trade);
  await store.remove(trade.id);
  assert.deepEqual(seen, [
    [0, true],
    [1, true],
    [0, true],
  ]);
});

test("memory store merges remembered prices", async () => {
  const store = createMemoryStore();
  await store.savePrices({ 1: 10 });
  await store.savePrices({ 2: 20 });
  assert.deepEqual(await store.loadPrices(), { 1: 10, 2: 20 });
});

test("withRetry retries 'unavailable' failures only", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw { code: "unavailable" };
    return "ok";
  };
  assert.equal(await withRetry(flaky, noWait), "ok");
  assert.equal(calls, 3);

  let refusedCalls = 0;
  await assert.rejects(
    withRetry(async () => {
      refusedCalls += 1;
      throw { code: "rejected" };
    }, noWait),
  );
  assert.equal(refusedCalls, 1);
});

test("describeStoreError explains each code in French", () => {
  assert.match(describeStoreError({ code: "offline" }), /npm start/);
  assert.match(describeStoreError({ code: "rejected" }), /refusé/);
  assert.match(describeStoreError(new Error("boom")), /Réessaie/);
});
