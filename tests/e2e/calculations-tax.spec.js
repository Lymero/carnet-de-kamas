// Calculations in kamas fields, and the auction-house (HDV) tax option.
import { addTrade, expect, openApp, test } from "./fixtures.js";

const bubble = (page) => page.locator(".calc");

test.describe("calculations in kamas fields", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, { catalog: false });
    await page.selectOption("#f-tax", "0");
  });

  test("the result shows while typing and replaces the calculation on leaving the field", async ({ page }) => {
    await page.fill("#f-cost", "1.2m + 350k + 80k");
    await expect(bubble(page)).toBeVisible();
    await expect(bubble(page)).toHaveText(/^= 1\s630\s000$/);

    await page.fill("#f-exp", "3 x 1m");
    await expect(bubble(page)).toHaveText(/^= 3\s000\s000$/);
    await expect(page.locator("#f-cost")).toHaveValue(/^1\s630\s000$/, { timeout: 1000 });
    await expect(page.locator("#f-preview b")).toHaveText(/^1\s370\s000 /);

    await page.locator("#f-date").focus();
    await expect(page.locator("#f-exp")).toHaveValue(/^3\s000\s000$/);
    await expect(bubble(page)).toBeHidden();
  });

  test("an incomplete calculation is flagged and left as typed", async ({ page }) => {
    await page.fill("#f-cost", "1.2m +");
    await expect(bubble(page)).toHaveText("Calcul incomplet");
    await expect(bubble(page)).toHaveClass(/bad/);
    await expect(page.locator("#f-preview b")).toHaveText("—");
    await page.locator("#f-date").focus();
    await expect(page.locator("#f-cost")).toHaveValue("1.2m +");
  });

  test("a single amount shows no bubble, and is written in full on leaving the field", async ({ page }) => {
    await page.fill("#f-cost", "250k");
    await expect(bubble(page)).toBeHidden();
    await page.fill("#f-exp", "100000");
    await expect(page.locator("#f-cost")).toHaveValue(/^250\s000$/);
    await page.locator("#f-date").focus();
    await expect(page.locator("#f-exp")).toHaveValue(/^100\s000$/);
  });

  test("a trade can be saved straight from a calculation", async ({ page }) => {
    await page.fill("#f-item", "Kokulte");
    await page.keyboard.press("Escape");
    await page.fill("#f-cost", "500k + 2 x 100k");
    await page.fill("#f-exp", "1m");
    await page.click("#f-submit");
    await expect(page.locator(".open-row")).toContainText("700 k");
  });

  test("calculations work in the edit dialog too, with the result above the backdrop", async ({ page }) => {
    await addTrade(page, { item: "Kokulte", cat: "resale", cost: "500k", expected: "700k", date: "2026-01-10" });
    await page.click('#tabs a[data-v="historique"]');
    await page.locator("#h-results tbody tr").first().click();
    await page.fill("#e-cost", "500k + 50k");
    await expect(page.getByRole("dialog").locator(".calc")).toHaveText(/^= 550\s000$/);
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("#h-results tbody tr").first()).toContainText(/550\s000/);
  });
});

test.describe("auction-house tax", () => {
  test("is 2 % by default, and deducted in the preview", async ({ page }) => {
    await openApp(page, { catalog: false });
    await expect(page.locator("#f-tax")).toHaveValue("2");
    await page.fill("#f-cost", "1m");
    await page.fill("#f-exp", "2m");
    await expect(page.locator("#f-preview small")).toHaveText(/^taxe HDV de 40\s000 \(2 %\) déduite$/);
    await expect(page.locator("#f-preview b")).toHaveText(/^960\s000 \(\+96\s%\)$/);

    await page.selectOption("#f-tax", "1");
    await expect(page.locator("#f-preview small")).toHaveText(/^taxe HDV de 20\s000 \(1 %\) déduite$/);
    await expect(page.locator("#f-preview b")).toHaveText(/^980\s000 /);

    await page.selectOption("#f-tax", "0");
    await expect(page.locator("#f-preview small")).toHaveCount(0);
    await expect(page.locator("#f-preview b")).toHaveText(/^1\s000\s000 \(\+100\s%\)$/);
  });

  test("a taxed trade shows its profit after tax everywhere", async ({ page }) => {
    await openApp(page, { catalog: false });
    await addTrade(page, { item: "Cape", cat: "resale", cost: "1m", expected: "2m", date: "2026-01-10", tax: 2 });
    await expect(page.locator(".open-row")).toContainText("+96 %");

    await page.locator(".open-row").getByRole("button", { name: "Vendu" }).click();
    await expect(page.locator("#s-tax")).toHaveValue("2");
    await page.fill("#s-price", "2.5m");
    await page.getByRole("button", { name: "Confirmer" }).click();
    // 2.5m - 1m - 2 % of 2.5m (50 000) = 1 450 000, +145 %
    await expect(page.locator(".toast")).toContainText("Cape vendu : +145 %");

    await page.click('#tabs a[data-v="historique"]');
    await expect(page.locator("#h-results tbody tr").first()).toContainText(/1\s450\s000/);
    await expect(page.locator(".kpis")).toContainText("1,45 M");
  });

  test("a sale can switch to 1 % when the price was updated at the HDV", async ({ page }) => {
    await openApp(page, { catalog: false });
    await addTrade(page, { item: "Cape", cat: "resale", cost: "1m", expected: "2m", date: "2026-01-10", tax: 2 });
    await page.locator(".open-row").getByRole("button", { name: "Vendu" }).click();
    await page.fill("#s-price", "1.8m");
    await page.selectOption("#s-tax", "1");
    await page.getByRole("button", { name: "Confirmer" }).click();
    // 1.8m - 1m - 1 % of 1.8m (18 000) = 782 000, +78,2 %
    await expect(page.locator(".toast")).toContainText("Cape vendu : +78,2 %");
    await page.click('#tabs a[data-v="historique"]');
    await page.locator("#h-results tbody tr").first().click();
    await expect(page.locator("#e-tax")).toHaveValue("1");
  });

  test("the rate can be changed when editing a trade", async ({ page }) => {
    await openApp(page, { catalog: false });
    await addTrade(page, { item: "Cape", cat: "resale", cost: "1m", expected: "2m", date: "2026-01-10" });
    await page.click('#tabs a[data-v="historique"]');
    const row = page.locator("#h-results tbody tr").first();
    await expect(row).toContainText(/1\s000\s000/);

    await row.click();
    await expect(page.locator("#e-tax")).toHaveValue("0");
    await page.selectOption("#e-tax", "2");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(row).toContainText(/960\s000/);
  });

  test("the form remembers the last rate chosen on this browser", async ({ page }) => {
    await openApp(page, { catalog: false });
    await page.selectOption("#f-tax", "1");
    await page.reload();
    await openApp(page, { catalog: false });
    await expect(page.locator("#f-tax")).toHaveValue("1");
  });
});
