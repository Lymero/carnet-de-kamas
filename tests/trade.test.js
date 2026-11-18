import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auctionTax,
  markSold,
  normalizeTrade,
  profit,
  salePrice,
  toDocument,
  validateTrade,
} from "../src/js/domain/trade.js";

const base = {
  id: "t1",
  date: "2026-08-20",
  item: "Cape d'Ogivol",
  cat: "craft",
  cost: 3_368_480,
  expected: 4_350_000,
  sold: false,
  soldPrice: null,
  soldDate: null,
};

test("profit uses the planned price until sold, then the real price", () => {
  assert.equal(profit(base), 981_520);
  const sold = markSold(base, 4_000_000, "2026-08-25");
  assert.equal(salePrice(sold), 4_000_000);
  assert.equal(profit(sold), 631_520);
  assert.equal(base.sold, false, "markSold must not mutate");
});

test("normalizeTrade fills defaults for old or partial documents", () => {
  const t = normalizeTrade("x", { item: "Kokulte", cost: 10, expected: 20, sold: true });
  assert.equal(t.cat, "craft");
  assert.equal(t.soldPrice, 20, "sold rows without soldPrice fall back to expected");
  assert.equal(t.soldDate, null);
  assert.equal(normalizeTrade("y", {}).item, "(sans nom)");
});

test("normalizeTrade treats stored data as untrusted", () => {
  const t = normalizeTrade("x", {
    date: "xx<img src=x onerror=alert(1)>-1-1",
    item: { toString: () => "<b>" },
    cost: "1000",
    sold: true,
    soldDate: "<script>",
    recipe: [[1, 2, 300], ["<img>", 1, 5], [3, "<b>", 5], [4, 1, null], "junk"],
    runes: "<b>",
    source: 7,
  });
  assert.equal(t.date, "1970-01-01");
  assert.equal(t.item, "(sans nom)");
  assert.equal(t.cost, 0);
  assert.equal(t.soldDate, null);
  assert.deepEqual(
    t.recipe,
    [
      [1, 2, 300],
      [4, 1, null],
    ],
    "only well-formed recipe lines are kept",
  );
  assert.equal("runes" in t, false);
  assert.equal("source" in t, false);
  assert.equal("recipe" in normalizeTrade("y", { recipe: [["bad"]] }), false, "no empty recipe left behind");
});

test("normalizeTrade keeps valid optional fields and unknown future fields", () => {
  const t = normalizeTrade("x", { ...base, runes: 50_000, source: "sheet", recipe: [[1, 2, null]], futureField: true });
  assert.equal(t.runes, 50_000);
  assert.equal(t.source, "sheet");
  assert.deepEqual(t.recipe, [[1, 2, null]]);
  assert.equal(t.futureField, true);
});

test("validateTrade reports readable errors", () => {
  assert.deepEqual(validateTrade(base), []);
  assert.equal(validateTrade({ ...base, item: " " }).length, 1);
  assert.match(validateTrade({ ...base, item: "x".repeat(201) })[0], /trop long/);
  assert.match(validateTrade({ ...base, cost: NaN })[0], /Investissement/);
  assert.match(validateTrade({ ...base, cost: -5 })[0], /Investissement/);
  assert.match(validateTrade({ ...base, expected: 1.5 })[0], /Vente prévue/);
  assert.match(validateTrade({ ...base, sold: true, soldPrice: null })[0], /vente/);
});

test("validateTrade checks dates are real and in order", () => {
  assert.match(validateTrade({ ...base, date: "2026-02-30" })[0], /Date invalide/);
  assert.match(
    validateTrade({ ...base, sold: true, soldPrice: 1, soldDate: "2026-13-01" })[0],
    /Date de vente invalide/,
  );
  assert.match(validateTrade({ ...base, sold: true, soldPrice: 1, soldDate: "2026-08-19" })[0], /avant/);
  assert.deepEqual(
    validateTrade({ ...base, sold: true, soldPrice: 1, soldDate: "2026-08-20" }),
    [],
    "same day is fine",
  );
  assert.deepEqual(
    validateTrade({ ...base, sold: true, soldPrice: 1, soldDate: null }),
    [],
    "unknown sale date is fine",
  );
});

test("toDocument drops the id and stamps version and time", () => {
  const doc = toDocument(base, new Date("2026-11-18T10:00:00Z"));
  assert.equal(doc.id, undefined);
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.updatedAt, "2026-11-18T10:00:00.000Z");
});

test("the auction tax is a percentage of the price, deducted from the profit", () => {
  const listed = { ...base, hdvTax: 2 };
  assert.equal(auctionTax(listed), 87_000, "2 % of the planned 4 350 000");
  assert.equal(profit(listed), 4_350_000 - 3_368_480 - 87_000);
  const sold = markSold(listed, 4_000_000, "2026-08-25");
  assert.equal(auctionTax(sold), 80_000, "once sold, 2 % of the real price");
  assert.equal(profit(sold), 4_000_000 - 3_368_480 - 80_000);
  assert.equal(auctionTax({ ...base, hdvTax: 1 }), 43_500, "1 % when the price was updated");
  assert.equal(auctionTax({ ...base, hdvTax: 0 }), 0, "no tax");
  assert.equal(auctionTax({ ...listed, expected: 1_234 }), 25, "rounded to whole kamas");
});

test("trades recorded before the tax option have no tax; unknown rates are refused", () => {
  assert.equal(normalizeTrade("old", { item: "x", cost: 1, expected: 2 }).hdvTax, 0);
  assert.equal(normalizeTrade("listed", { item: "x", hdvTax: 2 }).hdvTax, 2);
  assert.equal(normalizeTrade("updated", { item: "x", hdvTax: 1 }).hdvTax, 1);
  for (const bad of [3, "2", true, -1]) {
    assert.equal(normalizeTrade("bad", { item: "x", hdvTax: bad }).hdvTax, 0, String(bad));
    assert.match(validateTrade({ ...base, hdvTax: bad })[0], /Taxe HDV/, String(bad));
  }
});
