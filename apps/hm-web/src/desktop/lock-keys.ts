/**
 * The desktop app runs through XWayland on Linux, where a lock key can get stuck "held": X then
 * repeats its keydown about every 30 ms for as long as the window has focus. Base UI forgets that a
 * popup was opened by the press in progress on every keydown, so the click that ends that press
 * read as a second click and closed every Select, Popover and Menu right after opening it.
 *
 * Scroll Lock does nothing in the panel, so its events stop here, before React sees them.
 */
const IGNORED_KEYS = new Set(["ScrollLock"]);

function swallow(event: KeyboardEvent) {
  if (IGNORED_KEYS.has(event.key)) event.stopImmediatePropagation();
}

/** Stops Scroll Lock's key events at the window; returns the function that undoes it. */
export function ignoreLockKeys(target: Window = window): () => void {
  target.addEventListener("keydown", swallow, true);
  target.addEventListener("keyup", swallow, true);
  return () => {
    target.removeEventListener("keydown", swallow, true);
    target.removeEventListener("keyup", swallow, true);
  };
}
