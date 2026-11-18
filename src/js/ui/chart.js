/**
 * @file Monthly profit bar chart, drawn as inline SVG (no chart library needed
 * for one chart). Colours come from CSS tokens so both themes work.
 */

import { monthLabel } from "../domain/dates.js";
import { formatCompact, formatKamas } from "../domain/kamas.js";
import { plural } from "../domain/text.js";

const SIZE = Object.freeze({ width: 720, height: 220, left: 56, right: 10, top: 16, bottom: 34 });

/**
 * Rounds a raw step up to 1, 2 or 5 × 10ⁿ so axis labels are readable.
 * @param {number} raw
 * @returns {number}
 */
export function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * power;
}

/**
 * @param {{month: string, profit: number, count: number}[]} months  oldest first
 * @returns {string} SVG markup
 */
export function monthlyProfitChart(months) {
  const { width: W, height: H, left: L, right: R, top: T, bottom: B } = SIZE;
  let max = Math.max(0, ...months.map((m) => m.profit));
  let min = Math.min(0, ...months.map((m) => m.profit));
  if (max === min) max = min + 1;
  const step = niceStep((max - min) / 4);
  max = Math.ceil(max / step) * step;
  min = Math.floor(min / step) * step;

  const y = (v) => T + ((max - v) / (max - min)) * (H - T - B);
  const band = (W - L - R) / Math.max(1, months.length);

  let grid = "";
  for (let v = min; v <= max + step / 1e6; v += step) {
    const zero = Math.abs(v) < step / 1e6;
    grid +=
      `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${zero ? "var(--muted)" : "var(--line)"}"/>` +
      `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${formatCompact(zero ? 0 : v)}</text>`;
  }

  const bars = months
    .map((m, i) => {
      const x = L + i * band + band * 0.18;
      const w = band * 0.64;
      const y0 = y(0);
      const y1 = y(m.profit);
      const cx = x + w / 2;
      const label = `${monthLabel(m.month)} : ${formatKamas(m.profit)} kamas (${plural(m.count, "vente")})`;
      return (
        `<rect x="${x}" y="${Math.min(y0, y1)}" width="${w}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="2" fill="${m.profit >= 0 ? "var(--accent)" : "var(--bad)"}"><title>${label}</title></rect>` +
        `<text class="value" x="${cx}" y="${m.profit >= 0 ? y1 - 4 : y1 + 12}" text-anchor="middle">${formatCompact(m.profit)}</text>` +
        `<text x="${cx}" y="${H - B + 16}" text-anchor="middle">${monthLabel(m.month, { short: true })}</text>` +
        `<text x="${cx}" y="${H - B + 29}" text-anchor="middle">${m.count} v.</text>`
      );
    })
    .join("");

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bénéfice réalisé par mois">${grid}${bars}</svg>`;
}
