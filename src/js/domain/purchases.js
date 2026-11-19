/**
 * @file Purchases read from chat screenshots: reading each line the text reader (OCR)
 * found against the game's format, despite its usual slips; noticing lines it skipped;
 * spotting lines repeated where two screenshots overlap; and the total that goes into
 * the investment field.
 *
 * The game writes one chat line per purchase, `N x [Item name] (price kamas)`, where
 * the price is the total paid for the lot and uses spaces as thousands separators
 * (`10 x [Griffe de Buboxor] (228 223 kamas)`). Other chat lines are not purchases.
 *
 * Each screenshot is read several times, prepared a little differently each time; a
 * price counts as read when most readings agree on it (`combineReadings`).
 *
 * Nothing here trusts the reader: every line that might be wrong is flagged for the
 * player, who checks the list before the total is used.
 */

import { normalize } from "./text.js";

/**
 * @typedef {Object} Box  A rectangle in the screenshot, in pixels.
 * @property {number} x0
 * @property {number} y0
 * @property {number} x1
 * @property {number} y1
 */

/**
 * @typedef {Object} OcrLine  A line of text as the reader found it (untrusted).
 * @property {string} text
 * @property {{text: string, confidence: number}[]} words  confidence from 0 to 100
 * @property {Box} box
 */

/**
 * @typedef {Object} PurchaseLine  A purchase line read from a screenshot.
 * @property {string} text      the line as read ("" for a skipped line)
 * @property {number} quantity  NaN when unreadable
 * @property {string} item
 * @property {number} price     total price of the lot; NaN when unreadable
 * @property {boolean} sure     quantity, name and a cleanly grouped price, with confident digits
 * @property {boolean} skipped  a gap where the reader found no line, though one should be
 * @property {Box|null} box
 */

/** Spaces the game or a copy may use between thousands: space, no-break and narrow no-break space. */
const SPACE = "[ \\u00a0\\u202f]";
const AMOUNT = `\\d{1,3}(?:${SPACE}\\d{3})+|\\d+`;

/**
 * The price at the end of a line, as the reader may garble it: brackets read as other
 * brackets, "kamas" as "komas" or "kamos", digits as look-alike letters or symbols
 * ("1 89%"). Group: the price, with at least one digit; `readAmount` decides.
 */
const LOOSE_PRICE = /[([{]\s*([^()[\]{}]*?\d[^()[\]{}]*?)\s*k[a-z]{2,6}\s*[)\]}|]?\s*[.!]?\s*$/iu;

/**
 * What comes before the price: `N x [Item]`, with "1" possibly read as a letter and the
 * brackets as other brackets. Groups: quantity, item.
 */
const LOOSE_LOT = /(\d{1,5}|[lItLi|!])\s*[x×X]\s*[[({|]?\s*(.+?)\s*[\])}|]?\s*$/u;

/** Letters the reader takes for digits. */
const DIGIT_LOOKALIKES = { O: "0", o: "0", I: "1", l: "1", "|": "1", S: "5", B: "8" };

/** Below this confidence (0 to 100), a digit of the price is flagged. */
export const CONFIDENCE_MIN = 90;

/** Longest item name kept (in-game names are well under this). */
const ITEM_MAX = 200;
/** Largest amount accepted: far above any real price, and safely an integer. */
const AMOUNT_MAX = 1e13;
/** A gap this many times the usual line spacing means the reader skipped a line. */
const GAP_FACTOR = 1.6;

/**
 * Reads one line found by the text reader, forgiving its usual slips ("komas", "Lx",
 * brackets read as parentheses). A line with a quantity, a name and a cleanly grouped
 * price whose digits the reader was confident about is `sure`; any other is not.
 * Lines that are clearly not purchases give null.
 * @param {OcrLine} line
 * @returns {PurchaseLine|null}
 */
export function readOcrLine(line) {
  const text = String(line?.text ?? "")
    .replace(/[’‘`´]/g, "'")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const box = line?.box ?? null;
  const priceMatch = LOOSE_PRICE.exec(text);
  const before = priceMatch ? text.slice(0, priceMatch.index) : text;
  const lot = LOOSE_LOT.exec(before);
  // Without a price that ends in "k…" nor an "N x [" start, it is another chat line.
  if (!priceMatch && !(lot && /[x×X]\s*[[({]/u.test(before))) return null;
  if (!lot && !priceMatch) return null;

  const price = priceMatch ? readAmount(priceMatch[1]) : { value: NaN, clean: false };
  const quantity = lot ? (/\d/.test(lot[1]) ? Number(lot[1]) : 1) : NaN;
  const item = lot ? lot[2].replace(/^[[({|]+|[\])}|]+$/g, "").trim() : "";
  const confident = priceWords(line).every((word) => word.confidence >= CONFIDENCE_MIN);
  const complete = Boolean(lot) && isCount(quantity) && item.length > 0;
  return {
    text,
    quantity: isCount(quantity) ? quantity : NaN,
    item: item.slice(0, ITEM_MAX),
    price: price.value,
    sure: complete && price.clean && confident,
    skipped: false,
    box,
  };
}

/**
 * The purchase lines of one screenshot, in order, from the lines the reader found.
 * Where the spacing between two purchase lines leaves room for more, the reader
 * probably skipped them: each gets a `skipped` entry, so the player sees it.
 * @param {OcrLine[]} lines  all the lines found, purchases or not
 * @returns {PurchaseLine[]}
 */
export function readOcrLines(lines) {
  const read = (Array.isArray(lines) ? lines : []).map((line) => ({ line, purchase: readOcrLine(line) }));
  const pitch = linePitch(read.map(({ line }) => line?.box).filter(Boolean));
  /** @type {PurchaseLine[]} */
  const result = [];
  /** @type {Box|null} */
  let previous = null;
  for (const { line, purchase } of read) {
    const box = line?.box ?? null;
    if (purchase) {
      if (previous && box && pitch) {
        const missing = Math.round((box.y0 - previous.y0) / pitch) - 1;
        if (box.y0 - previous.y0 > GAP_FACTOR * pitch) {
          for (let i = 1; i <= missing; i += 1) {
            const y0 = previous.y0 + i * pitch;
            result.push({
              text: "",
              quantity: NaN,
              item: "",
              price: NaN,
              sure: false,
              skipped: true,
              box: { x0: Math.min(previous.x0, box.x0), y0, x1: Math.max(previous.x1, box.x1), y1: y0 + pitch },
            });
          }
        }
      }
      result.push(purchase);
    }
    // Gaps are measured between purchase lines only: other chat lines reset the reference.
    if (box) previous = purchase ? box : null;
  }
  return result;
}

/**
 * Combines several readings of the same screenshot (each from `readOcrLines`), line by
 * line: a price is kept when more than half of the readings found it, and a line is
 * `sure` only when every reading found the same price and at least one was sure of it.
 * Lines follow the first reading; a line it skipped is filled in when the others agree.
 * Different preparations of the picture make different mistakes, so agreeing readings
 * are far more often right than any single one.
 * @param {PurchaseLine[][]} readings  the first one gives the lines
 * @returns {PurchaseLine[]}
 */
export function combineReadings(readings) {
  const [first = [], ...others] = readings;
  if (others.length === 0) return first;
  return first.map((line) => {
    const versions = [line, ...others.map((lines) => sameLine(line, lines))];
    const counts = new Map();
    for (const version of versions) {
      if (version && !Number.isNaN(version.price)) counts.set(version.price, (counts.get(version.price) ?? 0) + 1);
    }
    const [price, votes] = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [NaN, 0]);
    if (votes * 2 <= versions.length) return { ...line, sure: false };
    const agreeing = versions.filter((version) => version?.price === price);
    const source = line.skipped ? /** @type {PurchaseLine} */ (agreeing[0]) : line;
    return {
      ...source,
      box: line.box,
      price,
      sure: votes === versions.length && agreeing.some((version) => version?.sure),
    };
  });
}

/**
 * The line of `lines` at the same height as `line`, if any.
 * @param {PurchaseLine} line
 * @param {PurchaseLine[]} lines
 */
function sameLine(line, lines) {
  if (!line.box) return null;
  const middle = (/** @type {Box} */ box) => (box.y0 + box.y1) / 2;
  const reach = Math.max(4, (line.box.y1 - line.box.y0) / 2);
  let best = null;
  let distance = reach;
  for (const other of lines) {
    if (!other.box || other.skipped) continue;
    const d = Math.abs(middle(other.box) - middle(line.box));
    if (d < distance) [best, distance] = [other, d];
  }
  return best;
}

/**
 * Where two screenshots of the same chat overlap, the same lines appear at the end of
 * one and the start of the other (or the other way round, when they were picked in
 * reverse order). Returns which lines of `next` are probably those repeats.
 *
 * Buying the same lot several times in a row also writes identical lines, so this can
 * only be a guess: the lines are flagged for the player to confirm, never removed.
 * @param {{quantity: number, item: string, price: number}[]} previous
 * @param {{quantity: number, item: string, price: number}[]} next
 * @returns {Set<number>}  indexes into `next`
 */
export function overlappingLines(previous, next) {
  const a = previous.map((line, i) => lineKey(line, `a${i}`));
  const b = next.map((line, i) => lineKey(line, `b${i}`));
  const after = sharedEdge(a, b); // end of previous = start of next
  const before = sharedEdge(b, a); // end of next = start of previous
  const indexes =
    after >= before
      ? Array.from({ length: after }, (_, i) => i)
      : Array.from({ length: before }, (_, i) => b.length - before + i);
  return new Set(indexes);
}

/**
 * @typedef {Object} ReviewLine  A line of the list the player checks before using the total.
 * @property {number} shot      index of the screenshot it was read from (-1: added by hand)
 * @property {string} text      the line as read
 * @property {number} quantity  NaN while unreadable
 * @property {string} item
 * @property {number} price     NaN while unreadable
 * @property {boolean} counted  part of the total
 * @property {""|"check"|"skipped"|"overlap"} flag  why the player should look at it: the
 *   reading is doubtful, the reader skipped the line, or the line probably repeats the
 *   edge of the previous screenshot
 * @property {Box|null} box     where it is in its screenshot
 */

/**
 * The list to review, from the lines of each screenshot in order. Probable repeats
 * where consecutive screenshots overlap start out not counted; skipped lines are
 * counted, with no price, so the total cannot be used until the player deals with them.
 * @param {PurchaseLine[][]} perShot
 * @returns {ReviewLine[]}
 */
export function reviewLines(perShot) {
  return perShot.flatMap((lines, shot) => {
    const repeats = shot > 0 ? overlappingLines(perShot[shot - 1], lines) : new Set();
    return lines.map((line, i) => {
      /** @type {ReviewLine["flag"]} */
      const flag = repeats.has(i) ? "overlap" : line.skipped ? "skipped" : line.sure ? "" : "check";
      return {
        shot,
        text: line.text,
        quantity: line.quantity,
        item: line.item,
        price: line.price,
        counted: flag !== "overlap",
        flag,
        box: line.box,
      };
    });
  });
}

/**
 * The unit price of each ingredient of a recipe, from the lots bought: what was paid for
 * an ingredient divided by how many were bought, rounded to the kamas. Names are matched
 * ignoring case, accents and punctuation, and forgiving a letter or two misread.
 * @param {{quantity: number, item: string, price: number}[]} lines  the lots counted
 * @param {{id: number, name: string}[]} ingredients
 * @returns {{prices: Record<number, number>, used: Set<number>}}  `used`: indexes of the lines
 *   that are ingredients
 */
export function ingredientPrices(lines, ingredients) {
  const names = ingredients.map(({ id, name }) => ({ id, key: normalize(name) }));
  /** @type {Map<number, {quantity: number, price: number}>} */
  const bought = new Map();
  const used = new Set();
  lines.forEach((line, i) => {
    if (!isCount(line.quantity) || !isAmount(line.price)) return;
    const id = closestName(normalize(line.item), names);
    if (!id) return;
    const sum = bought.get(id) ?? { quantity: 0, price: 0 };
    sum.quantity += line.quantity;
    sum.price += line.price;
    bought.set(id, sum);
    used.add(i);
  });
  const prices = Object.fromEntries([...bought].map(([id, sum]) => [id, Math.round(sum.price / sum.quantity)]));
  return { prices, used };
}

/**
 * The ingredient whose name is closest to `key`, allowing about one misread letter in eight.
 * @param {string} key
 * @param {{id: number, key: string}[]} names
 */
function closestName(key, names) {
  if (!key) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const name of names) {
    const distance = editDistance(key, name.key);
    if (distance < bestDistance) [best, bestDistance] = [name.id, distance];
  }
  return bestDistance <= Math.floor(key.length / 8) ? best : null;
}

/**
 * Letters to add, remove or change to turn `a` into `b`.
 * @param {string} a
 * @param {string} b
 */
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= b.length; j += 1) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

/**
 * Sum of the lots' prices.
 * @param {{price: number}[]} lines
 * @returns {number}
 */
export function purchaseTotal(lines) {
  return lines.reduce((sum, line) => sum + line.price, 0);
}

/**
 * The price as read: look-alike letters become digits, and thousands must come in
 * groups of three. `clean` is false when anything had to be forgiven.
 * @param {string} raw
 * @returns {{value: number, clean: boolean}}
 */
function readAmount(raw) {
  const spaced = raw.trim().replace(/[.,]/g, " ").replace(/\s+/g, " ");
  const digits = spaced.replace(/[OoIl|SB]/g, (c) => DIGIT_LOOKALIKES[c]);
  if (!/^[\d ]+$/.test(digits)) return { value: NaN, clean: false };
  const value = Number(digits.replace(/ /g, ""));
  if (!isAmount(value)) return { value: NaN, clean: false };
  const grouped = new RegExp(`^(?:${AMOUNT})$`).test(digits);
  return { value, clean: grouped && digits === spaced && spaced === raw.trim() };
}

/**
 * The words of the price: from the last one holding "(" (or a look-alike) to the end.
 * @param {OcrLine} line
 */
function priceWords(line) {
  const words = Array.isArray(line?.words) ? line.words : [];
  let start = words.length;
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (/[([{]/.test(String(words[i]?.text))) {
      start = i;
      break;
    }
  }
  return words.slice(start).filter((word) => /\d/.test(String(word?.text)));
}

/**
 * The usual vertical distance between two lines, or 0 when unknown.
 * @param {Box[]} boxes
 */
function linePitch(boxes) {
  const steps = [];
  for (let i = 1; i < boxes.length; i += 1) {
    const step = boxes[i].y0 - boxes[i - 1].y0;
    if (step > 0) steps.push(step);
  }
  if (steps.length < 2) return 0;
  steps.sort((a, b) => a - b);
  // The lower median: with few lines, a gap must not pass for the usual spacing.
  return steps[Math.floor((steps.length - 1) / 2)];
}

/**
 * The largest `n` such that the last `n` keys of `first` are the first `n` of `second`.
 * @param {string[]} first
 * @param {string[]} second
 */
function sharedEdge(first, second) {
  for (let n = Math.min(first.length, second.length); n > 0; n -= 1) {
    let same = true;
    for (let i = 0; i < n && same; i += 1) same = first[first.length - n + i] === second[i];
    if (same) return n;
  }
  return 0;
}

/**
 * Unreadable lines get a key of their own, so they never count as repeats.
 * @param {{quantity: number, item: string, price: number}} line
 * @param {string} unique
 */
const lineKey = (line, unique) =>
  Number.isNaN(line.price) ? `?${unique}` : `${line.quantity}|${normalize(line.item)}|${line.price}`;

/** @param {number} n */
const isCount = (n) => Number.isInteger(n) && n > 0 && n <= AMOUNT_MAX;

/** @param {number} n */
const isAmount = (n) => Number.isInteger(n) && n >= 0 && n <= AMOUNT_MAX;
