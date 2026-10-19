import { useSyncExternalStore } from "react";

/** Same breakpoint as Tailwind's `sm`: below it the app takes Netflix's phone layout. */
const WIDE = "(min-width: 40rem)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the screen is wider than a phone. Layouts that differ in their focusable buttons must
 * branch on this rather than hide with CSS: the arrow navigation still reaches a hidden button.
 */
export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches);
}
