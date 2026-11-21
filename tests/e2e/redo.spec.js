// "Refaire": a past trade fills the entry form again, from En cours or Historique.
import { addTrade, expect, openApp, openRecipeFolds, pickCatalogItem, test } from "./fixtures.js";

test("Refaire on an En cours row fills the form with that trade, dated today and not sold", async ({ page }) => {
  await openApp(page, { catalog: false });
  await addTrade(page, { item: "Kokulte", cat: "resale", cost: "500k", expected: "700k", date: "2026-01-10", tax: 2 });
  await page.locator(".open-row").getByRole("button", { name: "Refaire" }).click();

  await expect(page.locator("#f-item")).toHaveValue("Kokulte");
  await expect(page.locator('#f-cat button[data-v="resale"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#f-cost")).toHaveValue(/^500\s000$/);
  await expect(page.locator("#f-exp")).toHaveValue(/^700\s000$/);
  await expect(page.locator("#f-tax")).toHaveValue("2");
  await expect(page.locator("#f-date")).not.toHaveValue("2026-01-10");
  await expect(page.locator("#f-sold")).not.toBeChecked();
  await expect(page.locator("#f-cost")).toBeFocused();

  await page.click("#f-submit");
  await expect(page.locator(".open-row")).toHaveCount(2);
});

test("Refaire in Historique keeps the number of crafts, prices and FM cost, without opening the editor", async ({
  page,
}) => {
  await openApp(page);
  await page.selectOption("#f-tax", "0");
  await pickCatalogItem(page, "cape d og", "Cape d'Ogivol");
  await openRecipeFolds(page);
  const recipe = page.locator("#recipeBox");
  await recipe.locator("#f-qty").fill("3");
  await recipe.locator("input[data-ing]").first().fill("1000");
  await recipe.locator("#f-runes").fill("200k");
  const cost = await page.inputValue("#f-cost");
  await page.fill("#f-exp", "5m");
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText("ajouté");

  await page.click('#tabs a[data-v="historique"]');
  await page.getByRole("button", { name: "Refaire Cape d'Ogivol" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await expect(page.locator("#f-item")).toHaveValue("Cape d'Ogivol");
  await expect(recipe.locator("#f-qty")).toHaveValue("3");
  await expect(recipe.locator("#f-runes")).toHaveValue(/^200\s000$/);
  await expect(page.locator("#f-cost")).toHaveValue(cost);
  await expect(page.locator("#f-exp")).toHaveValue(/^5\s000\s000$/);
  // The investment still follows the recipe: no "use the computed cost" button.
  await expect(page.locator("#r-use")).toHaveCount(0);
});

test("a hand-typed investment is kept as typed", async ({ page }) => {
  await openApp(page);
  await page.selectOption("#f-tax", "0");
  await pickCatalogItem(page, "cape d og", "Cape d'Ogivol");
  await openRecipeFolds(page);
  await page.locator("#recipeBox input[data-ing]").first().fill("1000");
  await page.fill("#f-cost", "4m");
  await page.fill("#f-exp", "5m");
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText("ajouté");

  await page.locator(".open-row").getByRole("button", { name: "Refaire" }).click();
  await expect(page.locator("#f-cost")).toHaveValue(/^4\s000\s000$/);
  await expect(page.locator("#r-use")).toBeVisible();
});
