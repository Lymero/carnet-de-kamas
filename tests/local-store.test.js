// The browser's local store (src/js/data/store.js) against the real local server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalStore, describeStoreError } from "../src/js/data/store.js";
import { createApp } from "../server/app.js";
import { openFileStore } from "../server/file-store.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const trade = {
  id: "t1",
  date: "2026-01-10",
  item: "Kokulte",
  cat: "resale",
  cost: 1000,
  expected: 2000,
  sold: false,
  soldPrice: null,
  soldDate: null,
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Stand-in for the browser's EventSource (Node has none by default). */
class FakeEventSource {
  static last = null;
  constructor(url) {
    this.url = url;
    this.handlers = {};
    FakeEventSource.last = this;
  }
  addEventListener(type, handler) {
    (this.handlers[type] ??= []).push(handler);
  }
  dispatch(type, data) {
    this.handlers[type]?.forEach((handler) => handler({ data }));
  }
  close() {
    this.closed = true;
  }
}

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "carnet-test-"));
  const file = join(dir, "carnet.json");
  const server = createApp({ root: SRC, store: await openFileStore(file) });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.close();
    server.closeAllConnections();
    await rm(dir, { recursive: true, force: true });
  });
  let requests = 0;
  const store = createLocalStore({
    baseUrl: `http://127.0.0.1:${server.address().port}/api/`,
    fetchImpl: (input, init) => {
      requests += 1;
      return fetch(input, init);
    },
    EventSourceImpl: /** @type {any} */ (FakeEventSource),
    clientId: "this-tab",
    wait: async () => {},
  });
  return { store, file, requests: () => requests };
}

test("local store: loads on connection, saves to the file, and shows its own writes at once", async (t) => {
  const { store, file } = await setup(t);
  const seen = [];
  const stop = store.subscribe(
    (trades, meta) => seen.push([trades.map((x) => x.id), meta.confirmed]),
    (error) => assert.fail(error.message),
  );
  const events = FakeEventSource.last;
  assert.match(events.url, /\/api\/events$/);
  events.onopen();
  await tick();
  assert.deepEqual(seen, [[[], true]]);

  await store.save(trade);
  assert.deepEqual(seen.at(-1), [["t1"], true], "listeners updated before save resolves");
  const body = JSON.parse(await readFile(file, "utf8")).trades.t1;
  assert.equal(body.id, undefined, "the id is the key, not a field");
  assert.equal(body.schemaVersion, 1);

  await store.remove("t1");
  assert.deepEqual(seen.at(-1), [[], true]);
  stop();
  assert.equal(events.closed, true);
});

test("local store: reloads on other tabs' changes only", async (t) => {
  const { store, requests } = await setup(t);
  let calls = 0;
  store.subscribe(
    () => (calls += 1),
    () => {},
  );
  const events = FakeEventSource.last;
  events.onopen();
  await tick();
  const before = requests();
  events.dispatch("change", "this-tab");
  await tick();
  assert.equal(requests(), before, "our own write is not reloaded twice");
  events.dispatch("change", "another-tab");
  await tick();
  assert.equal(requests(), before + 1);
  assert.equal(calls, 2);
});

test("local store: remembered prices are merged", async (t) => {
  const { store } = await setup(t);
  await store.savePrices({ 10: 100 });
  await store.savePrices({ 20: 200 });
  assert.deepEqual(await store.loadPrices(), { 10: 100, 20: 200 });
});

test("local store: a lost connection or a stopped server is explained", async (t) => {
  const { store } = await setup(t);
  const errors = [];
  store.subscribe(
    () => {},
    (error) => errors.push(error.code),
  );
  FakeEventSource.last.onerror();
  assert.deepEqual(errors, ["offline"]);

  const stopped = createLocalStore({
    baseUrl: "http://127.0.0.1:9/api/", // nothing listens on the discard port
    EventSourceImpl: /** @type {any} */ (FakeEventSource),
    clientId: "x",
  });
  const error = await stopped.save(trade).catch((e) => e);
  assert.equal(error.code, "offline");
  assert.match(describeStoreError(error), /npm start/);
  assert.match(describeStoreError({ code: "rejected" }), /refusé/);
});

test("local store: a refused request is not retried and says so", async (t) => {
  const { store } = await setup(t);
  const error = await store.save({ ...trade, id: "bad id" }).catch((e) => e);
  assert.equal(error.code, "rejected");
});
