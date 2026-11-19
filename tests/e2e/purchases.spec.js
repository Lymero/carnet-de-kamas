// Investment from chat screenshots (ui/purchase-import.js), read by the real offline
// text reader on real screenshots (tests/e2e/screenshots/): the game's default dark chat,
// the same in light colours, and two overlapping halves of it.
import { readFileSync } from "node:fs";
import { expect, openApp, test } from "./fixtures.js";

const shot = (name) => `tests/e2e/screenshots/${name}`;
const rows = (page) => page.locator("#r-rows tr[data-i]");
const kamas = (text) => Number(String(text).replace(/\D/g, ""));
/** The review list's total, as a number. */
const total = async (page) => kamas(await page.locator("#r-total").textContent());
/** A row's price, as a number. */
const price = async (row) => kamas(await row.locator('[data-f="price"]').inputValue());
const cost = async (page) => kamas(await page.locator("#f-cost").inputValue());

/** The prices in chat-purchases.png, read by eye. */
const TRUTH = [
  800, 951, 952, 952, 952, 952, 952, 9788, 21798, 21798, 21799, 21799, 21799, 21799, 21799, 21798, 21799, 21799, 228223,
  9889, 9889, 1587, 1587, 1588, 1588, 1588, 1589, 1589, 1589, 1589, 1589, 1590, 1899, 1899, 1900, 1900, 1900, 2036,
  2036, 2036, 2036, 29998,
];

// Reading takes a few seconds per screenshot, more on a slow machine.
test.describe.configure({ timeout: 90_000 });

/** Pastes a screenshot as Ctrl+V does after copying one. */
async function paste(page, name) {
  const bytes = readFileSync(shot(name)).toString("base64");
  await page.evaluate(
    async ({ bytes, name }) => {
      const blob = await (await fetch(`data:image/png;base64,${bytes}`)).blob();
      const data = new DataTransfer();
      data.items.add(new File([blob], name, { type: "image/png" }));
      document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    },
    { bytes, name },
  );
}

/** Waits until the screenshots are read and the investment filled. */
async function waitForReading(page, lots) {
  await expect(page.locator("#f-shots-check")).toHaveText(`Vérifier les ${lots} lots lus`, { timeout: 60_000 });
}

test("a pasted screenshot fills the investment at once; the lines read can be checked and fixed", async ({ page }) => {
  await openApp(page, { catalog: false });
  await expect(page.locator("#f-shots-check")).toBeHidden();
  await paste(page, "chat-purchases.png");
  await expect(page.locator("#f-shots-status")).toHaveText("Lecture de la capture…");

  // The screenshot holds 42 purchases; the total goes straight into the field, no dialog.
  await waitForReading(page, 42);
  await expect(page.locator("#dlg")).not.toBeVisible();
  await expect(page.locator(".toast")).toContainText("(42 lots)");
  const filled = await cost(page);
  const truthTotal = TRUTH.reduce((a, b) => a + b, 0);
  expect(Math.abs(filled - truthTotal)).toBeLessThan(1000);

  // Checking: every line with its picture, in order; at most one price is wrong, and it is flagged.
  await page.click("#f-shots-check");
  await expect(page.locator("#dlg-title")).toHaveText("Vérifie les achats lus");
  await expect(rows(page)).toHaveCount(42);
  await expect(rows(page).first()).toContainText("1 × Serre d'Ikargn");
  await expect(rows(page).last()).toContainText("10 × Boucle des");
  expect(await total(page)).toBe(filled);
  const pictureWidth = await rows(page)
    .first()
    .locator("canvas")
    .evaluate((c) => c.width);
  expect(pictureWidth).toBeGreaterThan(200);
  const wrong = [];
  for (const [i, expected] of TRUTH.entries()) {
    if ((await price(rows(page).nth(i))) !== expected) wrong.push(i);
  }
  expect(wrong.length).toBeLessThanOrEqual(1);
  for (const i of wrong) await expect(rows(page).nth(i)).toContainText("à vérifier");
  expect(await rows(page).filter({ hasText: "à vérifier" }).count()).toBeLessThan(6);
  expect(await rows(page).filter({ hasText: "ligne sautée" }).count()).toBe(0);

  // Changes are dropped on "Annuler"…
  await rows(page).first().locator('[data-f="counted"]').uncheck();
  expect(await total(page)).toBe(filled - 800);
  await page.click("#dlg [data-close]");
  expect(await cost(page)).toBe(filled);
  await page.click("#f-shots-check");
  await expect(rows(page).first().locator('[data-f="counted"]')).toBeChecked();

  // …and kept by "Utiliser ce total": fix a price, leave a line out, add one by hand.
  const row = rows(page).nth(1);
  const old = await price(row);
  await row.locator('[data-f="price"]').fill("1 000");
  await rows(page).first().locator('[data-f="counted"]').uncheck();
  await page.click("#r-add");
  await expect(page.locator("#r-use")).toBeDisabled(); // the new line has no price yet
  await expect(page.locator("#r-count")).toContainText("1 prix manquant");
  await rows(page).last().locator('[data-f="item"]').fill("Plume de Tofu");
  await rows(page).last().locator('[data-f="price"]').fill("2 x 150"); // a calculation works here too
  const final = filled - old + 1000 - 800 + 300;
  expect(await total(page)).toBe(final);
  await expect(page.locator("#r-count")).toHaveText("Total de 42 lots");
  await page.click("#r-use");
  await expect(page.locator("#dlg")).not.toBeVisible();
  expect(await cost(page)).toBe(final);
  await expect(page.locator("#f-shots-check")).toHaveText("Vérifier les 42 lots lus");

  // Typing another investment by hand forgets the screenshots.
  await page.fill("#f-cost", "1.2m");
  await expect(page.locator("#f-shots-check")).toBeHidden();
  await expect(page.locator("#f-shots-status")).toHaveText("ou colle une capture (Ctrl+V)");
});

test("reads a light chat theme as well, picked as a file", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.setInputFiles("#f-shots-file", shot("chat-light.png"));
  await waitForReading(page, 42);
  await page.click("#f-shots-check");
  expect(await price(rows(page).nth(18))).toBe(228223);
  expect(await rows(page).filter({ hasText: "à vérifier" }).count()).toBeLessThan(6);
});

test("a second screenshot adds to the first, without the lines both show", async ({ page }) => {
  await openApp(page, { catalog: false });
  await paste(page, "chat-top.png");
  await expect(page.locator("#f-shots-status")).toHaveText(/1 capture · colle la suivante/, { timeout: 60_000 });
  const first = await cost(page);
  await paste(page, "chat-bottom.png");
  await expect(page.locator("#f-shots-status")).toHaveText(/2 captures/, { timeout: 60_000 });
  expect(await cost(page)).toBeGreaterThan(first);

  await page.click("#f-shots-check");
  await expect(page.locator("#r-rows tr.shot")).toHaveText([/1\. chat-top\.png · \d+ lignes/, /2\. chat-bottom\.png/]);
  const repeats = rows(page).filter({ hasText: "doublon ?" });
  expect(await repeats.count()).toBeGreaterThanOrEqual(4);
  for (const box of await repeats.locator('[data-f="counted"]').all()) await expect(box).not.toBeChecked();
  expect(await total(page)).toBe(await cost(page));
  // Ticking one back adds it to the total.
  const before = await total(page);
  const value = await price(repeats.first());
  await repeats.first().locator('[data-f="counted"]').check();
  expect(await total(page)).toBe(before + value);
});

test("refuses files that are not images; adding the trade forgets the screenshots", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.setInputFiles("#f-shots-file", [{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") }]);
  await expect(page.locator(".toast")).toContainText("notes.txt n'est pas une image");
  await expect(page.locator("#f-shots-check")).toBeHidden();

  await paste(page, "chat-top.png");
  await expect(page.locator("#f-shots-check")).toBeVisible({ timeout: 60_000 });
  await page.fill("#f-item", "Cape d'Ogivol");
  await page.fill("#f-exp", "2m");
  await page.click("#f-submit");
  await expect(page.locator("#f-cost")).toHaveValue("");
  await expect(page.locator("#f-shots-check")).toBeHidden();
});
