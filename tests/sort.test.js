import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSort, sortHeader, sortRows } from "../src/js/ui/sort.js";

/** @type {import("../src/js/ui/sort.js").SortColumn<{name: string, n: number}>[]} */
const COLUMNS = [
  { key: "name", label: "Nom", value: (r) => r.name },
  { key: "n", label: "N", value: (r) => r.n, numeric: true },
];
const rows = [
  { name: "b", n: 1 },
  { name: "a", n: 1 },
  { name: "c", n: 3 },
];

test("sortRows sorts by the column, the tiebreak deciding between equals, without changing the input", () => {
  const byN = sortRows(rows, COLUMNS, { key: "n", dir: -1 }, (x, y) => x.name.localeCompare(y.name));
  assert.deepEqual(
    byN.map((r) => r.name),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    sortRows(rows, COLUMNS, { key: "name", dir: 1 }).map((r) => r.name),
    ["a", "b", "c"],
  );
});

test("nextSort starts text ascending and numbers descending, and a second click reverses", () => {
  assert.deepEqual(nextSort({ key: "n", dir: -1 }, "name", COLUMNS), { key: "name", dir: 1 });
  assert.deepEqual(nextSort({ key: "name", dir: 1 }, "n", COLUMNS), { key: "n", dir: -1 });
  assert.deepEqual(nextSort({ key: "n", dir: -1 }, "n", COLUMNS), { key: "n", dir: 1 });
  assert.deepEqual(nextSort({ key: "n", dir: -1 }, "nope", COLUMNS), { key: "n", dir: -1 });
});

test("sortHeader marks the sorted column with its arrow and aria-sort", () => {
  const html = sortHeader(COLUMNS, { key: "n", dir: -1 });
  assert.match(html, /<th class="" aria-sort="none"><button[^>]*data-sort="name">Nom<\/button>/);
  assert.match(html, /<th class="n" aria-sort="descending"><button[^>]*data-sort="n">N ↓<\/button>/);
});
