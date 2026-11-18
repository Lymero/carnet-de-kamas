// The "Analyse" view, navigation between views, themes and small screens.
import { addTrade, expect, openApp, test } from "./fixtures.js";

test("analysis shows results once something is sold, and links items to the history", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.click('#tabs a[data-v="analyse"]');
  await expect(page.locator("#view")).toContainText("dès ta première vente");

  await addTrade(page, {
    item: "Kokulte",
    cat: "resale",
    cost: "1m",
    expected: "1.5m",
    date: "2026-01-10",
    sold: true,
  });
  await addTrade(page, { item: "Gelano", cat: "resale", cost: "100k", expected: "150k", date: "2026-01-11" });
  await page.click('#tabs a[data-v="analyse"]');
  await expect(page.locator(".chart svg rect")).toHaveCount(1);
  await expect(page.locator(".kpis")).toContainText("500 k");

  await page.locator("tr[data-item]", { hasText: "Kokulte" }).click();
  await expect(page).toHaveURL(/#historique$/);
  await expect(page.locator("#h-q")).toHaveValue("Kokulte");
  await expect(page.locator("#h-results tbody tr")).toHaveCount(1);
});

test("tabs follow the URL hash and mark the current view", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.goto("/#analyse");
  await expect(page.locator('#tabs a[data-v="analyse"]')).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page.locator('#tabs a[data-v="analyse"]')).not.toHaveAttribute("aria-current", "page");
});

test("the dark theme follows the system setting", async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  await openApp(page, { catalog: false });
  const light = await background();
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).not.toBe(light);
});

test("no horizontal scrolling at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openApp(page, { catalog: false });
  await addTrade(page, { item: "Cape d'Ogivol", cost: "1.8m", expected: "2.6m", date: "2026-01-10" });
  for (const view of ["en-cours", "historique", "analyse"]) {
    await page.click(`#tabs a[data-v="${view}"]`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `page width overflow on ${view}`).toBeLessThanOrEqual(0);
  }
});
