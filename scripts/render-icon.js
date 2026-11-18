#!/usr/bin/env node
/**
 * @file Renders src-tauri/icons/app-icon.svg to a 1024×1024 PNG with the installed
 * Chrome, then lets the Tauri CLI derive every icon the installers need from it and
 * removes the mobile ones this desktop-only app does not use.
 *
 * Usage: npm run icons
 */

import { execFileSync } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const ICONS = fileURLToPath(new URL("../src-tauri/icons/", import.meta.url));
const SOURCE = join(ICONS, "app-icon.svg");
const PNG = join(ICONS, "app-icon.png");
/** Icons referenced by tauri.conf.json, plus the source files. */
const KEEP = new Set([
  "app-icon.svg",
  "app-icon.png",
  "32x32.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.icns",
  "icon.ico",
  "icon.png",
]);

const svg = await readFile(SOURCE, "utf8");
const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<body style="margin:0">${svg.replace("<svg ", '<svg width="1024" height="1024" ')}</body>`);
  await page.locator("svg").screenshot({ path: PNG, omitBackground: true });
} finally {
  await browser.close();
}

// The CLI's own entry script, run with this Node: no shell involved, on every platform.
const cli = join(dirname(createRequire(import.meta.url).resolve("@tauri-apps/cli/package.json")), "tauri.js");
execFileSync(process.execPath, [cli, "icon", PNG], { stdio: "inherit" });

for (const entry of await readdir(ICONS)) {
  if (!KEEP.has(entry)) await rm(join(ICONS, entry), { recursive: true, force: true });
}
console.log(`Icons written to ${ICONS}`);
