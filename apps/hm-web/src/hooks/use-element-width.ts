import { useCallback, useRef, useState } from "react";

/**
 * The rendered width of the element the returned ref lands on, kept current as it resizes. With
 * `slack`, a change smaller than it is ignored: a layout whose columns follow the width would
 * otherwise flip for ever as the page's scrollbar comes and goes with them (it takes ~15px).
 */
export function useElementWidth<T extends HTMLElement>(
  slack = 0,
): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!node) return;
      const measure = () =>
        setWidth((last) => {
          const next = node.offsetWidth;
          return last !== 0 && Math.abs(next - last) < slack ? last : next;
        });
      measure();
      observer.current = new ResizeObserver(measure);
      observer.current.observe(node);
    },
    [slack],
  );
  return [ref, width];
}
