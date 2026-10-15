function behavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * What scrolls around a node: a page opened over the home (marked `data-scroller`) scrolls on its
 * own, while the body underneath stays put; anywhere else, the window.
 */
function scrollerOf(node?: HTMLElement): HTMLElement | null {
  return node?.closest<HTMLElement>("[data-scroller]") ?? null;
}

/** Back to the billboard when the arrows reach the header or the billboard's buttons. */
export function scrollToTop(node?: HTMLElement): void {
  (scrollerOf(node) ?? window).scrollTo({ top: 0, behavior: behavior() });
}

/**
 * Brings a focused card into view the way a TV app does: its shelf slides so the card sits at the
 * start, and the page scrolls so the shelf sits in the upper part of the screen.
 */
export function revealCard(card: HTMLElement): void {
  const item = card.closest("li");
  const row = item?.parentElement;
  if (item && row) {
    // The row is positioned, so the card's offset is measured from its padding edge.
    const start = Number.parseFloat(getComputedStyle(row).paddingLeft) || 0;
    row.scrollTo({ left: item.offsetLeft - start, behavior: behavior() });
  }
  const shelf = card.closest("section");
  if (!shelf) return;
  const page = scrollerOf(card);
  if (page) {
    const top =
      shelf.getBoundingClientRect().top -
      page.getBoundingClientRect().top +
      page.scrollTop -
      page.clientHeight * 0.3;
    page.scrollTo({ top: Math.max(0, top), behavior: behavior() });
    return;
  }
  const top = shelf.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3;
  window.scrollTo({ top: Math.max(0, top), behavior: behavior() });
}
