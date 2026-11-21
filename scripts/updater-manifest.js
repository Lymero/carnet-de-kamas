#!/usr/bin/env node
/**
 * @file Writes the update feed of a release, `latest.json`, which the desktop app reads
 * (`plugins.updater` in src-tauri/tauri.conf.json) to find and install new versions.
 * Run by the release workflow once every installer is uploaded:
 *
 *   node scripts/updater-manifest.js <version> <download-url> <assets.json> <sig-dir> <notes.md>
 *
 * `assets.json` lists the release's asset names; `sig-dir` holds the signature files
 * (`<asset>.sig`) the build made for the installers that can update the app; the
 * download URL is where the assets will be once the release is published. The feed goes
 * to stdout.
 *
 * Each installer type gets its own entry (`windows-x86_64-msi`, `linux-x86_64-deb`…), so
 * the app updates itself with the same kind of installer it was installed with. The plain
 * `{os}-{arch}` entries, for anything else, point to the default installers: NSIS on
 * Windows, the AppImage on Linux.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Updater artifacts, by file ending: the installer type and whether it is its system's default. */
const KINDS = [
  { ending: ".app.tar.gz", os: "darwin", installer: "app", main: true },
  { ending: "-setup.exe", os: "windows", installer: "nsis", main: true },
  { ending: ".msi", os: "windows", installer: "msi", main: false },
  { ending: ".AppImage", os: "linux", installer: "appimage", main: true },
  { ending: ".deb", os: "linux", installer: "deb", main: false },
  { ending: ".rpm", os: "linux", installer: "rpm", main: false },
];

/** The entries the app needs on every system it is released for. */
export const REQUIRED_PLATFORMS = ["windows-x86_64", "darwin-x86_64", "darwin-aarch64", "linux-x86_64"];

/**
 * The architectures an asset's name says it is built for. The macOS app is released as
 * one universal build, so a macOS name without an architecture serves both.
 * @param {string} name
 * @param {string} os
 * @returns {string[]}
 */
function architectures(name, os) {
  if (/universal/i.test(name)) return ["x86_64", "aarch64"];
  if (/aarch64|arm64/i.test(name)) return ["aarch64"];
  if (/x86_64|x64|amd64/i.test(name)) return ["x86_64"];
  return os === "darwin" ? ["x86_64", "aarch64"] : [];
}

/**
 * @param {{version: string, notes: string, pubDate: string, downloadUrl: string,
 *   assets: {name: string, signature: string}[]}} release
 *   `assets`: the signed updater artifacts, with their signature's text
 * @returns {{version: string, notes: string, pub_date: string,
 *   platforms: Record<string, {url: string, signature: string}>}}
 */
export function updaterManifest({ version, notes, pubDate, downloadUrl, assets }) {
  /** @type {Record<string, {url: string, signature: string}>} */
  const platforms = {};
  for (const { name, signature } of assets) {
    const kind = KINDS.find(({ ending }) => name.endsWith(ending));
    if (!kind) continue;
    const entry = { url: `${downloadUrl.replace(/\/$/, "")}/${encodeURIComponent(name)}`, signature: signature.trim() };
    for (const arch of architectures(name, kind.os)) {
      platforms[`${kind.os}-${arch}-${kind.installer}`] = entry;
      if (kind.main) platforms[`${kind.os}-${arch}`] = entry;
    }
  }
  const missing = REQUIRED_PLATFORMS.filter((platform) => !platforms[platform]);
  if (missing.length) throw new Error(`no signed update for ${missing.join(", ")}`);
  return { version, notes: notes.trim(), pub_date: pubDate, platforms };
}

/**
 * @param {string[]} args  see the file's comment
 * @returns {string} the feed's JSON
 */
export function main([version, downloadUrl, assetsFile, sigDir, notesFile]) {
  /** @type {string[]} */
  const names = JSON.parse(readFileSync(assetsFile, "utf8"));
  const signed = names.filter((name) => names.includes(`${name}.sig`));
  const assets = signed.map((name) => ({ name, signature: readFileSync(join(sigDir, `${name}.sig`), "utf8") }));
  const notes = readFileSync(notesFile, "utf8");
  const manifest = updaterManifest({ version, notes, pubDate: new Date().toISOString(), downloadUrl, assets });
  return JSON.stringify(manifest, null, 2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.length !== 7) {
    console.error("usage: updater-manifest.js <version> <download-url> <assets.json> <sig-dir> <notes.md>");
    process.exit(2);
  }
  console.log(main(process.argv.slice(2)));
}
