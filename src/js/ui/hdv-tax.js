/**
 * @file The auction-house tax choice, shared by the entry form, the sale form and the
 * edit dialog: its <option> list, and the rate the entry form starts with.
 */

import { HDV_TAX, HDV_TAX_LABEL } from "../config.js";

const PREFERENCE_KEY = "carnet-de-kamas.hdvTax";
const RATES = [HDV_TAX.LISTING, HDV_TAX.PRICE_UPDATE, HDV_TAX.NONE];

/**
 * The <option> elements of a tax <select>, values in percent.
 * @param {number} selected
 * @returns {string} HTML (labels are constants, nothing to escape)
 */
export function taxOptions(selected) {
  return RATES.map(
    (rate) => `<option value="${rate}" ${rate === selected ? "selected" : ""}>${HDV_TAX_LABEL[rate]}</option>`,
  ).join("");
}

/**
 * The rate the entry form starts with: the last one chosen on this browser, else the
 * listing tax, since most sales go through the auction house. Storage can be
 * unavailable (private window, blocked site data): the default is used then.
 * @returns {number}
 */
export function loadTaxPreference() {
  try {
    const saved = Number(localStorage.getItem(PREFERENCE_KEY));
    return localStorage.getItem(PREFERENCE_KEY) !== null && RATES.includes(saved) ? saved : HDV_TAX.LISTING;
  } catch {
    return HDV_TAX.LISTING;
  }
}

/** @param {number} rate */
export function saveTaxPreference(rate) {
  try {
    localStorage.setItem(PREFERENCE_KEY, String(rate));
  } catch {
    // Not remembered on this browser; the choice still applies to this trade.
  }
}
