import { type PointerEvent as ReactPointerEvent, useLayoutEffect, useRef, useState } from "react";

/** How far from the window's edges a panel may be moved or stretched. */
const EDGE = 8;

/** Where a moved panel is, from where it opened; and its size once stretched by hand. */
export interface PanelPlace {
  offset: { x: number; y: number };
  size: { width: number; height: number } | null;
}

const UNMOVED: PanelPlace = { offset: { x: 0, y: 0 }, size: null };

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * The move a drag makes, kept inside the window: `rect` is where the panel was when it started.
 * Pure, so it is tested without a pointer.
 */
export function dragBy(
  rect: { left: number; top: number; right: number; bottom: number },
  start: { x: number; y: number },
  delta: { x: number; y: number },
  view: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: start.x + clamp(delta.x, EDGE - rect.left, view.width - EDGE - rect.right),
    y: start.y + clamp(delta.y, EDGE - rect.top, view.height - EDGE - rect.bottom),
  };
}

/**
 * The size a stretch from the bottom-right corner gives, between `min` and `max` and inside the
 * window: the top-left corner stays where it is.
 */
export function stretchBy(
  rect: { left: number; top: number; width: number; height: number },
  delta: { x: number; y: number },
  limits: { min: { width: number; height: number }; max: { width: number; height: number } },
  view: { width: number; height: number },
): { width: number; height: number } {
  return {
    width: clamp(
      rect.width + delta.x,
      limits.min.width,
      Math.min(limits.max.width, view.width - EDGE - rect.left),
    ),
    height: clamp(
      rect.height + delta.y,
      limits.min.height,
      Math.min(limits.max.height, view.height - EDGE - rect.top),
    ),
  };
}

/**
 * A floating panel moved by a handle and stretched by a grip. It goes back to where it opens, at
 * its own size, every time it opens (or opens elsewhere: `placement`).
 */
export function useMovablePanel({
  open,
  placement,
  anchoredRight,
  limits,
}: {
  open: boolean;
  placement: string;
  /**
   * Placed by its right edge (below a button, its right edge with the button's): a wider panel
   * would grow to the left, so it is moved right by as much to keep its left edge still.
   */
  anchoredRight: boolean;
  limits: { min: { width: number; height: number }; max: { width: number; height: number } };
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  // Kept for one opening at one placement: another starts where it opens again. Each opening is
  // counted while rendering (React's way to follow a prop), not in an effect after it.
  const [openings, setOpenings] = useState({ open, count: 0 });
  if (openings.open !== open) setOpenings({ open, count: openings.count + (open ? 1 : 0) });
  const opening = open ? `${placement}:${openings.count}` : null;
  const [moved, setMoved] = useState<{ opening: string | null; place: PanelPlace }>({
    opening,
    place: UNMOVED,
  });
  const place = moved.opening === opening ? moved.place : UNMOVED;
  const setPlace = (next: (now: PanelPlace) => PanelPlace) =>
    setMoved((now) => ({
      opening,
      place: next(now.opening === opening ? now.place : UNMOVED),
    }));

  // The window less its scrollbars: a panel moved under one would make the page scroll.
  const view = () => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  });

  /** Follows the pointer from `down` until it is let go. */
  function follow(
    down: ReactPointerEvent<HTMLElement>,
    move: (rect: DOMRect, delta: { x: number; y: number }) => void,
  ) {
    const node = panel.current;
    if (!node || down.button !== 0) return;
    down.preventDefault();
    const rect = node.getBoundingClientRect();
    const handle = down.currentTarget;
    handle.setPointerCapture(down.pointerId);
    const onMove = (event: PointerEvent) =>
      move(rect, { x: event.clientX - down.clientX, y: event.clientY - down.clientY });
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  return {
    panel,
    place,
    /** On the handle: drags the panel, but not from a button on it. */
    onMoveStart: (event: ReactPointerEvent<HTMLElement>) => {
      if ((event.target as Element).closest("button, a, input, [role=tab]")) return;
      const start = place.offset;
      follow(event, (rect, delta) =>
        setPlace((now) => ({ ...now, offset: dragBy(rect, start, delta, view()) })),
      );
    },
    /** On the grip, in the bottom-right corner: stretches the panel. */
    onResizeStart: (event: ReactPointerEvent<HTMLElement>) => {
      const start = place.offset;
      follow(event, (rect, delta) => {
        const size = stretchBy(rect, delta, limits, view());
        const offset = anchoredRight ? { x: start.x + size.width - rect.width, y: start.y } : start;
        setPlace(() => ({ offset, size }));
      });
    },
  };
}

/** Whether a panel `width` wide fits beside `anchor` (`gap` out from it, and from the window's edge). */
export function useFitsBeside(
  anchor: { current: Element | null },
  open: boolean,
  width: number,
  gap: number,
): boolean {
  const [fits, setFits] = useState(true);
  // Before the panel paints: it never shows beside the card only to jump below the button.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const node = anchor.current;
      if (!node) return;
      const room = document.documentElement.clientWidth - node.getBoundingClientRect().right;
      setFits(room - 2 * gap >= width);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor, open, width, gap]);
  return fits;
}
