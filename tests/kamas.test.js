import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatCompact,
  formatKamas,
  formatPercent,
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
