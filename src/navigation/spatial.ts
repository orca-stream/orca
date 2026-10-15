import { init } from "@noriginmedia/norigin-spatial-navigation-core";

/**
 * Arrow keys / remote / gamepad move focus between `useFocusable` elements by their position on
 * screen. The library also moves real DOM focus, so `:focus-visible` and screen readers follow, and
 * it marks the focused node with `data-focused`, which is what the focus styles key on.
 */
export function initSpatialNavigation(): void {
  init({ shouldFocusDOMNode: true, domNodeFocusOptions: { preventScroll: true } });
}
