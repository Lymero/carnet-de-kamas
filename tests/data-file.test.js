// The data file's rules (src/js/data/data-file.js), on an in-memory disk.
// The real disk is covered by server.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { backupPath, openDataFile } from "../src/js/data/data-file.js";
import { memoryFile } from "./memory-file.js";

const doc = { date: "2026-01-10", item: "Kokulte", cat: "resale", cost: 1000, expected: 2000, sold: false };

test("a missing file is an empty notebook, written in full on the first change", async () => {
  const disk = memoryFile(null);
  const data = await openDataFile(disk.file);
  assert.deepEqual(data.trades(), {});
  assert.equal(disk.backups(), 0, "nothing to back up");
  await data.putTrade("t1", doc);
  assert.deepEqual(JSON.parse(disk.text()), { version: 1, trades: { t1: doc }, prices: {} });
  assert.match(disk.text(), /\n {2}"trades": \{\n/, "pretty-printed for people to read");
});

test("an existing file is read and backed up first", async () => {
  const disk = memoryFile(JSON.stringify({ version: 1, trades: { t1: doc }, prices: { 10: 100 } }));
  const data = await openDataFile(disk.file);
  assert.deepEqual(data.trades(), { t1: doc });
  assert.deepEqual(data.prices(), { 10: 100 });
  assert.equal(disk.backups(), 1);
  assert.equal((await openDataFile(disk.file, { backup: false })).path, disk.file.path);
  assert.equal(disk.backups(), 1, "backup can be turned off");
});

test("changes are written one at a time, none lost; no-ops write nothing", async () => {
  const disk = memoryFile();
  const data = await openDataFile(disk.file);
  await Promise.all(Array.from({ length: 20 }, (_, i) => data.putTrade(`t${i}`, { ...doc, cost: i })));
  await data.mergePrices({ 10: 100 });
  await data.mergePrices({ 20: 200 });
  await data.deleteTrade("t0");
  const writes = disk.writes.length;
  await data.deleteTrade("missing");
  assert.equal(disk.writes.length, writes, "deleting a missing trade writes nothing");
  const saved = JSON.parse(disk.text());
  assert.equal(Object.keys(saved.trades).length, 19);
  assert.deepEqual(saved.prices, { 10: 100, 20: 200 });
});

test("a failed write changes nothing in memory, and later writes still work", async () => {
  const disk = memoryFile();
  const data = await openDataFile(disk.file);
  disk.failNextWrite();
  await assert.rejects(data.putTrade("t1", doc), /disque plein/);
  assert.deepEqual(data.trades(), {});
  await data.putTrade("t2", doc);
  await data.flush();
  assert.deepEqual(Object.keys(data.trades()), ["t2"]);
});

test("an unreadable file is refused with a French explanation", async () => {
  for (const [text, message] of [
    ["{ not json", /n'est pas un JSON valide.*pas été modifié.*carnet\.backup\.json/],
    [JSON.stringify([1, 2]), /ne ressemble pas à un fichier de Carnet de Kamas/],
    [JSON.stringify({ version: 99, trades: {}, prices: {} }), /version plus récente/],
  ]) {
    const disk = memoryFile(text);
    await assert.rejects(openDataFile(disk.file), message);
    assert.equal(disk.backups(), 0, "an unreadable file is not backed up over the good backup");
  }
});

test("backupPath puts the backup next to the file", () => {
  assert.equal(backupPath("/x/carnet.json"), "/x/carnet.backup.json");
  assert.equal(backupPath("C:\\x\\Carnet.JSON"), "C:\\x\\Carnet.backup.json");
  assert.equal(backupPath("/x/carnet"), "/x/carnet.backup.json");
  assert.equal(backupPath("/x/notes.txt"), "/x/notes.txt.backup.json");
});
