import { init, SpatialNavigationService } from "@noriginmedia/norigin-spatial-navigation-core";
import { isAdjacentSlice } from "./adjacency";

/** Keys that drive the app without a pointer: arrows, Enter, Back, and a remote's or pad's. */
const NAVIGATION_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "Escape",
  "GoBack",
  "BrowserBack",
]);

/**
 * Arrow keys / remote / gamepad move focus between `useFocusable` elements by their position on
 * screen. The library also moves real DOM focus, so `:focus-visible` and screen readers follow, and
 * it marks the focused node with `data-focused`, which is what the focus styles key on.
 *
 * The focus styles only show while the app is driven by keys: a phone is touched, and a ring left
 * on the last thing tapped would only look stuck. `<html data-input>` says which one drove it last.
 */
export function initSpatialNavigation(): void {
  // The library has no option for this; it calls the static through the class, so this replaces it.
  SpatialNavigationService.isAdjacentSlice = isAdjacentSlice;
  init({ shouldFocusDOMNode: true, domNodeFocusOptions: { preventScroll: true } });
  const root = document.documentElement;
  window.addEventListener(
    "pointerdown",
    () => {
      root.dataset.input = "pointer";
    },
    { capture: true, passive: true },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (NAVIGATION_KEYS.has(event.key)) root.dataset.input = "keys";
    },
    { capture: true },
  );
}
