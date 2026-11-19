/**
 * @file Click away to close: the one behaviour shared by every panel that opens over or
 * inside the page (the dialog, the recipe folds).
 *
 * A panel closes when a click both starts and ends outside it, so a text selection dragged
 * past its edge keeps it open, and a click that opens a panel never closes it at once (only
 * panels already open when the press started are candidates). A modal <dialog>'s backdrop
 * belongs to the dialog element itself, so a press on the element counts as outside only
 * when it falls outside its box (its own scrollbar is inside).
 */

/**
 * @param {HTMLElement} panel
 * @param {MouseEvent} event
 */
function isOutside(panel, event) {
  const target = /** @type {Node} */ (event.target);
  if (!panel.contains(target)) return true;
  if (target !== panel) return false;
  const box = panel.getBoundingClientRect();
  const { clientX: x, clientY: y } = event;
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

/**
 * Closes the open panels on a click outside them.
 * @template {HTMLElement} T
 * @param {() => Iterable<T>} openPanels  the panels open right now
 * @param {(panel: T) => void} close
 * @returns {() => void}  stops listening
 */
export function closeOnClickOutside(openPanels, close) {
  /** @type {T[]} */
  let pressed = [];
  /** @param {PointerEvent} e */
  const onPointerDown = (e) => {
    pressed = [...openPanels()].filter((panel) => isOutside(panel, e));
  };
  /** @param {MouseEvent} e */
  const onClick = (e) => {
    // Keyboard "clicks" (Enter, Space) come with no press: never a click away.
    if (e.detail === 0) return void (pressed = []);
    const still = new Set(openPanels());
    for (const panel of pressed) if (still.has(panel) && isOutside(panel, e)) close(panel);
    pressed = [];
  };
  // Capture: a handler that stops the event further down must not keep a panel open.
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("click", onClick, true);
  };
}
