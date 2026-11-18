import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateKamas,
  formatCompact,
  formatKamas,
  formatPercent,
  isCalculation,
  isKamas,
  parseKamas,
  ratioPercent,
} from "../src/js/domain/kamas.js";

const NBSP = "\u00a0";
const NARROW_NBSP = "\u202f"; // what Intl uses to group French digits

test("parseKamas reads shorthand suffixes", () => {
  assert.equal(parseKamas("250k"), 250_000);
  assert.equal(parseKamas("1.8m"), 1_800_000);
  assert.equal(parseKamas("3,5M"), 3_500_000);
  assert.equal(parseKamas("1,5kk"), 1_500_000);
  assert.equal(parseKamas("2 kamas"), 2);
});

test("parseKamas reads grouped numbers in English and French formats", () => {
  assert.equal(parseKamas("1 850 000"), 1_850_000);
  assert.equal(parseKamas(`1${NBSP}850${NBSP}000`), 1_850_000);
  assert.equal(parseKamas(`1${NARROW_NBSP}850${NARROW_NBSP}000`), 1_850_000);
  assert.equal(parseKamas("1,850,000.00"), 1_850_000);
  assert.equal(parseKamas("1.850.000,00"), 1_850_000);
  assert.equal(parseKamas("173,796.00"), 173_796);
  assert.equal(parseKamas("-106,492.00"), -106_492);
});

test("parseKamas reads back what formatKamas writes", () => {
  for (const n of [0, 999, 1_850_000, 123_456_789]) assert.equal(parseKamas(formatKamas(n)), n);
});

test("parseKamas treats a lone 3-digit group as thousands", () => {
  assert.equal(parseKamas("1.500"), 1_500);
  assert.equal(parseKamas("1,5"), 2); // decimals are rounded: kamas are whole
});

test("parseKamas rejects non-amounts", () => {
  for (const bad of ["", "abc", "1.2.3x", null, undefined, "m", "--5"])
    assert.ok(Number.isNaN(parseKamas(bad)), String(bad));
});

test("isKamas accepts whole, non-negative numbers only", () => {
  assert.ok(isKamas(0));
  assert.ok(isKamas(1_850_000));
  for (const bad of [-1, 1.5, NaN, Infinity, "10", null]) assert.equal(isKamas(bad), false, String(bad));
});

test("formatting helpers", () => {
  assert.equal(formatCompact(31_019_030), "31,02 M");
  assert.equal(formatCompact(-2_436_000), "−2,44 M");
  assert.equal(formatCompact(700_000), "700 k");
  assert.equal(formatCompact(null), "—");
  assert.equal(formatKamas(NaN), "—");
  assert.equal(formatPercent(18.42), "+18,4 %");
  assert.equal(formatPercent(NaN), "—");
  assert.ok(Number.isNaN(ratioPercent(5, 0)));
});

test("evaluateKamas adds up, subtracts, multiplies and divides amounts", () => {
  assert.equal(evaluateKamas("1.2m + 350k + 80k"), 1_630_000);
  assert.equal(evaluateKamas("2.6m - 100k"), 2_500_000);
  assert.equal(evaluateKamas("3 x 450k"), 1_350_000);
  assert.equal(evaluateKamas("3X450k"), 1_350_000);
  assert.equal(evaluateKamas("3 × 1.5m"), 4_500_000, "decimals kept until the end");
  assert.equal(evaluateKamas("(2.6m - 100k) / 2"), 1_250_000);
  assert.equal(evaluateKamas("1 + 2 * 3"), 7, "multiplication first");
  assert.equal(evaluateKamas("1 850 000 - 50 000"), 1_800_000, "spaces still group digits");
  assert.equal(evaluateKamas("1,850,000.00 + 1.850.000,00"), 3_700_000);
  assert.equal(evaluateKamas("10 / 3"), 3, "the result is rounded to whole kamas");
});

test("evaluateKamas reads single amounts like parseKamas", () => {
  for (const amount of ["250k", "1.8m", "1,5kk", "1 850 000", "-106,492.00", "1.500", "2 kamas"]) {
    assert.equal(evaluateKamas(amount), parseKamas(amount), amount);
  }
});

test("evaluateKamas rejects incomplete or invalid calculations", () => {
  for (const bad of [
    "1.2m +",
    "+",
    "(1 + 2",
    "1 + 2)",
    "2 / 0",
    "abc + 1",
    "x5",
    "1 ++ 2 x",
    "",
    null,
    "1+".repeat(150),
  ]) {
    assert.ok(Number.isNaN(evaluateKamas(bad)), String(bad));
  }
});

test("isCalculation tells a calculation from a single amount", () => {
  assert.equal(isCalculation("1.2m + 350k"), true);
  assert.equal(isCalculation("1 850 000"), false);
  assert.equal(isCalculation("250k"), false);
  assert.equal(isCalculation(""), false);
});
