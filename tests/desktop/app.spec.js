// The real desktop app, built with `npm run build:desktop`, driven through WebView2's
// DevTools protocol (Windows only). Run with `npm run test:desktop`.
// The app runs on a temporary data file ($CARNET_DATA), never on the real one.
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "@playwright/test";

const EXE =
  process.env.CARNET_DESKTOP_EXE ??
  fileURLToPath(new URL("../../src-tauri/target/release/carnet-de-kamas.exe", import.meta.url));
const DEVTOOLS_PORT = 9339;
/** Where Tauri serves the app on Windows. */
const APP_URL = "http://tauri.localhost/";

test.describe.configure({ mode: "serial" });
test.skip(process.platform !== "win32", "WebView2's DevTools protocol is only available on Windows");

/** @type {import("node:child_process").ChildProcess} */ let app;
/** @type {import("@playwright/test").Browser} */ let browser;
/** @type {import("@playwright/test").Page} */ let page;
let dir = "";
let dataFile = "";

const stored = {
  version: 1,
  trades: {
    s001: { date: "2026-01-10", item: "Kokulte", cat: "resale", cost: 1000, expected: 2000, sold: false },
  },
  prices: {},
};

test.beforeAll(async () => {
  await access(EXE).catch(() => {
    throw new Error(`${EXE} not found: run "npm run build:desktop" first`);
  });
  dir = await mkdtemp(join(tmpdir(), "carnet-desktop-"));
  dataFile = join(dir, "carnet.json");
  await writeFile(dataFile, JSON.stringify(stored));
  app = spawn(EXE, [], {
    env: {
      ...process.env,
      CARNET_DATA: dataFile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEVTOOLS_PORT}`,
    },
    stdio: "ignore",
  });
  let exited = null;
  app.on("exit", (code, signal) => (exited = { code, signal }));
  // The window starts on about:blank, then loads the app. Connect only once the app's page
  // exists: a page attached before that navigation is not usable afterwards. A first start
  // on a fresh machine (WebView2 setting up its profile) can take a while.
  const devtools = `http://127.0.0.1:${DEVTOOLS_PORT}`;
  await expect(async () => {
    if (exited) throw new Error(`the app exited before showing its page: ${JSON.stringify(exited)}`);
    const targets = await (await fetch(`${devtools}/json/list`)).json();
    expect(targets.some((target) => target.type === "page" && target.url.startsWith(APP_URL))).toBe(true);
  }).toPass({ timeout: 60_000 });
  browser = await chromium.connectOverCDP(devtools);
  page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().startsWith(APP_URL));
});

test.afterAll(async () => {
  await browser?.close();
  app?.kill();
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test("opens on the data file, says where it is, and backs it up", async () => {
  await expect(page.locator("#status")).toHaveText("1 opération · enregistré sur ce PC");
  await expect(page.locator("#status")).toHaveAttribute("title", `Fichier de données : ${dataFile}`);
  await expect(page.locator(".open-row")).toContainText("Kokulte");
  await access(join(dir, "carnet.backup.json"));
});

test("saves a new trade to the data file", async () => {
  await page.fill("#f-item", "Gelano");
  await page.keyboard.press("Escape");
  await page.click('#f-cat button[data-v="resale"]');
  await page.fill("#f-cost", "100k + 20k");
  await page.fill("#f-exp", "200k");
  await page.selectOption("#f-tax", "2");
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText("Gelano ajouté");
  await expect(page.locator("#status")).toHaveText("2 opérations · enregistré sur ce PC");

  const saved = JSON.parse(await readFile(dataFile, "utf8"));
  const gelano = Object.values(saved.trades).find((doc) => doc.item === "Gelano");
  expect(gelano).toMatchObject({ cost: 120000, expected: 200000, hdvTax: 2, schemaVersion: 1 });
  expect(saved.trades.s001.item).toBe("Kokulte");
});

test("uses the fonts shipped with the app", async () => {
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    ["400 16px Barlow", "600 16px Barlow", "600 16px 'Barlow Condensed'"].every((font) => document.fonts.check(font)),
  );
  expect(loaded).toBe(true);
});

test("starts without any console message (nothing blocked by the security policy)", async () => {
  const messages = [];
  page.on("console", (message) => messages.push(`${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => messages.push(`page error: ${error.message}`));
  await page.reload();
  await expect(page.locator("#status")).toHaveText(/enregistré sur ce PC$/);
  await page.evaluate(() => document.fonts.ready);
  expect(messages).toEqual([]);
});
