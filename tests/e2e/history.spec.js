// The "Historique" view: filters, sorting, the edit dialog, import and export.
import { addTrade, expect, openApp, test } from "./fixtures.js";

const TAB = "\t";
const rows = (page) => page.locator("#h-results tbody tr");

test.beforeEach(async ({ page }) => {
  await openApp(page, { catalog: false });
  await addTrade(page, { item: "Kokulte", cat: "resale", cost: "500k", expected: "700k", date: "2026-01-10" });
  await addTrade(page, { item: "Cape d'Ogivol", cost: "1.8m", expected: "2.6m", date: "2026-02-03" });
  await page.click('#tabs a[data-v="historique"]');
  await expect(rows(page)).toHaveCount(2);
});

test("search filters while typing, keeping focus", async ({ page }) => {
  await page.fill("#h-q", "kok");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#h-q")).toBeFocused();
  await expect(page.locator("#h-results tfoot")).toContainText("1 opération");
});

test("the filter button shows the filters and counts the ones in use", async ({ page }) => {
  const toggle = page.locator("#h-filter-btn");
  await expect(page.locator("#h-cat")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.selectOption("#h-cat", "craft");
  await page.selectOption("#h-status", "open");
  await expect(rows(page)).toHaveCount(1);
  await expect(toggle).toHaveAccessibleName("Filtres (2 actifs)");

  // Hiding the row keeps the filters applied, and they survive switching tabs.
  await toggle.click();
  await expect(page.locator("#h-cat")).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  await page.click('#tabs a[data-v="en-cours"]');
  await page.click('#tabs a[data-v="historique"]');
  await expect(rows(page)).toHaveCount(1);
  await expect(page.locator("#h-filter-btn")).toHaveAccessibleName("Filtres (2 actifs)");

  await page.locator("#h-filter-btn").click();
  await page.getByRole("button", { name: "Effacer les filtres" }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator("#h-cat")).toHaveValue("");
  await expect(page.locator("#h-filter-btn")).toHaveAccessibleName("Filtres");
});

test("filters by type and sorts by column", async ({ page }) => {
  await page.click("#h-filter-btn");
  await page.selectOption("#h-cat", "craft");
  await expect(rows(page)).toHaveCount(1);
  await page.selectOption("#h-cat", "");

  await page.getByRole("button", { name: /^Objet/ }).click();
  await expect(page.locator("th[aria-sort=ascending]")).toContainText("Objet");
  await expect(rows(page).first()).toContainText("Cape d'Ogivol");
});

test.describe("edit dialog", () => {
  test.beforeEach(async ({ page }) => {
    await rows(page).filter({ hasText: "Kokulte" }).click();
    await expect(page.getByRole("dialog", { name: "Kokulte" })).toBeVisible();
  });

  test("errors appear inside the dialog, above its backdrop", async ({ page }) => {
    await page.fill("#e-cost", "abc");
    await page.press("#e-cost", "Enter");
    const toast = page.getByRole("dialog").locator(".toast");
    await expect(toast).toContainText("Investissement illisible");
    await expect(toast).toBeVisible();
  });

  test("ticking Vendu fills in the sale; an unreadable price is refused", async ({ page }) => {
    await page.check("#e-sold");
    await expect(page.locator("#e-sp")).toHaveValue(/700\s000/);
    await expect(page.locator("#e-sd")).not.toHaveValue("");
    await page.fill("#e-sp", "zzz");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator(".toast")).toContainText("Prix de vente illisible");
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("saves on Enter, with an empty sale date meaning unknown", async ({ page }) => {
    await page.check("#e-sold");
    await page.fill("#e-sp", "800k");
    await page.fill("#e-sd", "");
    await page.press("#e-sp", "Enter");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(rows(page).filter({ hasText: "Kokulte" }).getByRole("img", { name: "Vendu" })).toBeVisible();
  });

  test("deleting needs a second click", async ({ page }) => {
    const del = page.getByRole("button", { name: "Supprimer" });
    await del.click();
    await expect(page.getByRole("button", { name: "Confirmer la suppression" })).toBeVisible();
    await page.getByRole("button", { name: "Confirmer la suppression" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("body > .toast")).toContainText("Kokulte supprimé");
    await expect(rows(page)).toHaveCount(1);
  });
});

test("import keeps identical rows, never invents sales, rejects bad dates, and skips duplicates", async ({ page }) => {
  const paste = [
    ["Date", "Item", "Investissement", "Vente"],
    ["2026-03-01", "Cape Bouffante", "1000", "2000"],
    ["2026-03-01", "Cape Bouffante", "1000", "2000"],
    ["2026-13-45", "Bad date", "1", "2"],
  ]
    .map((cells) => cells.join(TAB))
    .join("\n");

  await page.getByRole("button", { name: "Importer depuis Sheets" }).click();
  await page.fill("#i-text", paste);
  await expect(page.locator("#i-sum")).toHaveText("2 nouvelles lignes (dont 0 vendue) · 1 illisible ignorée");
  await page.getByRole("button", { name: "Importer", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".toast")).toContainText("2 opérations importées");
  await expect(rows(page)).toHaveCount(4);

  await page.getByRole("button", { name: "Importer depuis Sheets" }).click();
  await page.fill("#i-text", paste);
  await expect(page.locator("#i-sum")).toContainText("0 nouvelle ligne · 2 déjà présentes");
  await expect(page.getByRole("button", { name: "Importer", exact: true })).toBeDisabled();
});

test("export copies a sheet with the sale columns", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copier en tableau" }).click();
  await expect(page.locator(".toast")).toContainText("2 lignes copiées");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  const [header, first] = text.split(/\r?\n/); // the Windows clipboard uses CRLF
  expect(header.split(TAB)).toEqual([
    "Date",
    "Item",
    "Catégorie",
    "Investissement",
    "Vente potentielle",
    "Bénéfice",
    "Bénéfice %",
    "Vendu ?",
    "Prix de vente",
    "Date de vente",
    "Taxe HDV",
  ]);
  expect(first.split(TAB).slice(0, 5)).toEqual(["2026-01-10", "Kokulte", "Achat/revente", "500000", "700000"]);
});

test("export falls back to a copy dialog when the clipboard is blocked", async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new DOMException("Blocked", "NotAllowedError")) },
    });
  });
  await page.getByRole("button", { name: "Copier en tableau" }).click();
  await expect(page.getByRole("dialog", { name: "Copier le tableau" })).toBeVisible();
  await expect(page.locator("#x-text")).toHaveValue(/^Date\tItem\t/);
  await page.getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("Enter on a focused row opens its editor", async ({ page }) => {
  await rows(page).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a click outside the edit dialog closes it without saving", async ({ page }) => {
  await rows(page).first().click();
  await expect(page.locator("#dlg")).toBeVisible();
  await page.fill("#e-cost", "9m");
  await page.mouse.click(5, 5);
  await expect(page.locator("#dlg")).not.toBeVisible();
  await expect(rows(page).first()).not.toContainText(/9\s000\s000/);
});
