import { useCallback, useRef, useState } from "react";

/** The rendered width of the element the returned ref lands on, kept current as it resizes. */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(node.offsetWidth);
    observer.current = new ResizeObserver(() => setWidth(node.offsetWidth));
    observer.current.observe(node);
  }, []);
  return [ref, width];
}
