// Investment from chat screenshots (ui/purchase-import.js), read by the real offline
// text reader on real screenshots (tests/e2e/screenshots/): the game's default dark chat,
// the same in light colours, and two overlapping halves of it.
import { expect, openApp, test } from "./fixtures.js";

const shot = (name) => `tests/e2e/screenshots/${name}`;
const rows = (page) => page.locator("#r-rows tr[data-i]");
/** The review list's total, as a number. */
const total = async (page) => Number((await page.locator("#r-total").textContent()).replace(/\D/g, ""));
/** A row's price, as a number. */
const price = async (row) => Number((await row.locator('[data-f="price"]').inputValue()).replace(/\D/g, ""));

// Reading takes a few seconds per screenshot, more on a slow machine.
test.describe.configure({ timeout: 90_000 });

/** Opens the dialog, picks `files` and waits for the review list. */
async function readScreenshots(page, files) {
  await openApp(page, { catalog: false });
  await page.click("#f-shots");
  await expect(page.locator("#dlg-title")).toHaveText("Investissement depuis des captures");
  await page.setInputFiles("#s-files", files.map(shot));
  await expect(page.locator("#s-list li")).toHaveCount(files.length);
  await page.click("#s-read");
  await expect(page.locator("#dlg-title")).toHaveText("Vérifie les achats lus", { timeout: 60_000 });
}

test("reads a chat screenshot offline, lets the player fix it, and fills the investment", async ({ page }) => {
  await readScreenshots(page, ["chat-purchases.png"]);

  // The screenshot holds 42 purchases; the reader finds them all, in order, each with its picture.
  await expect(rows(page)).toHaveCount(42);
  await expect(rows(page).first()).toContainText("1 × Serre d'Ikargn");
  await expect(rows(page).last()).toContainText("10 × Boucle des");
  expect(await price(rows(page).first())).toBe(800);
  expect(await price(rows(page).nth(18))).toBe(228223);
  const pictureWidth = await rows(page)
    .first()
    .locator("canvas")
    .evaluate((c) => c.width);
  expect(pictureWidth).toBeGreaterThan(200);
  // A misread digit ("1 400" for "1 900") is flagged; most lines are not.
  const flagged = rows(page).filter({ hasText: "à vérifier" });
  expect(await flagged.count()).toBeGreaterThanOrEqual(1);
  expect(await flagged.count()).toBeLessThan(8);
  await expect(
    flagged.locator('[data-f="price"][value="1 400"]').or(flagged.locator('[data-f="price"]')).first(),
  ).toBeVisible();

  // Fix a price, leave a line out, add one by hand: the total follows.
  const before = await total(page);
  const row = rows(page).nth(1);
  const old = await price(row);
  await row.locator('[data-f="price"]').fill("1 000");
  expect(await total(page)).toBe(before - old + 1000);
  await rows(page).first().locator('[data-f="counted"]').uncheck();
  expect(await total(page)).toBe(before - old + 1000 - 800);
  await page.click("#r-add");
  await expect(page.locator("#r-use")).toBeDisabled(); // the new line has no price yet
  await expect(page.locator("#r-count")).toContainText("1 prix manquant");
  await rows(page).last().locator('[data-f="item"]').fill("Plume de Tofu");
  await rows(page).last().locator('[data-f="price"]').fill("2 x 150"); // a calculation works here too
  const final = before - old + 1000 - 800 + 300;
  expect(await total(page)).toBe(final);
  await expect(page.locator("#r-count")).toHaveText("Total de 42 lots");

  await page.click("#r-use");
  await expect(page.locator("#dlg")).not.toBeVisible();
  expect(Number((await page.locator("#f-cost").inputValue()).replace(/\D/g, ""))).toBe(final);
  await expect(page.locator(".toast")).toContainText("(42 lots)");
});

test("reads a light chat theme as well", async ({ page }) => {
  await readScreenshots(page, ["chat-light.png"]);
  await expect(rows(page)).toHaveCount(42);
  expect(await price(rows(page).nth(18))).toBe(228223);
});

test("flags the lines two overlapping screenshots share, and leaves them out", async ({ page }) => {
  await readScreenshots(page, ["chat-top.png", "chat-bottom.png"]);
  await expect(page.locator("#r-rows tr.shot")).toHaveText([/1\. chat-top\.png · \d+ lignes/, /2\. chat-bottom\.png/]);
  const repeats = rows(page).filter({ hasText: "doublon ?" });
  expect(await repeats.count()).toBeGreaterThanOrEqual(4);
  for (const box of await repeats.locator('[data-f="counted"]').all()) await expect(box).not.toBeChecked();
  // Ticking one back adds it to the total.
  const before = await total(page);
  const first = repeats.first();
  const value = await price(first);
  await first.locator('[data-f="counted"]').check();
  expect(await total(page)).toBe(before + value);
  // Back to the screenshots, to read others.
  await page.click("#r-back");
  await expect(page.locator("#s-list li")).toHaveCount(2);
});

test("refuses files that are not images, and can forget the picked ones", async ({ page }) => {
  await openApp(page, { catalog: false });
  await page.click("#f-shots");
  await page.setInputFiles("#s-files", [{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") }]);
  await expect(page.locator(".toast")).toContainText("notes.txt n'est pas une image");
  await expect(page.locator("#s-read")).toBeDisabled();
  await page.setInputFiles("#s-files", [shot("chat-top.png")]);
  await expect(page.locator("#s-read")).toBeEnabled();
  await page.click("#s-list [data-remove]");
  await expect(page.locator("#s-read")).toBeDisabled();
  await page.click("#dlg [data-close]");
  await expect(page.locator("#dlg")).not.toBeVisible();
});
