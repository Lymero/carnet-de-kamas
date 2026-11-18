import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSheetPaste, toTsv, withoutDuplicates } from "../src/js/domain/sheet-io.js";

// Exactly what Google Sheets puts on the clipboard for the original tracker.
const PASTE = [
  "Date\tItem\tCatégorie\tInvestissement\tVente potentielle\tBénéfice\tBénéfice %\tVendu ?",
  "2026-08-20\tCape d'Ogivol\tCraft/FM\t3,368,480.00\t4,350,000.00\t981,520.00\t29.14\tTRUE",
  "2026-08-21\tKokulte\tAchat/revente\t6,500,000.00\t7,780,000.00\t1,280,000.00\t19.69\tFALSE",
  "not a row",
].join("\n");

test("parseSheetPaste reads a pasted sheet with header", () => {
  const { rows, invalid } = parseSheetPaste(PASTE);
  assert.equal(rows.length, 2);
  assert.equal(invalid, 1);
  assert.deepEqual(rows[0], {
    date: "2026-08-20",
    item: "Cape d'Ogivol",
    cat: "craft",
    cost: 3_368_480,
    expected: 4_350_000,
    sold: true,
    soldPrice: 4_350_000,
    soldDate: null,
    source: "sheet",
  });
  assert.equal(rows[1].cat, "resale");
  assert.equal(rows[1].sold, false);
});

test("parseSheetPaste works without header, with French dates and ; separators", () => {
  const { rows } = parseSheetPaste("20/08/2026;Coiffe d'Ogivol;Craft/FM;1 900 000;2 350 000;x;x;VRAI");
  assert.equal(rows[0].date, "2026-08-20");
  assert.equal(rows[0].cost, 1_900_000);
  assert.equal(rows[0].sold, true);
});

test("parseSheetPaste never invents sales when there is no 'Vendu ?' column", () => {
  const withHeader = parseSheetPaste("Date\tItem\tInvestissement\tVente\n2026-08-20\tCape\t1000\t2000").rows[0];
  assert.equal(withHeader.sold, false);
  assert.equal(withHeader.soldPrice, null);
  const noHeader = parseSheetPaste("2026-08-20\tCape\tCraft/FM\t1000\t1").rows[0];
  assert.equal(noHeader.sold, false, "a short row's last cell is not read as 'Vendu ?'");
});

test("parseSheetPaste skips rows that would fail validation", () => {
  const { rows, invalid } = parseSheetPaste(
    [
      "2026-13-45\tBad date\tCraft/FM\t1000\t2000",
      "2026-08-20\tNegative\tCraft/FM\t-1000\t2000",
      "2026-08-20\t\tCraft/FM\t1000\t2000",
      "2026-08-20\tSold before made\tCraft/FM\t1000\t2000\tx\tx\tTRUE\t2000\t2026-08-01",
      "2026-08-20\tGood\tCraft/FM\t1000\t2000",
    ].join("\n"),
  );
  assert.deepEqual(
    rows.map((r) => r.item),
    ["Good"],
  );
  assert.equal(invalid, 4);
});

test("withoutDuplicates matches each existing trade at most once", () => {
  const { rows } = parseSheetPaste(PASTE);
  const existing = [{ id: "s1", date: "2026-08-20", item: "Cape d'Ogivol (typo fixed)", cost: 3_368_480 }];
  const { fresh, duplicates } = withoutDuplicates(rows, existing);
  assert.equal(duplicates, 1, "the name may differ: date and amount identify the row");
  assert.deepEqual(
    fresh.map((r) => r.item),
    ["Kokulte"],
  );
});

test("withoutDuplicates keeps identical crafts made the same day", () => {
  const craft = { date: "2026-08-20", item: "Cape", cost: 1_000 };
  assert.equal(withoutDuplicates([craft, craft], []).fresh.length, 2);
  assert.equal(withoutDuplicates([craft, craft, craft], [{ ...craft, id: "a" }]).fresh.length, 2);
  const { fresh, duplicates } = withoutDuplicates(
    [craft, craft],
    [
      { ...craft, id: "a" },
      { ...craft, id: "b" },
    ],
  );
  assert.equal(fresh.length, 0, "pasting the same rows twice imports nothing the second time");
  assert.equal(duplicates, 2);
});

test("toTsv round-trips every stored figure through parseSheetPaste", () => {
  const trades = [
    {
      id: "a",
      date: "2026-08-20",
      item: "Cape d'Ogivol",
      cat: "craft",
      cost: 1_000,
      expected: 2_000,
      sold: true,
      soldPrice: 2_500,
      soldDate: "2026-09-02",
    },
    {
      id: "b",
      date: "2026-08-21",
      item: "Kokulte",
      cat: "resale",
      cost: 5_000,
      expected: 6_000,
      sold: false,
      soldPrice: null,
      soldDate: null,
    },
    {
      id: "c",
      date: "2026-08-22",
      item: "Gift",
      cat: "craft",
      cost: 0,
      expected: 10,
      sold: true,
      soldPrice: 10,
      soldDate: null,
    },
  ];
  const fields = ({ date, item, cat, cost, expected, sold, soldPrice, soldDate }) => ({
    date,
    item,
    cat,
    cost,
    expected,
    sold,
    soldPrice,
    soldDate,
  });
  const again = parseSheetPaste(toTsv(trades));
  assert.equal(again.invalid, 0);
  assert.deepEqual(again.rows.map(fields), trades.map(fields));
});

test("toTsv keeps one row per trade even with tabs or line breaks in a name", () => {
  const tsv = toTsv([
    {
      id: "a",
      date: "2026-08-20",
      item: "Cape\td'Ogivol\nbis",
      cat: "craft",
      cost: 1,
      expected: 2,
      sold: false,
      soldPrice: null,
      soldDate: null,
    },
  ]);
  const lines = tsv.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[1].split("\t")[1], "Cape d'Ogivol bis");
  assert.equal(lines[1].split("\t")[6], "100.00");
});
