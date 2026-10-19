import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/locale";
import type { Catalog, MediaItem } from "../jellyfin/library";
import { LandscapeCard } from "./LandscapeCard";
import { PosterCard } from "./PosterCard";

/** Cards drawn at a time: more come as the grid nears the bottom of the screen. */
const PAGE = 60;

interface Props {
  catalog: Catalog;
  wide: boolean;
  onOpen: (item: MediaItem) => void;
}

function reveal(card: HTMLElement) {
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
}

/**
 * The whole library, A to Z, after its shelves: what a shelf leaves out is still one scroll away.
 * Wide screens get landscape cards and phones posters, as on the shelves.
 */
export function CatalogGrid({ catalog, wide, onOpen }: Props) {
  const { ref, focusKey } = useFocusable({ focusKey: "CATALOG", saveLastFocusedChild: true });
  const [shown, setShown] = useState(PAGE);
  const end = useRef<HTMLDivElement>(null);
  const total = catalog.items.length;

  // Draws the next page before the last row comes into view, so scrolling never hits a wall.
  useEffect(() => {
    const sentinel = end.current;
    if (!sentinel || shown >= total) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          setShown((count) => Math.min(total, count + PAGE));
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [shown, total]);

  return (
    <FocusContext.Provider value={focusKey}>
      <section ref={ref} aria-labelledby="catalog-title">
        <h2
          id="catalog-title"
          className={
            wide
              ? "px-(--gutter) text-2xl font-bold"
              : "px-3 pb-1.5 text-[16px] leading-[21px] font-semibold"
          }
        >
          {t.home.catalog(catalog.library)}
        </h2>
        <ul
          className={
            wide
              ? "grid grid-cols-3 gap-x-(--gap) gap-y-6 px-(--gutter) pt-3 [--gap:0.5rem] md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
              : "grid grid-cols-3 gap-1.5 px-3"
          }
        >
          {catalog.items.slice(0, shown).map((item) => (
            <li key={item.id}>
              {wide ? (
                <LandscapeCard
                  item={item}
                  focusKey={`CARD_catalog_${item.id}`}
                  onFocused={reveal}
                  onOpen={() => onOpen(item)}
                />
              ) : (
                <PosterCard
                  item={item}
                  focusKey={`CARD_catalog_${item.id}`}
                  onFocused={reveal}
                  onOpen={() => onOpen(item)}
                />
              )}
            </li>
          ))}
        </ul>
        <div ref={end} aria-hidden="true" />
      </section>
    </FocusContext.Provider>
  );
}
