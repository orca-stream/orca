function behavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Back to the billboard when the arrows reach the header or the billboard's buttons. */
export function scrollToTop(): void {
  window.scrollTo({ top: 0, behavior: behavior() });
}

/**
 * Brings a focused card into view the way a TV app does: its shelf slides so the card sits at the
 * start, and the page scrolls so the shelf sits in the upper part of the screen.
 */
export function revealCard(card: HTMLElement): void {
  const item = card.closest("li");
  const scroller = item?.parentElement;
  if (item && scroller) {
    // The scroller is positioned, so the card's offset is measured from its padding edge.
    const start = Number.parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
    scroller.scrollTo({ left: item.offsetLeft - start, behavior: behavior() });
  }
  const shelf = card.closest("section");
  if (shelf) {
    const top = shelf.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.3;
    window.scrollTo({ top: Math.max(0, top), behavior: behavior() });
  }
}
