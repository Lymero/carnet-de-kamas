import { test } from "node:test";
import assert from "node:assert/strict";
import { ItemCatalog, recipeCost } from "../src/js/data/catalog.js";

const data = {
  types: ["Cape", "Chapeau", "Ressource"],
  items: [
    [1, "Cape d'Ogivol", 186, 0],
    [2, "Coiffe d'Ogivol", 186, 1],
    [3, "Ogivolette", 50, 2],
    [4, "Cape Bouffante", 20, 0],
    [5, "Cape d'Ogivol", 1, 0], // same name, not craftable: must not shadow id 1
    [10, "Étoffe Mystérieuse", 150, 2],
  ],
  recipes: {
    1: [
      [10, 8],
      [3, 2],
    ],
    2: [[10, 4]],
  },
};
const catalog = new ItemCatalog(data);

test("findByName is accent/case-insensitive and prefers craftable duplicates", () => {
  assert.equal(catalog.findByName("cape d'ogivol").id, 1);
  assert.equal(catalog.ingredientName(10), "Étoffe Mystérieuse");
  assert.equal(catalog.ingredientName(999), "Ingrédient #999");
});

test("suggest puts own items first, then prefix matches, then substring matches", () => {
  const history = new Map([["coiffe d ogivol", { name: "Coiffe d'Ogivol", count: 8 }]]);
  const names = catalog.suggest("ogiv", history).map((s) => s.name);
  assert.deepEqual(names, ["Coiffe d'Ogivol", "Ogivolette", "Cape d'Ogivol"]);
  assert.equal(catalog.suggest("", history).length, 1, "empty query shows only own items");
  assert.equal(catalog.suggest("o", new Map()).length, 0, "below the minimum query length");
});

test("recipeCost sums priced ingredients and counts missing ones", () => {
  const prices = { 10: 1_000 };
  assert.deepEqual(
    recipeCost(data.recipes[1], (id) => prices[id], 500),
    { total: 8_500, missing: 1 },
  );
});

test("search ignores apostrophes, accents and ligatures", () => {
  assert.equal(catalog.suggest("cape d og", new Map())[0].name, "Cape d'Ogivol");
  assert.equal(catalog.suggest("etoffe myst", new Map())[0].name, "Étoffe Mystérieuse");
});
