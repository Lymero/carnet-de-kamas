// The cloud code path, with a fake of the claude.ai `db` and `user` capabilities.
import { addTrade, expect, installFakeDb, openApp, pickCatalogItem, test } from "./fixtures.js";

const stored = {
  "trades/s001": { date: "2026-01-10", item: "Kokulte", cat: "resale", cost: 1000, expected: 2000, sold: false },
  "settings/prices": { p: { 999: 5 } },
};

test("stored trades load and the status confirms they are saved", async ({ page }) => {
  await installFakeDb(page, { docs: stored });
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toHaveText("1 opération · sauvegardé");
  await expect(page.locator(".open-row")).toContainText("Kokulte");
});

test("a failing user capability does not disable cloud storage", async ({ page }) => {
  await installFakeDb(page, { docs: stored, userFails: true });
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toHaveText("1 opération · sauvegardé");
});

test("a new trade is written as a document without its id and with a schema version", async ({ page }) => {
  await installFakeDb(page, { docs: stored });
  await openApp(page, { catalog: false });
  await addTrade(page, { item: "Gelano", cat: "resale", cost: "100k", expected: "150k", date: "2026-01-11" });
  const [verb, path, body] = await page.evaluate(() => window.__dbCalls.find(([, p]) => p.startsWith("trades/")));
  expect(verb).toBe("set");
  expect(path).toMatch(/^trades\/t/);
  expect(body).toMatchObject({ item: "Gelano", cost: 100000, expected: 150000, schemaVersion: 1 });
  expect(body).not.toHaveProperty("id");
  await expect(page.locator("#status")).toHaveText("2 opérations · sauvegardé");
});

test("unit prices are merged into the stored ones, never replacing them", async ({ page }) => {
  await installFakeDb(page, { docs: stored });
  await openApp(page);
  await pickCatalogItem(page, "Cape d'Ogivol", "Cape d'Ogivol");
  await page.locator("#recipeBox input[data-ing]").first().fill("1000");
  await page.fill("#f-exp", "9m");
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText("ajouté");

  const priceWrites = await page.evaluate(() => window.__dbCalls.filter(([, p]) => p === "settings/prices"));
  expect(priceWrites).toHaveLength(1);
  const [verb, , body] = priceWrites[0];
  expect(verb).toBe("update");
  expect(Object.values(body.p)).toEqual([1000]);
  const prices = await page.evaluate(() => window.__dbDocs.get("settings/prices").p);
  expect(prices["999"]).toBe(5);
});

test("stored data is shown as text and malformed parts are dropped", async ({ page }) => {
  await installFakeDb(page, {
    docs: {
      "trades/x": {
        date: "1/1/<img src=x onerror=window.__xss=1>",
        item: "<img src=x onerror=window.__xss=2>",
        cat: "craft",
        cost: 10,
        expected: 20,
        sold: false,
        recipe: [[1, "<img src=x onerror=window.__xss=3>", 1]],
      },
    },
  });
  await openApp(page, { catalog: false });
  await expect(page.locator(".open-row b")).toHaveText("<img src=x onerror=window.__xss=2>");
  await page.getByRole("button", { name: "Modifier" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator(".hint")).toHaveCount(0); // recipe dropped
  await expect(page.locator("#e-date")).toHaveValue("1970-01-01");
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});
