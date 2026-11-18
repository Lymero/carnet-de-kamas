/**
 * @file Small DOM utilities shared by the UI modules.
 */

import { ActionError } from "../actions.js";

export { escapeHtml as esc } from "../domain/text.js";

/**
 * First element matching `selector` inside `root`.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement|null}
 */
export const $ = (selector, root = document) => root.querySelector(selector);

/**
 * All elements matching `selector` inside `root`.
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export const $$ = (selector, root = document) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(selector)]);

/**
 * For delegated events: the element matching `selector` that contains the event target (or is it).
 * @param {Event} event
 * @param {string} selector
 * @returns {HTMLElement|null}
 */
export const closest = (event, selector) => /** @type {Element} */ (event.target).closest(selector);

let toastTimer = 0;

/**
 * Shows a short message at the bottom of the screen, announced to screen readers.
 *
 * The live region is a permanent element of index.html (screen readers only
 * announce changes to regions that already exist). A modal <dialog> sits in the
 * browser's top layer, above any z-index, so while one is open the region is
 * moved inside it; otherwise errors would appear dimmed behind the backdrop.
 * @param {string} message
 * @param {number} [ms]
 */
export function toast(message, ms = 3200) {
  const el = $(".toast");
  if (!el) return;
  const host = $("dialog[open]") ?? document.body;
  if (el.parentElement !== host) host.appendChild(el);
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.textContent = "";
  }, ms);
}

/**
 * Runs `render` (which replaces content inside `root`), then gives focus and
 * caret back to the element that had them, matched by id. Live updates (a
 * snapshot from another device, the catalog arriving) then never interrupt typing.
 * @param {HTMLElement} root
 * @param {() => void} render
 */
export function renderKeepingFocus(root, render) {
  const active = document.activeElement;
  const id = active instanceof HTMLElement && root.contains(active) ? active.id : "";
  const caret = active instanceof HTMLInputElement ? [active.selectionStart, active.selectionEnd] : [null, null];
  render();
  const again = id ? document.getElementById(id) : null;
  if (!again || again === active) return;
  again.focus();
  if (again instanceof HTMLInputElement && caret[0] != null) {
    try {
      again.setSelectionRange(caret[0], caret[1]);
    } catch {
      // Not every input type has a caret (e.g. date): focus alone is enough.
    }
  }
}

/**
 * Runs an async UI handler: disables `button` while it runs and shows any error as a toast.
 * @param {HTMLButtonElement|null} button
 * @param {() => Promise<void>} handler
 */
export async function runAction(button, handler) {
  if (button) button.disabled = true;
  try {
    await handler();
  } catch (error) {
    // ActionError messages are written for the player (validation, storage refusals): show them.
    // Anything else is a bug: show a generic message and log it for debugging.
    if (error instanceof ActionError) {
      toast(error.message);
    } else {
      toast("Une erreur inattendue est survenue.");
      console.error(error);
    }
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
}
