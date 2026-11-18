/**
 * @file Shared helpers for the end-to-end tests.
 *
 * - `test`: Playwright's test, whose `page` fails the test on any page error,
 *   console error or failed request, so silent breakage cannot pass.
 * - `openApp`: loads the page and waits until it has started.
 * - `installFakeDb`: stands in for the claude.ai `db` and `user` capabilities, so the
 *   cloud code path (and read-only mode) can be tested outside claude.ai.
 */

import { test as base, expect } from "@playwright/test";

export { expect };

export const test = base.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console error: ${message.text()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) problems.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await use(page);
    expect(problems, "the page reported errors").toEqual([]);
  },
});

/**
 * Opens the app and waits for start-up (and, by default, the item catalog).
 * @param {import("@playwright/test").Page} page
 * @param {{catalog?: boolean}} [options]
 */
export async function openApp(page, { catalog = true } = {}) {
  const catalogLoaded = catalog ? page.waitForResponse(/dofus-data\.json$/) : null;
  await page.goto("/");
  await expect(page.locator("#status")).not.toHaveText("Chargement…");
  await catalogLoaded;
}

/**
 * Types `query` in the item field until catalog suggestions appear, then picks the
 * first one. Retries because the catalog is parsed shortly after it downloads, and
 * suggestions only refresh on input.
 * @param {import("@playwright/test").Page} page
 * @param {string} query
 * @param {string} expectedName  name of the first suggestion
 */
export async function pickCatalogItem(page, query, expectedName) {
  const first = page.locator("#f-item-list [role=option]").first();
  await expect(async () => {
    await page.fill("#f-item", "");
    await page.fill("#f-item", query);
    await expect(first).toContainText(expectedName, { timeout: 1000 });
  }).toPass();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator("#f-item")).toHaveValue(expectedName);
}

/**
 * Adds a trade through the entry form and waits for the confirmation.
 * @param {import("@playwright/test").Page} page
 * @param {{item: string, cost: string, expected: string, date?: string, cat?: "craft"|"resale", sold?: boolean}} trade
 */
export async function addTrade(page, { item, cost, expected, date, cat = "craft", sold = false }) {
  await page.fill("#f-item", item);
  await page.keyboard.press("Escape"); // close the suggestions
  await page.click(`#f-cat button[data-v="${cat}"]`);
  await page.fill("#f-cost", cost);
  await page.fill("#f-exp", expected);
  if (date) await page.fill("#f-date", date);
  if (sold) await page.check("#f-sold");
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText(`${item} ajouté`);
}

/**
 * Installs a fake `window.claude` before the page loads. The fake database keeps
 * documents in memory, delivers snapshots like the real one, and records every
 * write in `window.__dbCalls` and the current documents in `window.__dbDocs`.
 * @param {import("@playwright/test").Page} page
 * @param {{docs?: Record<string, object>, canWrite?: boolean, userFails?: boolean}} [options]
 */
export async function installFakeDb(page, { docs = {}, canWrite = true, userFails = false } = {}) {
  await page.addInitScript(
    ({ docs, canWrite, userFails }) => {
      const store = new Map(Object.entries(docs));
      const listeners = [];
      const calls = [];
      window.__dbCalls = calls;
      window.__dbDocs = store;
      const snapshot = () => ({
        docs: [...store]
          .filter(([path]) => path.startsWith("trades/"))
          .map(([path, data]) => ({ id: path.slice("trades/".length), data: () => structuredClone(data) })),
        metadata: { fromCache: false },
      });
      const emit = () => listeners.forEach((next) => next(snapshot()));
      const ref = (path) => ({
        id: path.split("/").pop(),
        get: async () => ({ exists: store.has(path), data: () => structuredClone(store.get(path)) }),
        set: async (data) => {
          calls.push(["set", path, data]);
          store.set(path, structuredClone(data));
          emit();
        },
        update: async (data) => {
          calls.push(["update", path, data]);
          if (!store.has(path)) throw { code: "invalid_argument", message: "missing document" };
          const current = store.get(path);
          store.set(path, { ...current, p: { ...current.p, ...data.p } });
        },
        delete: async () => {
          calls.push(["delete", path]);
          store.delete(path);
          emit();
        },
      });
      const db = {
        doc: ref,
        collection: (name) => ({
          doc: (id) => ref(`${name}/${id}`),
          onSnapshot: (next) => {
            listeners.push(next);
            setTimeout(() => next(snapshot()), 20);
            return () => listeners.splice(listeners.indexOf(next), 1);
          },
        }),
      };
      const user = { can: async () => canWrite };
      window.claude = {
        use: async (name) => {
          if (name === "db") return db;
          if (name === "user") {
            if (userFails) throw new Error("user capability unavailable");
            return user;
          }
          return null;
        },
      };
    },
    { docs, canWrite, userFails },
  );
}
