import { getCurrentFocusKey, setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { useCallback, useEffect, useRef, useState } from "react";

/** Screens opened over the home, which stays mounted underneath and keeps its scroll. */
export type Overlay =
  | { kind: "title"; id: string }
  | { kind: "search" }
  | { kind: "categories" }
  | { kind: "genre"; name: string };

interface Entry {
  overlay: Overlay;
  /** What had focus when it opened, focused again when it closes. */
  returnFocus: string;
}

const BACK_KEYS = new Set(["Escape", "GoBack", "BrowserBack"]);

/**
 * A stack of overlays tied to the browser history, so Android's back gesture, the browser's back
 * button and a remote's Back all close the top one, as they would leave a page.
 */
export function useOverlays() {
  const [stack, setStack] = useState<Entry[]>([]);
  // Mirrors the state for the event handlers, so history and focus stay out of state updaters.
  const entries = useRef<Entry[]>([]);
  const commit = useCallback((next: Entry[]) => {
    entries.current = next;
    setStack(next);
  }, []);
  const depth = stack.length;

  useEffect(() => {
    function pop() {
      const target = (history.state as { orcaDepth?: number } | null)?.orcaDepth ?? 0;
      const closed = entries.current[target];
      commit(entries.current.slice(0, target));
      // Once the overlay is gone, back to what opened it.
      if (closed) setTimeout(() => void setFocus(closed.returnFocus), 0);
    }
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [commit]);

  useEffect(() => {
    if (depth === 0) return;
    function back(event: KeyboardEvent) {
      if (!BACK_KEYS.has(event.key) || event.defaultPrevented) return;
      event.preventDefault();
      history.back();
    }
    window.addEventListener("keydown", back);
    // The home underneath must not scroll along with the overlay.
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", back);
      document.body.style.overflow = "";
    };
  }, [depth]);

  const open = useCallback(
    (overlay: Overlay) => {
      const next = [...entries.current, { overlay, returnFocus: getCurrentFocusKey() }];
      history.pushState({ orcaDepth: next.length }, "");
      commit(next);
    },
    [commit],
  );

  /** Swaps the top overlay, as picking a category does, so Back skips the picker. */
  const replace = useCallback(
    (overlay: Overlay) => {
      const top = entries.current.at(-1);
      if (!top) return;
      commit([...entries.current.slice(0, -1), { ...top, overlay }]);
    },
    [commit],
  );

  const close = useCallback(() => history.back(), []);

  /** Back to the home itself, as a tab does. */
  const closeAll = useCallback(() => {
    if (entries.current.length > 0) history.go(-entries.current.length);
  }, []);

  return { overlays: stack.map((entry) => entry.overlay), open, replace, close, closeAll };
}
