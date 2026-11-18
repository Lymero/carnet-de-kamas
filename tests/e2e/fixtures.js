/**
 * @file Shared helpers for the end-to-end tests.
 *
 * - `test`: Playwright's test, whose `page` fails the test on any page error,
 *   console error or failed request, so silent breakage cannot pass.
 * - `openApp`: loads the page and waits until it has started.
 * - `installFakeDesktop`: stands in for the desktop shell (Tauri), so the desktop code
 *   path runs in any browser; tests/desktop/ drives the real app.
 */

import { test as base, expect } from "@playwright/test";

export { expect };

/**
 * The one failure that is expected: on the files-only server, the page's probe for
 * the data API gets a 404, which is how it knows to keep data in memory.
 * @param {string} url
 * @param {number|string} status
 */
const isApiProbe404 = (url, status) => /\/api\/info$/.test(url) && String(status).includes("404");

export const test = base.extend({
  page: async ({ page }, use) => {
    const problems = [];
    page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error" || isApiProbe404(message.location().url, message.text())) return;
      problems.push(`console error: ${message.text()}`);
    });
    page.on("response", (response) => {
      if (response.status() < 400 || isApiProbe404(response.url(), response.status())) return;
      problems.push(`HTTP ${response.status()} ${response.url()}`);
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
 * @param {{item: string, cost: string, expected: string, date?: string, cat?: "craft"|"resale", sold?: boolean, tax?: number}} trade
 *   `tax`: the "Taxe HDV" rate in percent, none unless asked, so amounts in tests stay round
 */
export async function addTrade(page, { item, cost, expected, date, cat = "craft", sold = false, tax = 0 }) {
  await page.fill("#f-item", item);
  await page.keyboard.press("Escape"); // close the suggestions
  await page.click(`#f-cat button[data-v="${cat}"]`);
  await page.fill("#f-cost", cost);
  await page.fill("#f-exp", expected);
  if (date) await page.fill("#f-date", date);
  if (sold) await page.check("#f-sold");
  await page.selectOption("#f-tax", String(tax));
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText(`${item} ajouté`);
}

/**
 * Stands in for the desktop shell before the page loads: a fake `window.__TAURI__`
 * whose commands (src-tauri/src/lib.rs) keep the data file in memory. The page then
 * runs its desktop code path. `window.__desktopFile` holds the file's current text and
 * `window.__desktopCalls` every command called.
 * @param {import("@playwright/test").Page} page
 * @param {{text?: string|null, path?: string}} [file]  the data file's text (null: missing)
 */
export async function installFakeDesktop(
  page,
  { text = null, path = "/home/ana/.local/share/carnet-de-kamas/carnet.json" } = {},
) {
  await page.addInitScript(
    ({ text, path }) => {
      window.__desktopFile = text;
      window.__desktopCalls = [];
      const commands = {
        data_file_path: () => path,
        read_data: () => window.__desktopFile,
        write_data: ({ contents }) => {
          window.__desktopFile = contents;
        },
        backup_data: () => undefined,
      };
      window.__TAURI__ = {
        core: {
          async invoke(command, args) {
            window.__desktopCalls.push(command);
            return commands[command](args);
          },
        },
      };
    },
    { text, path },
  );
}
