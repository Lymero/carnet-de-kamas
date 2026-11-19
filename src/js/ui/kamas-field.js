/**
 * @file Calculator behaviour for every kamas field (`input.kamas`), wherever it is
 * rendered: the form, the recipe box, the sale form, the edit dialog.
 *
 * While a calculation is typed ("1.2m + 350k"), a small bubble under the field shows
 * its result; when the field loses focus, what was typed (a calculation, "1.2m",
 * "100000") is replaced by the amount written in full with its separators.
 * Code reading the field always goes through `evaluateKamas`, so it gets the same
 * number before and after. Events are delegated from the document, so fields
 * rendered later need no setup.
 */

import { evaluateKamas, formatKamas, isCalculation } from "../domain/kamas.js";

/** Installs the behaviour once for the whole page. */
export function enableKamasFields() {
  const bubble = document.createElement("div");
  bubble.className = "calc";
  bubble.hidden = true;
  // Visual aid only: the result replaces the calculation on blur, where assistive tech reads it.
  bubble.setAttribute("aria-hidden", "true");

  /** @param {EventTarget|null} target @returns {HTMLInputElement|null} */
  const kamasField = (target) =>
    target instanceof HTMLInputElement && target.classList.contains("kamas") ? target : null;

  /** @param {HTMLInputElement} input */
  function show(input) {
    if (!isCalculation(input.value)) {
      bubble.hidden = true;
      return;
    }
    const value = evaluateKamas(input.value);
    bubble.textContent = Number.isNaN(value) ? "Calcul incomplet" : `= ${formatKamas(value)}`;
    bubble.classList.toggle("bad", Number.isNaN(value));
    // Inside a modal dialog (top layer), the bubble must be in the dialog to be seen.
    const host = input.closest("dialog") ?? document.body;
    if (bubble.parentElement !== host) host.appendChild(bubble);
    // Under the right end of the field, where the (right-aligned) amount is.
    const box = input.getBoundingClientRect();
    bubble.style.right = `${document.documentElement.clientWidth - box.right}px`;
    bubble.style.top = `${box.bottom + 4}px`;
    bubble.hidden = false;
  }

  document.addEventListener("input", (event) => {
    const input = kamasField(event.target);
    if (input) show(input);
  });
  document.addEventListener("focusin", (event) => {
    const input = kamasField(event.target);
    if (input) show(input);
  });
  document.addEventListener("focusout", (event) => {
    const input = kamasField(event.target);
    if (!input) return;
    bubble.hidden = true;
    const value = evaluateKamas(input.value);
    if (!Number.isNaN(value) && input.value !== formatKamas(value)) input.value = formatKamas(value);
  });
  // The bubble is positioned for the field where it was; hide it rather than leave it behind.
  window.addEventListener("scroll", () => (bubble.hidden = true), { capture: true, passive: true });
  window.addEventListener("resize", () => (bubble.hidden = true));
}
