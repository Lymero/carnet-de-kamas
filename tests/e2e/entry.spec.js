// The entry form: autocomplete, recipe helper, preview, adding trades.
import { addTrade, expect, openApp, openRecipeFolds, pickCatalogItem, test } from "./fixtures.js";

test("served without the data API, the status says nothing is saved", async ({ page }) => {
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toContainText("Sauvegarde indisponible");
  await expect(page.locator("#status")).toHaveClass(/warn/);
});

test("autocomplete suggests catalog items and the recipe helper prices the craft", async ({ page }) => {
  await openApp(page);
  // Apostrophes and case don't matter in the search.
  await pickCatalogItem(page, "cape d og", "Cape d'Ogivol");
  await expect(page.locator("#f-item")).toHaveAttribute("aria-expanded", "false");
  const recipe = page.locator("#recipeBox");
  await expect(recipe).toBeVisible();
  // The details start folded, with their subtotals in view.
  await expect(recipe.locator("details.fold[open]")).toHaveCount(0);
  await expect(recipe.locator("#r-ing")).toHaveText("—");
  await openRecipeFolds(page);

  // A unit price fills the investment while it follows the recipe.
  await recipe.locator("input[data-ing]").first().fill("1000");
  await expect(page.locator("#f-cost")).not.toHaveValue("");
  await expect(recipe.locator("#r-ing")).not.toHaveText("—");
  await expect(recipe.getByRole("button", { name: "Utiliser le coût calculé" })).toHaveCount(0);

  // Typing the investment by hand stops following; the button turns it back on.
  await page.fill("#f-cost", "5m");
  await recipe.getByRole("button", { name: "Utiliser le coût calculé" }).click();
  await expect(page.locator("#f-cost")).not.toHaveValue("5m");
});

test("the number of crafts multiplies the recipe, the investment and the planned sale", async ({ page }) => {
  await openApp(page);
  await page.selectOption("#f-tax", "0");
  await pickCatalogItem(page, "cape d og", "Cape d'Ogivol");
  await openRecipeFolds(page);
  const recipe = page.locator("#recipeBox");
  const firstQty = recipe.locator("td[data-q]").first();
  const unitQty = Number((await firstQty.textContent()).replace("×", ""));
  await recipe.locator("input[data-ing]").first().fill("1000");
  const unitCost = Number((await page.inputValue("#f-cost")).replace(/\s/g, ""));
  await page.fill("#f-exp", "50k");

  await recipe.locator("#f-qty").fill("10");
  await expect(firstQty).toHaveText(`${unitQty * 10}×`);
  await expect(recipe.locator("#r-qty")).toHaveText(" · ×10");
  await expect(page.locator("#f-cost")).toHaveValue(
    new RegExp(`^${String(unitCost * 10).replace(/\B(?=(\d{3})+$)/g, "\\s")}$`),
  );
  await expect(page.locator("#f-exp")).toHaveValue(/^500\s000$/);
  // Unit prices stay per unit.
  await expect(recipe.locator("input[data-ing]").first()).toHaveValue(/^1\s?000$/);

  // Back to one craft divides everything again.
  await recipe.locator("#f-qty").fill("1");
  await expect(page.locator("#f-exp")).toHaveValue(/^50\s000$/);
});

test("the preview shows expected profit and margin", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.selectOption("#f-tax", "0");
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

test("the kamas and rune value before and after forging give the FM cost", async ({ page }) => {
  await openApp(page);
  await page.selectOption("#f-tax", "0");
  await pickCatalogItem(page, "cape d og", "Cape d'Ogivol");
  await openRecipeFolds(page);
  const recipe = page.locator("#recipeBox");
  await recipe.locator("#f-runes").fill("1000");
  await expect(page.locator("#f-cost")).toHaveValue(/^1\s000$/);
  await expect(recipe.locator("#bal-used")).toHaveText("—");

  // 10m kamas + 3m of runes before, 8m + 2m after: 3m spent on FM, shown as typed.
  await recipe.locator('[data-bal="kb"]').fill("10m");
  await recipe.locator('[data-bal="rb"]').fill("3m");
  await recipe.locator('[data-bal="ka"]').fill("8m");
  await recipe.locator('[data-bal="ra"]').fill("2m");
  await expect(recipe.locator("#bal-used")).toHaveText(/^3\s000\s000$/);
  // The subtraction shows on hovering the cost.
  await expect(recipe.locator("#f-runes")).toHaveAttribute(
    "title",
    /^= \(10\s000\s000 \+ 3\s000\s000\) − \(8\s000\s000 \+ 2\s000\s000\)$/,
  );
  await expect(recipe.locator("#f-runes")).toHaveValue(/^3\s000\s000$/);
  await expect(recipe.locator("#f-runes")).toHaveJSProperty("readOnly", true);
  // The amount shows once: in the cost field, not again in the open fold's header or under the grid.
  await expect(recipe.locator("#r-fm")).toBeHidden();
  await expect(recipe.locator("#bal-used")).toBeHidden();
  await expect(page.locator("#f-cost")).toHaveValue(/^3\s000\s000$/);
  await page.fill("#f-exp", "4m");
  await expect(page.locator("#f-preview b")).toHaveText(/^1\s000\s000 /);

  // Ingredients still count on top of the FM cost.
  await recipe.locator("[data-ing]").first().fill("500k");
  await expect(page.locator("#f-cost")).toHaveValue(/^3\s500\s000$/);
  await recipe.locator("[data-ing]").first().fill("");

  // The balance covers the whole operation: more crafts don't multiply it.
  await recipe.locator("#f-qty").fill("10");
  await expect(page.locator("#f-cost")).toHaveValue(/^3\s000\s000$/);

  // "After" higher than "before" is flagged and ignored; the cost typed counts, once.
  await recipe.locator('[data-bal="ka"]').fill("20m");
  await expect(recipe.locator("#bal-used")).toHaveText("Après > Avant");
  await expect(recipe.locator("#bal-used")).toBeVisible();
  await expect(page.locator("#f-cost")).toHaveValue(/^1\s000$/);

  // Clearing the "after" values goes back to the runes typed directly.
  await recipe.locator('[data-bal="ka"]').fill("");
  await recipe.locator('[data-bal="ra"]').fill("");
  await expect(recipe.locator("#f-runes")).toHaveJSProperty("readOnly", false);
  await expect(page.locator("#f-cost")).toHaveValue(/^1\s000$/);
});

test("the FM cost shows in the history and in the analysis", async ({ page }) => {
  await openApp(page);
  await page.selectOption("#f-tax", "0");
  await pickCatalogItem(page, "cape d og", "Cape d'Ogivol");
  await openRecipeFolds(page);
  const recipe = page.locator("#recipeBox");
  await recipe.locator("[data-ing]").first().fill("500k");
  await recipe.locator('[data-bal="kb"]').fill("10m");
  await recipe.locator('[data-bal="ka"]').fill("7m");
  await expect(page.locator("#f-cost")).toHaveValue(/^3\s500\s000$/);
  await page.fill("#f-exp", "5m");
  await page.check("#f-sold");
  await page.click("#f-submit");

  await page.click('#tabs a[data-v="historique"]');
  const history = page.locator("#view table.grid");
  await expect(history.locator("thead")).toContainText("dont FM");
  await expect(history.locator("tbody td.fm").first()).toHaveText(/^3\s000\s000$/);
  await expect(history.locator("tfoot td.fm")).toHaveText(/^3\s000\s000$/);

  await page.click('#tabs a[data-v="analyse"]');
  await expect(page.locator("#view .panel").first()).toContainText(/dont FM 3\s?M · 85,7\s%/);
  const fm = page.locator("#view tr[data-item] td.fm").first();
  await expect(fm).toHaveText(/^3\sM$/);
  await expect(fm).toHaveAttribute("title", /^3\s000\s000$/);
});

test("« Vider » empties the form", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.fill("#f-item", "Kokulte");
  await page.keyboard.press("Escape");
  await page.click('#f-cat button[data-v="resale"]');
  await page.fill("#f-cost", "1m");
  await page.fill("#f-exp", "1.5m");
  await page.fill("#f-date", "2026-01-10");
  await page.check("#f-sold");
  await page.click("#f-reset");
  await expect(page.locator("#f-item")).toHaveValue("");
  await expect(page.locator("#f-item")).toBeFocused();
  await expect(page.locator("#f-cost")).toHaveValue("");
  await expect(page.locator("#f-exp")).toHaveValue("");
  await expect(page.locator("#f-date")).not.toHaveValue("2026-01-10");
  await expect(page.locator("#f-sold")).not.toBeChecked();
  await expect(page.locator("#f-preview b")).toHaveText("—");
});

test("a click outside an open fold closes it; typed FM cost is written with separators", async ({ page }) => {
  await openApp(page);
  await pickCatalogItem(page, "cape d og", "Cape d'Ogivol");
  await page.locator("#recipeBox summary", { hasText: "FM" }).click();
  const fm = page.locator('#recipeBox details[data-fold="fm"]');
  await expect(fm).toHaveJSProperty("open", true);
  await page.fill("#f-runes", "100000");
  // A click inside keeps it open.
  await page.locator('[data-bal="kb"]').click();
  await expect(fm).toHaveJSProperty("open", true);
  await expect(page.locator("#f-runes")).toHaveValue(/^100\s000$/);
  await page.locator("h2", { hasText: "Nouvelle opération" }).click();
  await expect(fm).toHaveJSProperty("open", false);
  await expect(page.locator("#f-cost")).toHaveValue(/^100\s000$/);
});
