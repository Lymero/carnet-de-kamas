import { test } from "node:test";
import assert from "node:assert/strict";
import { byCategory, byItem, byMonth, itemHistory, summarize } from "../src/js/domain/stats.js";

const t = (id, date, item, cat, cost, expected, sold = true, extra = {}) => ({
  id,
  date,
  item,
  cat,
  cost,
  expected,
  sold,
  soldPrice: sold ? expected : null,
  soldDate: null,
  ...extra,
});

const trades = [
  t("a", "2026-08-20", "Coiffe d'Ogivol", "craft", 1_000, 2_000, true, { runes: 300 }),
  t("b", "2026-08-21", "Coiffe d’Ogivol", "craft", 1_000, 800),
  t("c", "2026-10-04", "Kokulte", "resale", 5_000, 6_000),
  t("d", "2026-11-12", "Cape d'Ogivol", "craft", 2_000, 3_000, false, { runes: 500 }),
  t("e", "2026-10-30", "Kokulte", "resale", 1_000, 1_500, true, { soldDate: "2026-11-02" }),
];

test("summarize separates realised and open figures", () => {
  const s = summarize(trades, "2026-11-18");
  assert.equal(s.realisedProfit, 1_000 - 200 + 1_000 + 500);
  assert.equal(s.soldCount, 4);
  assert.equal(s.winCount, 3);
  assert.equal(s.openCost, 2_000);
  assert.equal(s.openExpected, 1_000);
  assert.equal(s.monthProfit, 500, "sale dated in November counts in November");
});

test("byMonth groups by sale month, oldest first, and limits", () => {
  assert.deepEqual(
    byMonth(trades, 12).map((m) => [m.month, m.profit]),
    [
      ["2026-08", 800],
      ["2026-10", 1_000],
      ["2026-11", 500],
    ],
  );
  assert.equal(byMonth(trades, 2).length, 2);
});

test("byCategory and byItem", () => {
  const c = byCategory(trades);
  assert.deepEqual(c.craft, { cost: 2_000, fm: 300, profit: 800, count: 2 }, "unsold FM is not realised");
  assert.equal(c.resale.count, 2);
  const items = byItem(trades);
  const coiffe = items.find((i) => i.name.startsWith("Coiffe"));
  assert.equal(coiffe.sold, 2, "curly and straight apostrophes group together");
  assert.equal(coiffe.fm, 300);
  assert.equal(items.find((i) => i.name === "Kokulte").fm, 0, "no runes recorded counts as 0");
  assert.equal(items[0].name, "Kokulte");
});

test("itemHistory remembers the latest category", () => {
  const h = itemHistory(trades);
  assert.equal(h.get("kokulte").count, 2);
  assert.equal(h.get("kokulte").lastCat, "resale");
});
