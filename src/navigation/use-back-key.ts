import { useEffect, useRef } from "react";

const BACK_KEYS = new Set(["Escape", "GoBack", "BrowserBack"]);

interface Options {
  /** Off while something above the screen (a picker it opened) takes Back instead. */
  enabled?: boolean;
  /** For a dialog over a screen that also listens: it runs first and the screen's sees it taken. */
  capture?: boolean;
}

/**
 * Back on a remote, the pad's B, Escape or a phone's back gesture runs `onBack`, once: a listener
 * that already took the key (preventDefault) leaves it alone.
 */
export function useBackKey(onBack: () => void, { enabled = true, capture = false }: Options = {}) {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    function back(event: KeyboardEvent) {
      if (!BACK_KEYS.has(event.key) || event.defaultPrevented) return;
      event.preventDefault();
      latest.current();
    }
    window.addEventListener("keydown", back, { capture });
    return () => window.removeEventListener("keydown", back, { capture });
  }, [enabled, capture]);
}
