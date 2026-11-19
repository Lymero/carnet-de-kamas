import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENCE_MIN,
  overlappingLines,
  purchaseTotal,
  readOcrLine,
  readOcrLines,
  reviewLines,
} from "../src/js/domain/purchases.js";

/**
 * A line as the text reader returns it: its words split on spaces, all at `confidence`
 * unless `doubts` lowers some, on row `row` of a chat with 17 px between lines.
 * @param {string} text
 * @param {{row?: number, confidence?: number, doubts?: Record<string, number>}} [options]
 */
function ocr(text, { row = 0, confidence = 95, doubts = {} } = {}) {
  return {
    text,
    words: text.split(" ").map((word) => ({ text: word, confidence: doubts[word] ?? confidence })),
    box: { x0: 2, y0: 21 + row * 17, x1: 300, y1: 34 + row * 17 },
  };
}
const read = (text, options) => readOcrLine(ocr(text, options));
const fields = ({ quantity, item, price, sure }) => ({ quantity, item, price, sure });

test("readOcrLine reads clean lines, with any thousands spaces", () => {
  assert.deepEqual(fields(read("10 x [Griffe de Buboxor] (228 223 kamas)")), {
    quantity: 10,
    item: "Griffe de Buboxor",
    price: 228223,
    sure: true,
  });
  assert.deepEqual(fields(read("1 x [Serre d'Ikargn] (800 kamas)")), {
    quantity: 1,
    item: "Serre d'Ikargn",
    price: 800,
    sure: true,
  });
  assert.equal(read("1 x [Œil de Harpille] (9 889 kamas)").price, 9889);
  assert.equal(read("1 × [Boucle des Égarés] (1234567 kamas).").price, 1234567);
});

test("readOcrLine forgives the reader's usual slips without doubting the price", () => {
  // As read from a real screenshot: timestamp debris, "komas", "1x" glued, ’ for '.
  for (const [text, quantity, item, price] of [
    ["| 1 x [Serre d'Ikargn] (800 komas)", 1, "Serre d'Ikargn", 800],
    [";} 1 x [Serre d’Ikargn] (952 kamos)", 1, "Serre d'Ikargn", 952],
    ["1] 10 x (Œil de Harpille] (9 889 kormas)", 10, "Œil de Harpille", 9889],
    ["| 1x [Corne de Méjaire] (1 589 kamas)", 1, "Corne de Méjaire", 1589],
    [')] 10 x [Serre d"Ikargn) (9 788 komes)', 10, 'Serre d"Ikargn', 9788],
  ]) {
    assert.deepEqual(fields(read(text)), { quantity, item, price, sure: true }, text);
  }
  // "1" read as a letter is still one item.
  assert.equal(read("| Lx [Corne de Méjaire] (1 590 komas)").quantity, 1);
});

test("readOcrLine doubts garbled or unconfident prices", () => {
  const doubtful = [
    ["| 1 x [Corne de Méjaire] (1 89% kamas", NaN], // a symbol among the digits
    ["| 1x [Corne de Méjaire] (? 056 komas)", NaN],
    ["| Lx [Corne de Méjaire] (1 5u9 komas)", NaN],
    ["1 1x [Griffe de Buboxor] (21 75 kamas)", 2175], // a group of two digits
    ["1x [Serre] (1O0 kamas)", 100], // a letter for a digit
    ["1 x [Serre] (1,500 kamas)", 1500], // another separator
  ];
  for (const [text, price] of doubtful) {
    const line = read(text);
    assert.equal(line.sure, false, text);
    assert.deepEqual(line.price, price, text);
  }
  // Clean text, but the reader was not sure of a digit group.
  const unsure = read("| 1 x [Corne de Méjaire] (1 400 kamas)", { doubts: { 400: CONFIDENCE_MIN - 1 } });
  assert.equal(unsure.price, 1400);
  assert.equal(unsure.sure, false);
  // Doubt about the debris or the name does not matter.
  assert.equal(read("|| 1 x [Serre] (952 kamas)", { doubts: { "||": 0, "[Serre]": 20 } }).sure, true);
  // A purchase whose price is missing altogether is kept, to be filled in.
  assert.deepEqual(fields(read("1 x [Corne de Méjaire]")), {
    quantity: 1,
    item: "Corne de Méjaire",
    price: NaN,
    sure: false,
  });
  assert.equal(read("(800 kamas)").sure, false, "a price without its lot");
});

test("readOcrLine leaves out other chat lines", () => {
  for (const text of [
    "Vous êtes arrivé à destination !",
    "1] Vous étes arrivé & destination !",
    "",
    "[Commerce] Bob : je vends 3 x 100 kamas",
    "Bonjour (pas de prix ici)",
  ]) {
    assert.equal(read(text), null, text);
  }
  assert.equal(readOcrLine(/** @type {any} */ (null)), null);
});

test("readOcrLines keeps purchases in order and notices skipped lines", () => {
  const lines = readOcrLines([
    ocr("Vous êtes arrivé à destination !", { row: 0 }),
    ocr("1 x [Serre] (800 kamas)", { row: 1 }),
    ocr("1 x [Serre] (951 kamas)", { row: 2 }),
    // rows 3 and 4: nothing found
    ocr("1 x [Serre] (952 kamas)", { row: 5 }),
    ocr("1 x [Serre] (952 kamas)", { row: 6 }),
    ocr("Vous êtes arrivé à destination !", { row: 7 }),
    // row 8 empty, between a chat line and a purchase: not a skipped purchase
    ocr("10 x [Griffe] (228 223 kamas)", { row: 9 }),
  ]);
  assert.deepEqual(
    lines.map((line) => (line.skipped ? "skipped" : line.price)),
    [800, 951, "skipped", "skipped", 952, 952, 228223],
  );
  const skipped = lines[2];
  assert.equal(skipped.sure, false);
  assert.deepEqual(skipped.box, { x0: 2, y0: 21 + 3 * 17, x1: 300, y1: 21 + 4 * 17 });
  assert.deepEqual(readOcrLines(/** @type {any} */ ("nothing")), []);
  assert.equal(readOcrLines([ocr("1 x [A] (5 kamas)")]).length, 1, "one line, no spacing to compare");
});

test("overlappingLines finds the lines repeated where screenshots overlap, in either order", () => {
  const lot = (quantity, item, price) => ({ quantity, item, price });
  const a = [lot(1, "Serre", 800), lot(1, "Serre", 951), lot(1, "Griffe", 21798), lot(10, "Griffe", 228223)];
  const b = [lot(1, "Griffe", 21798), lot(10, "Griffe", 228223), lot(10, "Œil", 9889)];
  assert.deepEqual([...overlappingLines(a, b)], [0, 1]);
  // Picked in reverse: the end of the second is the start of the first.
  assert.deepEqual([...overlappingLines(a.slice(0, 2), [lot(9, "X", 1), a[0]])], [1]);
  assert.deepEqual([...overlappingLines(a, [lot(3, "Autre", 5)])], []);
  assert.deepEqual([...overlappingLines([], a)], []);
  // Accents and case do not hide a repeat; unreadable prices never make one.
  assert.deepEqual([...overlappingLines([lot(1, "Œil de Harpille", 5)], [lot(1, "oeil de harpille", 5)])], [0]);
  assert.deepEqual([...overlappingLines([lot(1, "A", NaN)], [lot(1, "A", NaN)])], []);
});

test("reviewLines flags what to check and leaves probable repeats out of the total", () => {
  const first = readOcrLines([ocr("1 x [Serre] (952 kamas)", { row: 0 }), ocr("1 x [Serre] (952 kamas)", { row: 1 })]);
  const second = readOcrLines([
    ocr("1 x [Serre] (952 kamas)", { row: 0 }),
    ocr("1 x [Griffe] (21 79 kamas)", { row: 1 }),
    ocr("1 x [Griffe] (21 798 kamas)", { row: 3 }),
  ]);
  const lines = reviewLines([first, second]);
  assert.deepEqual(
    lines.map(({ shot, counted, flag, price }) => ({ shot, counted, flag, price })),
    [
      { shot: 0, counted: true, flag: "", price: 952 },
      { shot: 0, counted: true, flag: "", price: 952 },
      { shot: 1, counted: false, flag: "overlap", price: 952 },
      { shot: 1, counted: true, flag: "check", price: 2179 },
      { shot: 1, counted: true, flag: "skipped", price: NaN },
      { shot: 1, counted: true, flag: "", price: 21798 },
    ],
  );
  assert.ok(lines[0].box, "each line knows where it is in its screenshot");
  assert.equal(
    purchaseTotal(lines.filter((line) => line.counted && !Number.isNaN(line.price))),
    952 * 2 + 2179 + 21798,
  );
});
