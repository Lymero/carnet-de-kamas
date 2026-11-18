// The server's command line (server/main.js), run as a real process.
// Every run passes --data to a temporary file: never the real data file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, runNode } from "./cli.js";

const MAIN = fileURLToPath(new URL("../server/main.js", import.meta.url));

async function tempDataFile(t) {
  const dir = await mkdtemp(join(tmpdir(), "carnet-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, "carnet.json");
}

test("starts, says where the data is, and saves to that file", async (t) => {
  const data = await tempDataFile(t);
  const port = await freePort();
  const output = await runNode(t, MAIN, ["--port", String(port), "--data", data]).ready;
  assert.match(output, new RegExp(`Carnet de Kamas est lancé : http://localhost:${port}/`));
  assert.match(output, /Données : .*carnet\.json/);

  const put = await fetch(`http://127.0.0.1:${port}/api/trades/t1`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ item: "Kokulte" }),
  });
  assert.equal(put.status, 204);
  assert.equal(JSON.parse(await readFile(data, "utf8")).trades.t1.item, "Kokulte");
});

test("a second launch on the same port says it already runs, and exits cleanly", async (t) => {
  const data = await tempDataFile(t);
  const port = await freePort();
  await runNode(t, MAIN, ["--port", String(port), "--data", data]).ready;
  const second = runNode(t, MAIN, ["--port", String(port), "--data", data]);
  assert.equal(await second.exited, 0);
  assert.match(second.output(), /déjà lancé/);
});

test("an unreadable data file stops it with an explanation, leaving the file alone", async (t) => {
  const data = await tempDataFile(t);
  await writeFile(data, "{ not json");
  const run = runNode(t, MAIN, ["--port", String(await freePort()), "--data", data]);
  assert.equal(await run.exited, 1);
  assert.match(run.output(), /Impossible d'ouvrir le fichier de données : .*pas un JSON valide/);
  assert.equal(await readFile(data, "utf8"), "{ not json");
});

test("a port taken by another program is explained", async (t) => {
  const other = createServer((req, res) => res.end("someone else"));
  await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
  t.after(() => other.close());
  const run = runNode(t, MAIN, ["--port", String(other.address().port), "--data", await tempDataFile(t)]);
  assert.equal(await run.exited, 1);
  assert.match(run.output(), /déjà utilisé par un autre programme/);
});
