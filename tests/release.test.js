// The downloadable folder (scripts/build-release.js): its contents, and that it runs on its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRelease } from "../scripts/build-release.js";
import { freePort, runNode } from "./cli.js";

async function build(t) {
  const outDir = await mkdtemp(join(tmpdir(), "carnet-release-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  return { outDir, ...(await buildRelease({ outDir })) };
}

test("the download holds the app, the server, the launchers and the guide, nothing else", async (t) => {
  const { name, dir } = await build(t);
  const version = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
  assert.equal(name, `carnet-de-kamas-${version}`);
  assert.deepEqual((await readdir(dir)).sort(), [
    "Carnet de Kamas.cmd",
    "Carnet de Kamas.command",
    "LISEZMOI.txt",
    "package.json",
    "server",
    "src",
  ]);
  await access(join(dir, "src", "index.html"));
  await access(join(dir, "src", "data", "dofus-data.json"));
  await access(join(dir, "server", "main.js"));

  const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  assert.equal(pkg.type, "module", "the server is ES modules");
  assert.equal(pkg.version, version);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.dependencies, undefined, "nothing to install");

  const guide = await readFile(join(dir, "LISEZMOI.txt"), "utf8");
  assert.match(guide, new RegExp(`^Carnet de Kamas ${version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(guide, /\{\{/);
  assert.match(await readFile(join(dir, "Carnet de Kamas.cmd"), "utf8"), /node server\\main\.js --open/);
});

test("the download runs from its own folder and keeps data in the user's folder", async (t) => {
  const { dir } = await build(t);
  const home = await mkdtemp(join(tmpdir(), "carnet-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const port = await freePort();
  // A fresh "user": every per-user data location points into a temporary folder.
  const env = { APPDATA: join(home, "AppData"), HOME: home, USERPROFILE: home, XDG_DATA_HOME: join(home, "share") };
  const output = await runNode(t, join(dir, "server", "main.js"), ["--port", String(port)], { env }).ready;

  const dataLine = output.match(/Données : (.*)/)?.[1].trim() ?? "";
  assert.ok(dataLine.startsWith(home), `data under the user's folder, got ${dataLine}`);
  assert.match(dataLine, /carnet\.json$/);
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(await page.text(), /<title>Carnet de Kamas<\/title>/);
  const info = await (await fetch(`http://127.0.0.1:${port}/api/info`)).json();
  assert.equal(info.store, "file");
});
