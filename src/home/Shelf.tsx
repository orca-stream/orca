import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { t } from "../i18n/locale";
import type { MediaItem, Shelf as ShelfData, ShelfTitle } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { cardKey } from "./focus-keys";
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
                <Card item={item} focusKey={cardKey(shelf, item)} onOpen={() => onOpen(item)} />
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

interface CardProps {
  item: MediaItem;
  focusKey: string;
  onOpen: () => void;
}

/** Netflix web's landscape card, for wide screens and TVs. */
function Card({ item, focusKey, onOpen }: CardProps) {
  const caption = episodeLabel(item);
  const image = item.cardImage;
  return (
    <FocusButton
      focusKey={focusKey}
      onFocused={revealCard}
      onPress={onOpen}
      aria-label={[item.title, caption].filter(Boolean).join(", ")}
      className="group block w-full text-left outline-none"
    >
      <span className="relative block aspect-video overflow-hidden rounded-md bg-neutral-800 ring-white transition group-hover:brightness-110 group-focused:ring-4">
        {image && (
          <img
            src={image.url}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        )}
        {!image?.hasTitle && (
          <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 to-transparent p-3 pt-8 text-base font-bold">
            <span className="line-clamp-2">{item.title}</span>
          </span>
        )}
      </span>
      {item.progress !== undefined && (
        <span className="mx-auto mt-2 block h-1 w-4/5 overflow-hidden rounded-full bg-white/30">
          <span
            className="block h-full bg-[#e50914]"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
          />
        </span>
      )}
      {caption && (
        <span className="mt-1.5 block truncate text-sm text-white/60 group-hover:text-white group-focused:text-white">
          {caption}
        </span>
      )}
    </FocusButton>
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
