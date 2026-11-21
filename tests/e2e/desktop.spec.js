// The desktop code path (data file through the Tauri shell), with a fake shell so it
// runs in any browser. tests/desktop/ checks the same against the real app on Windows.
import { addTrade, expect, installFakeDesktop, openApp, test } from "./fixtures.js";

const stored = JSON.stringify({
  version: 1,
  trades: {
    s001: { date: "2026-01-10", item: "Kokulte", cat: "resale", cost: 1000, expected: 2000, sold: false },
  },
  prices: { 999: 5 },
});
const fileOf = (page) => page.evaluate(() => JSON.parse(window.__desktopFile));
const callsOf = (page) => page.evaluate(() => window.__desktopCalls);

test("opens the data file, backs it up, and shows where it is", async ({ page }) => {
  await installFakeDesktop(page, { text: stored });
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toHaveText("1 opération · enregistré sur ce PC");
  await expect(page.locator("#status")).toHaveAttribute("title", /^Fichier de données : .*carnet\.json$/);
  await expect(page.locator(".open-row")).toContainText("Kokulte");
  await expect.poll(() => callsOf(page)).toContain("check_update");
  expect((await callsOf(page)).filter((call) => call !== "check_update")).toEqual([
    "data_file_path",
    "read_data",
    "backup_data",
  ]);
  await expect(page.locator("#update")).toBeHidden(); // no newer version
});

test("writes the whole data file on each change", async ({ page }) => {
  await installFakeDesktop(page, { text: stored });
  await openApp(page, { catalog: false });
  await addTrade(page, { item: "Gelano", cat: "resale", cost: "100k", expected: "150k", date: "2026-01-11", tax: 2 });
  await expect(page.locator("#status")).toHaveText("2 opérations · enregistré sur ce PC");
  const file = await fileOf(page);
  const gelano = Object.values(file.trades).find((doc) => doc.item === "Gelano");
  expect(gelano).toMatchObject({ cost: 100000, expected: 150000, hdvTax: 2, schemaVersion: 1 });
  expect(file.trades.s001.item).toBe("Kokulte");
  expect(file.prices).toEqual({ 999: 5 });
});

test("starts an empty notebook when there is no data file yet", async ({ page }) => {
  await installFakeDesktop(page, { text: null });
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toHaveText("0 opération · enregistré sur ce PC");
  expect(await callsOf(page)).not.toContain("backup_data");
});

test("an unreadable data file is reported and never written over", async ({ page }) => {
  await installFakeDesktop(page, { text: "{ not json" });
  await openApp(page, { catalog: false });
  await expect(page.locator("#status")).toContainText("Impossible d'ouvrir le fichier de données");
  await expect(page.locator("#status")).toHaveClass(/warn/);

  await page.fill("#f-item", "Gelano");
  await page.fill("#f-cost", "1");
  await page.fill("#f-exp", "2");
  await page.click("#f-submit");
  await expect(page.locator(".toast")).toContainText("Impossible d'ouvrir le fichier de données");
  expect(await page.evaluate(() => window.__desktopFile)).toBe("{ not json");
  expect(await callsOf(page)).not.toContain("write_data");
});

test("stored data is shown as text and malformed parts are dropped", async ({ page }) => {
  await installFakeDesktop(page, {
    text: JSON.stringify({
      version: 1,
      trades: {
        x: {
          date: "1/1/<img src=x onerror=window.__xss=1>",
          item: "<img src=x onerror=window.__xss=2>",
          cat: "craft",
          cost: 10,
          expected: 20,
          sold: false,
          recipe: [[1, "<img src=x onerror=window.__xss=3>", 1]],
        },
      },
      prices: {},
    }),
  });
  await openApp(page, { catalog: false });
  await expect(page.locator(".open-row b")).toHaveText("<img src=x onerror=window.__xss=2>");
  await page.getByRole("button", { name: "Modifier" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator(".hint")).toHaveCount(0); // recipe dropped
  await expect(page.locator("#e-date")).toHaveValue("1970-01-01");
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test("offers a newer version and installs it on request", async ({ page }) => {
  await installFakeDesktop(page, { text: stored, update: "3.2.0" });
  await openApp(page, { catalog: false });
  const notice = page.locator("#update");
  await expect(notice).toContainText("Version 3.2.0 disponible");
  await notice.getByRole("button", { name: "Mettre à jour" }).click();
  await expect(notice).toContainText("Installation de la version 3.2.0…");
  await expect(notice.getByRole("button")).toBeDisabled();
  expect(await callsOf(page)).toContain("install_update");
});

test("a failed installation can be tried again", async ({ page }) => {
  await installFakeDesktop(page, { text: stored, update: "3.2.0", install: "fail" });
  await openApp(page, { catalog: false });
  const notice = page.locator("#update");
  await notice.getByRole("button", { name: "Mettre à jour" }).click();
  await expect(notice).toContainText("La mise à jour a échoué. Réessaie plus tard.");
  await expect(notice.getByRole("button", { name: "Mettre à jour" })).toBeEnabled();
});

test("an update check that fails changes nothing", async ({ page }) => {
  await installFakeDesktop(page, { text: stored, update: new Error("offline") });
  await openApp(page, { catalog: false });
  await expect.poll(() => callsOf(page)).toContain("check_update");
  await expect(page.locator("#update")).toBeHidden();
  await expect(page.locator("#status")).toHaveText("1 opération · enregistré sur ce PC");
});
