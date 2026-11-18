import { test } from "node:test";
import assert from "node:assert/strict";
import { RETRY } from "../src/js/config.js";
import { createCloudStore, createMemoryStore, describeStoreError, withRetry } from "../src/js/data/store.js";

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
};
const noWait = { wait: async () => {} };
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Recursive merge with the semantics of the platform's `update`: objects merge, anything else replaces. */
function merge(target, patch) {
  const out = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(out[k] ?? {}, v) : v;
  }
  return out;
}

/** In-memory stand-in for the artifact `db` capability (only what the store uses). */
function fakeDb() {
  const docs = new Map();
  const calls = [];
  const listeners = [];
  const docRef = (path) => ({
    id: path.split("/").pop(),
    async get() {
      return { exists: docs.has(path), data: () => structuredClone(docs.get(path)) };
    },
    async set(data) {
      calls.push(["set", path, data]);
      docs.set(path, structuredClone(data));
    },
    async update(data) {
      calls.push(["update", path, data]);
      if (!docs.has(path)) throw { code: "invalid_argument" };
      docs.set(path, merge(docs.get(path), data));
    },
    async delete() {
      calls.push(["delete", path]);
      docs.delete(path);
    },
  });
  return {
    docs,
    calls,
    listeners,
    doc: docRef,
    collection: (name) => ({
      doc: (id) => docRef(`${name}/${id}`),
      onSnapshot(next, error) {
        const listener = { next, error, active: true };
        listeners.push(listener);
        return () => {
          listener.active = false;
        };
      },
    }),
  };
}

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

test("cloud store writes documents and delivers normalised snapshots", async () => {
  const db = fakeDb();
  const store = createCloudStore(db, noWait);
  const seen = [];
  store.subscribe(
    (trades, meta) => seen.push({ trades, meta }),
    () => assert.fail("no error expected"),
  );

  await store.save(trade);
  const [verb, path, body] = db.calls[0];
  assert.equal(verb, "set");
  assert.equal(path, "trades/t1");
  assert.equal(body.id, undefined, "the id is the document path, not a field");
  assert.equal(body.schemaVersion, 1);

  db.listeners[0].next({
    docs: [{ id: "t1", data: () => ({ ...body, date: "garbage" }) }],
    metadata: { fromCache: true },
  });
  assert.equal(seen[0].trades[0].id, "t1");
  assert.equal(seen[0].trades[0].date, "1970-01-01", "documents are normalised on read");
  assert.equal(seen[0].meta.confirmed, false, "a cached view is not confirmed");

  await store.remove("t1");
  assert.deepEqual(db.calls.at(-1), ["delete", "trades/t1"]);
});

test("cloud store merges prices instead of replacing them", async () => {
  const db = fakeDb();
  const store = createCloudStore(db, noWait);

  await store.savePrices({ 1: 10 });
  assert.deepEqual(db.calls.at(-1), ["set", "settings/prices", { p: { 1: 10 } }], "first save creates the document");

  await store.savePrices({ 2: 20 });
  assert.equal(db.calls.at(-1)[0], "update");
  assert.deepEqual(db.docs.get("settings/prices"), { p: { 1: 10, 2: 20 } });
});

test("cloud store saving prices before loading them keeps the stored ones", async () => {
  const db = fakeDb();
  db.docs.set("settings/prices", { p: { 1: 10, 3: 30 } });
  const store = createCloudStore(db, noWait);
  await store.savePrices({ 2: 20 }); // loadPrices has not run yet
  assert.deepEqual(db.docs.get("settings/prices"), { p: { 1: 10, 2: 20, 3: 30 } });
  assert.deepEqual(await store.loadPrices(), { 1: 10, 2: 20, 3: 30 });
});

test("cloud store resubscribes when the host drops the listener with 'unavailable'", async () => {
  const db = fakeDb();
  const errors = [];
  const stop = createCloudStore(db, noWait).subscribe(
    () => {},
    (e) => errors.push(e.code),
  );

  db.listeners[0].error({ code: "unavailable" });
  await tick();
  assert.equal(db.listeners.length, 2, "a fresh listener replaces the dead one");
  assert.deepEqual(errors, []);

  db.listeners[1].error({ code: "revoked" });
  await tick();
  assert.deepEqual(errors, ["revoked"], "other errors are terminal and reported");
  assert.equal(db.listeners.length, 2);

  stop();
  assert.equal(db.listeners[1].active, false);
});

test("cloud store gives up resubscribing after the retry budget", async () => {
  const db = fakeDb();
  const errors = [];
  createCloudStore(db, noWait).subscribe(
    () => {},
    (e) => errors.push(e.code),
  );
  for (let i = 0; i < RETRY.ATTEMPTS; i += 1) {
    db.listeners.at(-1).error({ code: "unavailable" });
    await tick();
  }
  assert.equal(db.listeners.length, RETRY.ATTEMPTS);
  assert.deepEqual(errors, ["unavailable"]);
});

test("withRetry retries transient errors only", async () => {
  let calls = 0;
  const flaky = async () => {
    calls += 1;
    if (calls < 3) throw { code: "unavailable" };
    return "ok";
  };
  assert.equal(await withRetry(flaky, noWait), "ok");
  assert.equal(calls, 3);

  let quotaCalls = 0;
  await assert.rejects(
    withRetry(async () => {
      quotaCalls += 1;
      throw { code: "quota_exceeded" };
    }, noWait),
  );
  assert.equal(quotaCalls, 1);
});

test("describeStoreError explains known codes in French", () => {
  assert.match(describeStoreError({ code: "quota_exceeded" }), /Stockage plein/);
  assert.match(describeStoreError({ code: "invalid_argument" }), /droit/);
  assert.match(describeStoreError(new Error("boom")), /Réessaie/);
});
