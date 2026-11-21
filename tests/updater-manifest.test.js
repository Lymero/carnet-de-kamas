import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, updaterManifest } from "../scripts/updater-manifest.js";

const URL = "https://github.com/Lymero/carnet-de-kamas/releases/download/v3.2.0";
/** The updater artifacts the release workflow uploads, as GitHub names them. */
const ARTIFACTS = [
  "Carnet.de.Kamas_3.2.0_x64-setup.exe",
  "Carnet.de.Kamas_3.2.0_x64_fr-FR.msi",
  "Carnet.de.Kamas_universal.app.tar.gz",
  "Carnet.de.Kamas_3.2.0_amd64.AppImage",
  "Carnet.de.Kamas_3.2.0_amd64.deb",
  "Carnet.de.Kamas-3.2.0-1.x86_64.rpm",
];
const signed = (names) => names.map((name) => ({ name, signature: `sig of ${name}\n` }));
const manifest = (assets) =>
  updaterManifest({ version: "3.2.0", notes: "\n- New\n", pubDate: "2026-11-21T00:00:00Z", downloadUrl: URL, assets });

test("each installer type gets its entry, and each system a default", () => {
  const { version, notes, pub_date, platforms } = manifest(signed(ARTIFACTS));
  assert.deepEqual(
    { version, notes, pub_date },
    { version: "3.2.0", notes: "- New", pub_date: "2026-11-21T00:00:00Z" },
  );
  const urls = Object.fromEntries(Object.entries(platforms).map(([key, { url }]) => [key, url.slice(URL.length + 1)]));
  assert.deepEqual(urls, {
    "windows-x86_64": "Carnet.de.Kamas_3.2.0_x64-setup.exe",
    "windows-x86_64-nsis": "Carnet.de.Kamas_3.2.0_x64-setup.exe",
    "windows-x86_64-msi": "Carnet.de.Kamas_3.2.0_x64_fr-FR.msi",
    "darwin-x86_64": "Carnet.de.Kamas_universal.app.tar.gz",
    "darwin-x86_64-app": "Carnet.de.Kamas_universal.app.tar.gz",
    "darwin-aarch64": "Carnet.de.Kamas_universal.app.tar.gz",
    "darwin-aarch64-app": "Carnet.de.Kamas_universal.app.tar.gz",
    "linux-x86_64": "Carnet.de.Kamas_3.2.0_amd64.AppImage",
    "linux-x86_64-appimage": "Carnet.de.Kamas_3.2.0_amd64.AppImage",
    "linux-x86_64-deb": "Carnet.de.Kamas_3.2.0_amd64.deb",
    "linux-x86_64-rpm": "Carnet.de.Kamas-3.2.0-1.x86_64.rpm",
  });
  assert.equal(platforms["windows-x86_64-msi"].signature, "sig of Carnet.de.Kamas_3.2.0_x64_fr-FR.msi");
});

test("names are escaped in the download URL", () => {
  const { platforms } = manifest(signed(ARTIFACTS.map((name) => name.replace("Carnet.de.Kamas", "Carnet de Kamas"))));
  assert.match(platforms["linux-x86_64-deb"].url, /\/Carnet%20de%20Kamas_3\.2\.0_amd64\.deb$/);
});

test("a macOS app named without an architecture is the universal build", () => {
  const assets = signed(ARTIFACTS.map((name) => name.replace("_universal.app", ".app")));
  const { platforms } = manifest(assets);
  assert.equal(platforms["darwin-aarch64"].url, `${URL}/Carnet.de.Kamas.app.tar.gz`);
  assert.equal(platforms["darwin-x86_64"].url, `${URL}/Carnet.de.Kamas.app.tar.gz`);
});

test("a release missing a system's update is refused", () => {
  assert.throws(
    () => manifest(signed(ARTIFACTS.filter((name) => !name.endsWith(".app.tar.gz")))),
    /no signed update for darwin-x86_64, darwin-aarch64/,
  );
});

test("the command line reads the release's assets and signatures", () => {
  const dir = mkdtempSync(join(tmpdir(), "carnet-manifest-"));
  try {
    // Unsigned assets (the .dmg) and the signatures themselves are not updates.
    const names = [...ARTIFACTS, "Carnet.de.Kamas_3.2.0_universal.dmg", ...ARTIFACTS.map((name) => `${name}.sig`)];
    writeFileSync(join(dir, "assets.json"), JSON.stringify(names));
    for (const name of ARTIFACTS) writeFileSync(join(dir, `${name}.sig`), `sig of ${name}`);
    writeFileSync(join(dir, "notes.md"), "- New\n");
    const feed = JSON.parse(main(["3.2.0", `${URL}/`, join(dir, "assets.json"), dir, join(dir, "notes.md")]));
    assert.equal(feed.version, "3.2.0");
    assert.equal(feed.notes, "- New");
    assert.equal(Object.keys(feed.platforms).length, 11);
    assert.equal(feed.platforms["darwin-aarch64"].url, `${URL}/Carnet.de.Kamas_universal.app.tar.gz`);
    assert.ok(!Number.isNaN(Date.parse(feed.pub_date)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
