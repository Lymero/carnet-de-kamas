import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server/app.js";
import { backupPath, openFileStore } from "../server/file-store.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const doc = { date: "2026-01-10", item: "Kokulte", cat: "resale", cost: 1000, expected: 2000, sold: false };

async function tempFile(t) {
  const dir = await mkdtemp(join(tmpdir(), "carnet-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "carnet.json");
}

/** Starts the app on a free port; closed after the test. */
async function startApp(t, store) {
  const server = createApp({ root: SRC, store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.close();
    server.closeAllConnections();
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const json = (body) => ({ method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** Raw request, for headers fetch would not let us set (Host). */
function rawRequest(url, headers) {
  return new Promise((resolve, reject) => {
    httpRequest(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    })
      .on("error", reject)
      .end();
  });
}

// ---------------------------------------------------------------- file store

test("file store: a missing file is an empty notebook, created on first write", async (t) => {
  const file = await tempFile(t);
  const store = await openFileStore(file);
  assert.deepEqual(store.trades(), {});
  assert.deepEqual(store.prices(), {});
  await store.putTrade("t1", doc);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved, { version: 1, trades: { t1: doc }, prices: {} });
});

test("file store: data survives reopening, and reopening makes a backup", async (t) => {
  const file = await tempFile(t);
  const first = await openFileStore(file);
  await first.putTrade("t1", doc);
  await first.mergePrices({ 10: 100 });
  await first.mergePrices({ 20: 200 });

  const second = await openFileStore(file);
  assert.deepEqual(second.trades(), { t1: doc });
  assert.deepEqual(second.prices(), { 10: 100, 20: 200 });
  assert.equal(await readFile(backupPath(file), "utf8"), await readFile(file, "utf8"));
  assert.equal(backupPath("/x/carnet.json"), "/x/carnet.backup.json");
});

test("file store: concurrent writes are applied one after the other, none lost", async (t) => {
  const file = await tempFile(t);
  const store = await openFileStore(file);
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.putTrade(`t${i}`, { ...doc, cost: i })));
  await store.deleteTrade("t0");
  await store.deleteTrade("missing"); // no-op
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(Object.keys(saved.trades).length, 24);
  assert.equal(saved.trades.t24.cost, 24);
});

test("file store: an unreadable file is refused and left untouched", async (t) => {
  const file = await tempFile(t);
  await writeFile(file, "{ not json");
  await assert.rejects(openFileStore(file), /not valid JSON.*left untouched/);
  assert.equal(await readFile(file, "utf8"), "{ not json");

  await writeFile(file, JSON.stringify([1, 2]));
  await assert.rejects(openFileStore(file), /does not look like/);

  await writeFile(file, JSON.stringify({ version: 99, trades: {}, prices: {} }));
  await assert.rejects(openFileStore(file), /newer version/);
});

test("file store: a failed write rejects and changes nothing in memory", async (t) => {
  const file = await tempFile(t);
  const store = await openFileStore(file);
  // A directory now stands where the file goes: the final rename fails on every OS.
  await mkdir(file);
  await assert.rejects(store.putTrade("t1", doc));
  assert.deepEqual(store.trades(), {});
  await assert.rejects(store.putTrade("t2", doc), "the queue keeps working after a failure");
});

// ---------------------------------------------------------------- HTTP API

test("API: trades can be created, read and deleted", async (t) => {
  const file = await tempFile(t);
  const base = await startApp(t, await openFileStore(file));

  assert.deepEqual(await (await fetch(`${base}/api/info`)).json(), { app: "carnet-de-kamas", store: "file" });
  assert.equal((await fetch(`${base}/api/trades/t1`, json(doc))).status, 204);
  assert.deepEqual(await (await fetch(`${base}/api/trades`)).json(), { trades: { t1: doc } });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).trades, { t1: doc });

  assert.equal((await fetch(`${base}/api/trades/t1`, { method: "DELETE" })).status, 204);
  assert.deepEqual(await (await fetch(`${base}/api/trades`)).json(), { trades: {} });
});

test("API: remembered prices are merged and validated", async (t) => {
  const base = await startApp(t, await openFileStore(await tempFile(t)));
  const patch = (p) => fetch(`${base}/api/prices`, { ...json({ p }), method: "PATCH" });
  assert.equal((await patch({ 10: 100 })).status, 204);
  assert.equal((await patch({ 20: 200 })).status, 204);
  assert.deepEqual(await (await fetch(`${base}/api/prices`)).json(), { p: { 10: 100, 20: 200 } });
  for (const bad of [{ 10: -1 }, { 10: 1.5 }, { 10: "100" }, { abc: 1 }]) {
    assert.equal((await patch(bad)).status, 400, JSON.stringify(bad));
  }
});

test("API: malformed requests are refused", async (t) => {
  const base = await startApp(t, await openFileStore(await tempFile(t)));
  assert.equal((await fetch(`${base}/api/trades/bad%20id`, json(doc))).status, 400);
  assert.equal((await fetch(`${base}/api/trades/t1`, json([doc]))).status, 400);
  assert.equal((await fetch(`${base}/api/trades/t1`, { ...json(doc), body: "{ nope" })).status, 400);
  const asText = { method: "PUT", headers: { "content-type": "text/plain" }, body: JSON.stringify(doc) };
  assert.equal((await fetch(`${base}/api/trades/t1`, asText)).status, 415);
  const huge = { ...doc, item: "x".repeat(1024 * 1024) };
  assert.equal((await fetch(`${base}/api/trades/t1`, json(huge))).status, 413);
  assert.equal((await fetch(`${base}/api/trades`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/api/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/trades/t1/x`)).status, 404);
});

test("API: other sites and other host names are refused", async (t) => {
  const base = await startApp(t, await openFileStore(await tempFile(t)));
  const fromEvil = await fetch(`${base}/api/trades`, { headers: { origin: "https://evil.example" } });
  assert.equal(fromEvil.status, 403, "cross-origin read");
  const evilWrite = await fetch(`${base}/api/trades/t1`, {
    ...json(doc),
    headers: { ...json(doc).headers, origin: "http://evil.example" },
  });
  assert.equal(evilWrite.status, 403, "cross-origin write");
  const fromSelf = await fetch(`${base}/api/trades`, { headers: { origin: base } });
  assert.equal(fromSelf.status, 200, "same origin");
  assert.equal(await rawRequest(`${base}/api/trades`, { host: "attacker.example:80" }), 403, "DNS rebinding");
});

test("API: writes are announced on the event stream with the writer's id", async (t) => {
  const base = await startApp(t, await openFileStore(await tempFile(t)));
  const received = new Promise((resolve, reject) => {
    httpRequest(`${base}/api/events`, (res) => {
      assert.equal(res.headers["content-type"], "text/event-stream");
      let text = "";
      res.on("data", (chunk) => {
        text += chunk;
        if (text.includes("event: change")) {
          res.destroy();
          resolve(text);
        }
      });
      // Write once the stream is open.
      fetch(`${base}/api/trades/t1`, { ...json(doc), headers: { ...json(doc).headers, "x-client-id": "tab-1" } });
    })
      .on("error", reject)
      .end();
  });
  assert.match(await received, /event: change\ndata: tab-1\n\n/);
});

// ---------------------------------------------------------------- static files

test("static files are served from src/ only", async (t) => {
  const base = await startApp(t, null); // static mode: no API
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /text\/html/);
  assert.match(await page.text(), /<title>Carnet de Kamas<\/title>/);
  assert.match((await fetch(`${base}/js/main.js`)).headers.get("content-type"), /javascript/);
  assert.equal((await fetch(`${base}/api/info`)).status, 404, "no API in static mode");
  assert.equal((await fetch(`${base}/%2e%2e%2fpackage.json`)).status, 403, "encoded ../ escapes src/");
  // A backslash separates paths on Windows only (403 there); elsewhere it stays inside src/ (404).
  assert.notEqual((await fetch(`${base}/..%5cpackage.json`)).status, 200);
  assert.equal(await rawRequest(`${base}/../package.json`, {}), 404, "resolved inside src/");
  assert.equal((await fetch(`${base}/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${base}/`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${base}/`, { method: "HEAD" })).status, 200);
});
