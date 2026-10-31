import { useCallback, useRef, useState } from "react";

/** The rendered height of the element the returned ref lands on, kept current as it resizes. */
export function useElementHeight<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [height, setHeight] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setHeight(node.offsetHeight);
    observer.current = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.current.observe(node);
  }, []);
  return [ref, height];
}
