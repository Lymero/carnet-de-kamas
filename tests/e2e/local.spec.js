// Local mode: the page served by `npm start`, saving to a data file (a throwaway one here).
// These tests share one server and data file, so each uses its own item names.
import { readFile } from "node:fs/promises";
import { addTrade, expect, openApp, openRecipeFolds, pickCatalogItem, test } from "./fixtures.js";
import { E2E_DATA_FILE, LOCAL_URL } from "./servers.js";

test.use({ baseURL: LOCAL_URL });

/** An item name no other test uses. */
const uniqueItem = (label) => `${label} ${test.info().testId.slice(0, 8)}${Date.now().toString(36)}`;
const readDataFile = async () => JSON.parse(await readFile(E2E_DATA_FILE, "utf8"));

test("trades are saved to the data file and are still there after a reload", async ({ page }) => {
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toContainText("enregistré sur ce PC");
  const item = uniqueItem("Coiffe");
  await addTrade(page, { item, cat: "resale", cost: "250k", expected: "400k", date: "2026-01-10", tax: 2 });

  const saved = Object.values((await readDataFile()).trades).find((doc) => doc.item === item);
  expect(saved).toMatchObject({ cost: 250000, expected: 400000, sold: false, hdvTax: 2, schemaVersion: 1 });

  await page.reload();
  await expect(page.locator("#status")).toContainText("enregistré sur ce PC");
  await page.click('#tabs a[data-v="historique"]');
  await expect(page.locator("#h-results tbody tr", { hasText: item })).toHaveCount(1);
});

test("a change made in one tab appears in the others", async ({ page, context }) => {
  const other = await context.newPage();
  await openApp(page, { catalog: false });
  await openApp(other, { catalog: false });
  await other.click('#tabs a[data-v="historique"]');

  const item = uniqueItem("Bottes");
  await addTrade(page, { item, cat: "resale", cost: "1m", expected: "1.2m", date: "2026-01-11" });
  await expect(other.locator("#h-results tbody tr", { hasText: item })).toHaveCount(1);
  await other.close();
});

test("a sale and a deletion are saved too", async ({ page }) => {
  await openApp(page, { catalog: false });
  const item = uniqueItem("Cape");
  await addTrade(page, { item, cat: "resale", cost: "1m", expected: "1.5m", date: "2026-01-12" });

  const row = page.locator(".open-row", { hasText: item });
  await row.getByRole("button", { name: "Vendu" }).click();
  await page.fill("#s-price", "1.6m");
  await page.getByRole("button", { name: "Confirmer" }).click();
  await expect(page.locator(".toast")).toContainText(`${item} vendu`);
  const sold = Object.values((await readDataFile()).trades).find((doc) => doc.item === item);
  expect(sold).toMatchObject({ sold: true, soldPrice: 1600000 });

  await page.click('#tabs a[data-v="historique"]');
  await page.locator("#h-results tbody tr", { hasText: item }).click();
  await page.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("button", { name: "Confirmer la suppression" }).click();
  await expect(page.locator("#h-results tbody tr", { hasText: item })).toHaveCount(0);
  const remaining = Object.values((await readDataFile()).trades).filter((doc) => doc.item === item);
  expect(remaining).toEqual([]);
});

test("remembered unit prices are saved and offered again", async ({ page }) => {
  await openApp(page);
  await pickCatalogItem(page, "Cape d'Ogivol", "Cape d'Ogivol");
  await openRecipeFolds(page);
  const price = page.locator("#recipeBox input[data-ing]").first();
  const ingredient = await price.getAttribute("data-ing");
  await price.fill("4321");
  await page.fill("#f-exp", "9m");
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText("ajouté");
  await expect.poll(async () => (await readDataFile()).prices[ingredient]).toBe(4321);

  await openApp(page); // a fresh load: prices come back from the data file
  await pickCatalogItem(page, "Cape d'Ogivol", "Cape d'Ogivol");
  await expect(page.locator(`#recipeBox input[data-ing="${ingredient}"]`)).toHaveValue(/4\s321/);
});
