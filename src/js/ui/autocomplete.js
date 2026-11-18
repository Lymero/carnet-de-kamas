/**
 * @file Accessible combobox for the item field (WAI-ARIA combobox pattern).
 *
 * The component only handles display and keyboard interaction; suggestions
 * come from the `getSuggestions` callback (ItemCatalog.suggest).
 */

import { closest, esc } from "./dom.js";

/** @typedef {import("../data/catalog.js").Suggestion} Suggestion */

/**
 * @param {{
 *   input: HTMLInputElement,
 *   list: HTMLElement,
 *   getSuggestions: (query: string) => Suggestion[],
 *   onPick: (s: Suggestion) => void,
 *   onInput?: () => void,
 * }} options
 * @returns {{close: () => void}}
 */
export function attachAutocomplete({ input, list, getSuggestions, onPick, onInput = () => {} }) {
  /** @type {Suggestion[]} */
  let items = [];
  let active = -1;

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function open() {
    items = getSuggestions(input.value);
    if (!items.length || document.activeElement !== input) return close();
    active = Math.min(active, items.length - 1);
    list.innerHTML = items
      .map(
        (s, i) =>
          `<div role="option" id="${list.id}-${i}" data-i="${i}" aria-selected="${i === active}" class="${s.own ? "mine" : ""}"><span>${esc(s.name)}</span><small>${esc(s.detail)}</small></div>`,
      )
      .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (active >= 0) input.setAttribute("aria-activedescendant", `${list.id}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function pick(i) {
    const s = items[i];
    if (!s) return;
    input.value = s.name;
    close();
    onPick(s);
  }

  input.addEventListener("input", () => {
    active = -1;
    open();
    onInput();
  });
  input.addEventListener("focus", open);
  // Delay so a click on an option registers before the list disappears.
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      active = Math.min(active + 1, items.length - 1);
      open();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = Math.max(active - 1, 0);
      open();
      e.preventDefault();
    } else if (e.key === "Enter" && active >= 0) {
      pick(active);
      e.preventDefault();
    } else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => {
    const option = closest(e, "[data-i]");
    if (!option) return;
    e.preventDefault();
    pick(Number(option.dataset.i));
  });

  return { close };
}
