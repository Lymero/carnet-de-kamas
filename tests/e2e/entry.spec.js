// The entry form: autocomplete, recipe helper, preview, adding trades, read-only mode.
import { addTrade, expect, installFakeDb, openApp, pickCatalogItem, test } from "./fixtures.js";

test("without the db capability the status says nothing is saved", async ({ page }) => {
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toContainText("Sauvegarde indisponible");
  await expect(page.locator("#status")).toHaveClass(/warn/);
});

test("autocomplete suggests catalog items and the recipe helper prices the craft", async ({ page }) => {
  await openApp(page);
  // Apostrophes and case don't matter in the search.
  await pickCatalogItem(page, "cape d og", "Cape d'Ogivol");
  await expect(page.locator("#f-item")).toHaveAttribute("aria-expanded", "false");
  const recipe = page.locator("#recipeBox .recipe");
  await expect(recipe).toBeVisible();

  // A unit price fills the investment while it follows the recipe.
  await recipe.locator("input[data-ing]").first().fill("1000");
  await expect(page.locator("#f-cost")).not.toHaveValue("");
  await expect(recipe).toContainText("L'investissement suit ce calcul");

  // Typing the investment by hand stops following; the button turns it back on.
  await page.fill("#f-cost", "5m");
  await recipe.getByRole("button", { name: "Utiliser le coût calculé" }).click();
  await expect(page.locator("#f-cost")).not.toHaveValue("5m");
});

test("the preview shows expected profit and margin", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.fill("#f-cost", "1.8m");
  await page.fill("#f-exp", "2.6m");
  await expect(page.locator("#f-preview b")).toHaveText(/^800\s000 \(\+44,4\s%\)$/);
  await expect(page.locator("#f-preview b")).toHaveClass(/pos/);
});

test("adding a trade lists it in En cours and resets the form", async ({ page }) => {
  await openApp(page, { catalog: false });
  await addTrade(page, { item: "Kokulte", cat: "resale", cost: "500k", expected: "700k", date: "2026-01-10" });
  await expect(page).toHaveURL(/#en-cours$/);
  await expect(page.locator(".open-row")).toHaveCount(1);
  await expect(page.locator(".open-row")).toContainText("Kokulte");
  await expect(page.locator("#c-open")).toHaveText("1");
  await expect(page.locator("#f-item")).toHaveValue("");
  await expect(page.locator('#f-cat button[data-v="resale"]')).toHaveAttribute("aria-pressed", "true");
});

test("invalid input is refused with a readable message", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.fill("#f-item", "Kokulte");
  await page.fill("#f-cost", "beaucoup");
  await page.fill("#f-exp", "700k");
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText("Investissement illisible");
  await expect(page.locator("#c-all")).toHaveText("0");
});

test("a read-only viewer sees the data but cannot use the form", async ({ page }) => {
  await installFakeDb(page, {
    canWrite: false,
    docs: {
      "trades/a": { date: "2026-01-10", item: "Kokulte", cat: "resale", cost: 1, expected: 2, sold: false },
    },
  });
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toContainText("Lecture seule");
  await expect(page.locator("#f-submit")).toBeDisabled();
  await expect(page.locator("#f-item")).toBeDisabled();
  await expect(page.locator(".open-row")).toContainText("Kokulte");
  await expect(page.locator('[data-act="sell"]')).toHaveCount(0);
  await expect(page.locator('[data-act="edit"]')).toHaveText("Détails");
});
