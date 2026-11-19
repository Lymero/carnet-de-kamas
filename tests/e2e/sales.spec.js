// The "En cours" view: recording a sale.
import { addTrade, expect, openApp, test } from "./fixtures.js";

test.beforeEach(async ({ page }) => {
  await openApp(page, { catalog: false });
  await addTrade(page, { item: "Kokulte", cat: "resale", cost: "1m", expected: "1.5m", date: "2026-01-10" });
});

test("a sale is recorded with the real price and date", async ({ page }) => {
  const row = page.locator(".open-row", { hasText: "Kokulte" });
  await row.getByRole("button", { name: "Vendu" }).click();
  await expect(page.locator("#s-price")).toBeFocused();
  await page.fill("#s-price", "2m");
  await page.fill("#s-date", "2026-01-20");
  await page.press("#s-price", "Enter");
  await expect(page.locator(".toast")).toContainText("Kokulte vendu : +100 %");
  await expect(page.locator(".open-row")).toHaveCount(0);
  await expect(page.locator("#c-open")).toHaveText("0");
});

test("a sale dated before the trade is refused", async ({ page }) => {
  await page.locator(".open-row").getByRole("button", { name: "Vendu" }).click();
  await page.fill("#s-date", "2026-01-01");
  await page.getByRole("button", { name: "Confirmer" }).click();
  await expect(page.locator(".toast")).toContainText("avant la date de l'opération");
  await expect(page.locator(".open-row")).toHaveCount(1);
});

test("the sale price being typed survives a live update of the list", async ({ page }) => {
  await page.locator(".open-row").getByRole("button", { name: "Vendu" }).click();
  await page.fill("#s-price", "3m");
  // Adding another trade re-renders the whole list.
  await addTrade(page, { item: "Gelano", cat: "resale", cost: "100k", expected: "150k", date: "2026-01-11" });
  await expect(page.locator(".open-row")).toHaveCount(2);
  await expect(page.locator("#s-price")).toHaveValue("3m");
});

test("cancelling the sale form keeps the trade for sale", async ({ page }) => {
  await page.locator(".open-row").getByRole("button", { name: "Vendu" }).click();
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator(".sell")).toHaveCount(0);
  await expect(page.locator(".open-row").getByRole("button", { name: "Vendu" })).toBeFocused();
});

test("the list is sorted like the history", async ({ page }) => {
  await addTrade(page, { item: "Gelano", cat: "craft", cost: "3m", expected: "3.3m", date: "2026-01-12" });
  await addTrade(page, { item: "Amulette", cat: "resale", cost: "100k", expected: "300k", date: "2026-01-11" });
  const names = page.locator(".open-row .it b");
  await expect(names).toHaveText(["Kokulte", "Amulette", "Gelano"]); // oldest first
  await page.locator(".open-sort").getByRole("button", { name: "Investi" }).click();
  await expect(names).toHaveText(["Gelano", "Kokulte", "Amulette"]);
  await page
    .locator(".open-sort")
    .getByRole("button", { name: /Investi/ })
    .click();
  await expect(names).toHaveText(["Amulette", "Kokulte", "Gelano"]);
  await page.locator(".open-sort").getByRole("button", { name: "Marge" }).click();
  await expect(names).toHaveText(["Amulette", "Kokulte", "Gelano"]);
  await page.locator(".open-sort").getByRole("button", { name: "Objet" }).click();
  await expect(names).toHaveText(["Amulette", "Gelano", "Kokulte"]);
});

test("the date, the type and the days for sale stay on one line", async ({ page }) => {
  await addTrade(page, { item: "Gelano", cat: "craft", cost: "1m", expected: "1.2m", date: "2026-01-12" });
  for (const row of await page.locator(".open-row .it small").all()) {
    const height = await row.evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThan(26);
    await expect(row).toContainText("j en vente");
  }
});
