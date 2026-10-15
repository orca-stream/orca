import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { t } from "../i18n/locale";
import type { MediaItem, Shelf as ShelfData, ShelfTitle } from "../jellyfin/library";
import { cardKey } from "./focus-keys";
import { LandscapeCard } from "./LandscapeCard";
import { PosterCard } from "./PosterCard";
import { revealCard } from "./scroll";

function titleOf(title: ShelfTitle): string {
  switch (title.kind) {
    case "continueWatching":
      return t.home.continueWatching;
    case "nextUp":
      return t.home.nextUp;
    case "latest":
      return t.home.latest(title.library);
  }
}

function episodeLabel(item: MediaItem): string | null {
  const episode = item.episode;
  if (!episode) return null;
  if (episode.season == null || episode.number == null) return episode.title;
  return t.home.episode(episode.season, episode.number, episode.title);
}

interface ShelfProps {
  shelf: ShelfData;
  /** Wide screens get landscape cards; phones, posters, as in the Netflix app. */
  wide: boolean;
  onOpen: (item: MediaItem) => void;
}

export function Shelf({ shelf, wide, onOpen }: ShelfProps) {
  // Coming back to a shelf lands on the card left last, like Netflix.
  const { ref, focusKey } = useFocusable({
    focusKey: `SHELF_${shelf.id}`,
    saveLastFocusedChild: true,
  });
  const headingId = `shelf-${shelf.id}`;

  return (
    <FocusContext.Provider value={focusKey}>
      <section
        ref={ref}
        id={headingId}
        aria-labelledby={`${headingId}-title`}
        className="scroll-mt-24"
      >
        <h2
          id={`${headingId}-title`}
          className={
            wide
              ? "px-(--gutter) text-2xl font-bold"
              : "px-3 pb-1.5 text-[16px] leading-[21px] font-semibold"
          }
        >
          {titleOf(shelf.title)}
        </h2>
        <ul
          className={
            wide
              ? "shelf relative flex gap-(--gap) overflow-x-auto px-(--gutter) pt-3 pb-4"
              : "no-scrollbar flex gap-1.5 overflow-x-auto px-3"
          }
        >
          {shelf.items.map((item) => (
            <li key={item.id} className={wide ? "shelf-card" : "poster-card"}>
              {wide ? (
                <LandscapeCard
                  item={item}
                  focusKey={cardKey(shelf, item)}
                  onFocused={revealCard}
                  onOpen={() => onOpen(item)}
                  caption={episodeLabel(item)}
                  showBadge
                />
              ) : (
                <PosterCard
                  item={item}
                  focusKey={cardKey(shelf, item)}
                  onFocused={revealCard}
                  onOpen={() => onOpen(item)}
                  caption={episodeLabel(item)}
                  showBadge
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    </FocusContext.Provider>
  );
}

/** Grey cards in place of the shelves while the server answers. */
export function ShelfSkeleton({ wide }: { wide: boolean }) {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3">
      <div className={`h-6 w-48 rounded bg-white/10 ${wide ? "mx-(--gutter)" : "mx-4"}`} />
      <div
        className={`flex overflow-hidden ${wide ? "shelf gap-(--gap) px-(--gutter)" : "gap-1.5 px-3"}`}
      >
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className={`animate-pulse rounded-[4px] bg-white/10 ${
              wide ? "shelf-card aspect-video" : "poster-card aspect-[111/155]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
