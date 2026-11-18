import { test } from "node:test";
import assert from "node:assert/strict";
import { createDesktopStore, createMemoryStore, describeStoreError, withRetry } from "../src/js/data/store.js";
import { memoryFile } from "./memory-file.js";

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

test("desktop store loads the data file and writes every change to it", async () => {
  const disk = memoryFile(JSON.stringify({ version: 1, trades: { old: { item: "Kokulte" } }, prices: { 9: 90 } }));
  const store = createDesktopStore(disk.file);
  const seen = [];
  store.subscribe(
    (trades, meta) => seen.push([trades.map((t) => t.id), meta.confirmed]),
    (error) => assert.fail(error.message),
  );
  await tick();
  assert.deepEqual(seen, [[["old"], true]]);
  assert.equal(disk.backups(), 1, "the previous file is backed up on opening");

  await store.save(trade);
  assert.deepEqual(seen.at(-1), [["old", "t1"], true], "subscribers see the save at once");
  const saved = JSON.parse(disk.text()).trades.t1;
  assert.equal(saved.id, undefined, "the id is the key, not a field");
  assert.equal(saved.schemaVersion, 1);

  await store.savePrices({ 1: 10 });
  assert.deepEqual(await store.loadPrices(), { 9: 90, 1: 10 });
  assert.equal(seen.length, 2, "saving prices does not re-render the trades");

  await store.remove("old");
  assert.deepEqual(seen.at(-1), [["t1"], true]);
});

test("desktop store reports an unreadable file and never overwrites it", async () => {
  const disk = memoryFile("{ not json");
  const store = createDesktopStore(disk.file);
  const errors = [];
  store.subscribe(
    () => assert.fail("no trades from an unreadable file"),
    (error) => errors.push(error),
  );
  await tick();
  assert.equal(errors[0].code, "unreadable");
  assert.match(describeStoreError(errors[0]), /^Impossible d'ouvrir le fichier de données : .*pas un JSON valide/);
  await assert.rejects(store.save(trade), (error) => error.code === "unreadable");
  assert.deepEqual(disk.writes, [], "nothing written");
  assert.equal(disk.backups(), 0);
});

test("desktop store explains a failed write and keeps working", async () => {
  const disk = memoryFile();
  const store = createDesktopStore(disk.file);
  disk.failNextWrite();
  const error = await store.save(trade).catch((e) => e);
  assert.equal(error.code, "write_failed");
  assert.match(describeStoreError(error), /n'a pas pu être écrit \(disque plein\)/);
  await store.save(trade);
  assert.ok(JSON.parse(disk.text()).trades.t1, "the next save goes through");
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
