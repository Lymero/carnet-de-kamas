// Small application modules with no DOM dependency: state, router, chart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveView } from "../src/js/router.js";
import { createState } from "../src/js/state.js";
import { monthlyProfitChart, niceStep } from "../src/js/ui/chart.js";

test("createState notifies only real changes, with the changed keys", () => {
  const state = createState({ a: 1, b: [] });
  const seen = [];
  const unsubscribe = state.subscribe((s, changed) => seen.push([s.a, [...changed]]));
  state.set({ a: 1 }); // same value: no notification
  state.set({ a: 2, b: state.get().b });
  unsubscribe();
  state.set({ a: 3 });
  assert.deepEqual(seen, [[2, ["a"]]]);
  assert.equal(state.get().a, 3);
});

test("resolveView honours the hash, else picks a sensible default", () => {
  assert.equal(resolveView("#analyse", true), "analyse");
  assert.equal(resolveView("", true), "en-cours");
  assert.equal(resolveView("", false), "historique");
  assert.equal(resolveView("#nope", false), "historique");
});

test("niceStep rounds up to 1, 2 or 5 × 10ⁿ", () => {
  assert.equal(niceStep(0.7), 1);
  assert.equal(niceStep(130), 200);
  assert.equal(niceStep(3_100_000), 5_000_000);
  assert.equal(niceStep(7), 10);
  assert.equal(niceStep(0), 1);
});

test("monthlyProfitChart draws one bar per month, losses in the 'bad' colour", () => {
  const svg = monthlyProfitChart([
    { month: "2026-09", profit: 1_500_000, count: 1 },
    { month: "2026-10", profit: -200_000, count: 3 },
  ]);
  assert.equal((svg.match(/<rect /g) ?? []).length, 2);
  assert.match(svg, /fill="var\(--bad\)"/);
  assert.match(svg, /septembre|sept\./);
  assert.match(svg, /\(1 vente\)/);
  assert.match(svg, /\(3 ventes\)/);
});
