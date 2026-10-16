/**
 * How much of the scroller's height a stretch of content may take and still count as fitting on
 * screen; the rest is a margin, since a TV may crop the screen's edges.
 */
const FIT = 0.9;

interface Span {
  /** The revealed stretch's edges, measured from the top of the scroller's content. */
  top: number;
  bottom: number;
  clientHeight: number;
  scrollHeight: number;
}

/**
 * Where to scroll once a node is in view: back to the very top when everything above it fits on
 * screen with it, to the very bottom when everything below it does, or nowhere (null). Without
 * this, coming back up stops as soon as the node shows, leaving a heading or a picture above it cut.
 */
export function edgeScrollTop({ top, bottom, clientHeight, scrollHeight }: Span): number | null {
  const room = clientHeight * FIT;
  if (bottom <= room) return 0;
  if (scrollHeight - top <= room) return Math.max(0, scrollHeight - clientHeight);
  return null;
}

/**
 * Where to scroll so a stretch of content shows whole and clear of the screen's edges (the margin
 * `FIT` leaves, split between top and bottom), or nowhere (null) when it already does. An edge of
 * the content wins when the rest of it fits, as in `edgeScrollTop`.
 */
export function revealScrollTop(span: Span & { scrollTop: number }): number | null {
  const { top, bottom, clientHeight, scrollHeight, scrollTop } = span;
  const max = Math.max(0, scrollHeight - clientHeight);
  const margin = (clientHeight * (1 - FIT)) / 2;
  let target = edgeScrollTop(span);
  if (target === null) {
    if (top - margin < scrollTop) target = top - margin;
    else if (bottom + margin > scrollTop + clientHeight) target = bottom + margin - clientHeight;
    else return null;
  }
  target = Math.min(max, Math.max(0, target));
  return target === scrollTop ? null : target;
}

/** The nearest ancestor that scrolls vertically, or the page itself. */
function verticalScroller(node: HTMLElement): HTMLElement {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/**
 * What has to show along with a focused node: the list item around it — the whole card, not only
 * the picture that takes the focus, nor only the "My list" button under the synopsis — as long as
 * it fits on screen; otherwise the node alone.
 */
function revealedUnit(node: HTMLElement, clientHeight: number): HTMLElement {
  const item = node.closest("li");
  if (item && item.getBoundingClientRect().height <= clientHeight * FIT) return item;
  return node;
}

/**
 * Brings a focused node into view with the card it belongs to, clear of the screen's edges, and
 * snaps its scroller to an edge when the rest of that edge fits too — so a dialog's header, a
 * page's title, a section's heading or a card's synopsis is never left half cut.
 */
export function reveal(node: HTMLElement): void {
  node.scrollIntoView({ block: "nearest", inline: "nearest" });
  const scroller = verticalScroller(node);
  const page = scroller === document.scrollingElement;
  const clientHeight = page ? window.innerHeight : scroller.clientHeight;
  const origin = page ? 0 : scroller.getBoundingClientRect().top;
  const rect = revealedUnit(node, clientHeight).getBoundingClientRect();
  const offset = scroller.scrollTop - origin;
  const target = revealScrollTop({
    top: rect.top + offset,
    bottom: rect.bottom + offset,
    clientHeight,
    scrollHeight: scroller.scrollHeight,
    scrollTop: scroller.scrollTop,
  });
  if (target !== null) scroller.scrollTo({ top: target });
}
