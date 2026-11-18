/**
 * @file Parsing and formatting of kamas amounts and percentages. Pure functions only.
 *
 * Kamas are always whole numbers internally. Input is forgiving because players
 * type amounts the way they read them in game or copy them from spreadsheets.
 */

const NUMBER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
// French grouping uses a narrow no-break space, which the app's font (Barlow) has no
// glyph for: digits then look glued together. A regular no-break space reads well.
const NARROW_NO_BREAK_SPACE = String.fromCharCode(0x202f);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);
/** Thousands separators and stray characters that can appear in pasted amounts. */
const STRIP = /[\s\u00a0\u202f']/g;

/**
 * Parses a user-typed kamas amount.
 *
 * Accepted forms (all case-insensitive):
 * - suffixes: `250k`, `1.8m`, `3,5M`, `1,5kk` (kk = million, as players write it)
 * - grouped: `1 850 000`, `1,850,000.00` (English), `1.850.000,00` (French)
 * - plain: `3368480`, `-106492`
 *
 * A single separator followed by exactly three digits with no suffix (`1.500`)
 * is read as a thousands separator, since kamas have no decimals.
 *
 * @param {unknown} raw
 * @returns {number} a whole number of kamas, or NaN when the input is not an amount
 */
export function parseKamas(raw) {
  return Math.round(parseAmount(raw));
}

/** Operators accepted in calculations, with the symbols players may type for them. */
const OPERATORS = Object.freeze({ "+": "+", "-": "-", "−": "-", "*": "*", "×": "*", x: "*", "/": "/", "÷": "/" });
const MAX_EXPRESSION_LENGTH = 200;

/**
 * Reads a kamas field, which may hold a calculation: `1.2m + 350k + 80k`,
 * `3 x 450k`, `(2.6m - 100k) / 2`. Each number accepts every form `parseKamas`
 * does; operators are + - * / (also × x ÷), with the usual precedence and
 * parentheses. Only the final result is rounded to whole kamas.
 * @param {unknown} raw
 * @returns {number} a whole number of kamas, or NaN when the input is not a valid amount or calculation
 */
export function evaluateKamas(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text.length > MAX_EXPRESSION_LENGTH) return NaN;
  const tokens = tokenize(text);
  let index = 0;

  // Recursive descent: expression := term (± term)*, term := factor (×÷ factor)*,
  // factor := ± factor | ( expression ) | amount.
  const expression = () => {
    let value = term();
    while (tokens[index]?.op === "+" || tokens[index]?.op === "-") {
      value = tokens[index++].op === "+" ? value + term() : value - term();
    }
    return value;
  };
  const term = () => {
    let value = factor();
    while (tokens[index]?.op === "*" || tokens[index]?.op === "/") {
      value = tokens[index++].op === "*" ? value * factor() : value / factor();
    }
    return value;
  };
  const factor = () => {
    const token = tokens[index++];
    if (token?.op === "-") return -factor();
    if (token?.op === "+") return factor();
    if (token?.paren === "(") {
      const value = expression();
      return tokens[index++]?.paren === ")" ? value : NaN;
    }
    return token?.amount === undefined ? NaN : parseAmount(token.amount);
  };

  const value = expression();
  return index === tokens.length && Number.isFinite(value) ? Math.round(value) : NaN;
}

/**
 * True when a field holds a calculation rather than a single amount.
 * @param {unknown} raw
 */
export function isCalculation(raw) {
  return tokenize(String(raw ?? "").trim()).length > 1;
}

/**
 * Splits a calculation into amounts, operators and parentheses. Everything between
 * operators (digits, separators, spaces, k/m suffixes) is one amount.
 * @param {string} text
 * @returns {Array<{amount?: string, op?: string, paren?: string}>}
 */
function tokenize(text) {
  const tokens = [];
  let amount = "";
  const flush = () => {
    if (amount.trim()) tokens.push({ amount });
    amount = "";
  };
  for (const char of text) {
    const op = OPERATORS[char.toLowerCase()];
    if (op || char === "(" || char === ")") {
      flush();
      tokens.push(op ? { op } : { paren: char });
    } else {
      amount += char;
    }
  }
  flush();
  return tokens;
}

/**
 * The number written in `raw` (see `parseKamas`), not rounded, so that
 * calculations like `3 x 1.5` stay exact until their final result.
 * @param {unknown} raw
 * @returns {number} NaN when the input is not an amount
 */
function parseAmount(raw) {
  if (raw == null) return NaN;
  let s = String(raw)
    .toLowerCase()
    .replace(STRIP, "")
    .replace(/kamas?$/, "");
  if (!s) return NaN;

  let multiplier = 1;
  const suffix = s.match(/^(.*?)(kk|m|k)$/);
  if (suffix) {
    s = suffix[1];
    multiplier = suffix[2] === "k" ? 1e3 : 1e6;
  }

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  if (dots && commas) {
    // Whichever separator comes last is the decimal one.
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (dots + commas > 1) {
    s = s.replace(/[.,]/g, "");
  } else if (dots + commas === 1) {
    const [whole, fraction] = s.split(/[.,]/);
    s = multiplier === 1 && fraction.length === 3 ? whole + fraction : `${whole}.${fraction}`;
  }

  if (!/^-?\d*\.?\d+$/.test(s)) return NaN;
  return parseFloat(s) * multiplier;
}

/**
 * True for a storable amount: a whole, non-negative number of kamas.
 * @param {unknown} value
 * @returns {value is number}
 */
export function isKamas(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * Full amount with French digit grouping: 1850000 → "1 850 000".
 * @param {number|null|undefined} n
 * @returns {string} "—" for missing values
 */
export function formatKamas(n) {
  return n == null || Number.isNaN(n)
    ? "—"
    : NUMBER.format(Math.round(n)).replaceAll(NARROW_NO_BREAK_SPACE, NO_BREAK_SPACE);
}

/**
 * Short amount for tiles and charts: 1850000 → "1,85 M", 250000 → "250 k".
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function formatCompact(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e6)
    return `${sign}${(abs / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: abs >= 1e8 ? 0 : 2 })} M`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3).toLocaleString("fr-FR")} k`;
  return `${sign}${Math.round(abs)}`;
}

/**
 * Ratio as a percentage, e.g. profit over investment.
 * @param {number} part
 * @param {number} whole
 * @returns {number} NaN when `whole` is not positive
 */
export function ratioPercent(part, whole) {
  return whole > 0 ? (part / whole) * 100 : NaN;
}

/**
 * Signed percentage with one decimal: 18.42 → "+18,4 %".
 * @param {number} value
 * @returns {string}
 */
export function formatPercent(value) {
  if (Number.isNaN(value) || value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
}

/**
 * CSS class for a signed value: "pos", "neg" or "".
 * @param {number} value
 * @returns {"pos"|"neg"|""}
 */
export function signClass(value) {
  return value > 0 ? "pos" : value < 0 ? "neg" : "";
}
