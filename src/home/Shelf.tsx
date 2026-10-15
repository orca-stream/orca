import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { t } from "../i18n/locale";
import type { MediaItem, Shelf as ShelfData, ShelfTitle } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { cardKey } from "./focus-keys";
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

export function Shelf({ shelf }: { shelf: ShelfData }) {
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
        <h2 id={`${headingId}-title`} className="px-(--gutter) text-lg font-bold sm:text-2xl">
          {titleOf(shelf.title)}
        </h2>
        <ul className="shelf relative flex gap-(--gap) overflow-x-auto px-(--gutter) pt-3 pb-4">
          {shelf.items.map((item) => (
            <li key={item.id} className="shelf-card">
              <Card item={item} focusKey={cardKey(shelf, item)} />
            </li>
          ))}
        </ul>
      </section>
    </FocusContext.Provider>
  );
}

function Card({ item, focusKey }: { item: MediaItem; focusKey: string }) {
  const caption = episodeLabel(item);
  return (
    <FocusButton
      focusKey={focusKey}
      onFocused={revealCard}
      aria-label={[item.title, caption].filter(Boolean).join(", ")}
      className="group block w-full text-left outline-none"
    >
      <span className="relative block aspect-video overflow-hidden rounded-md bg-neutral-800 ring-white transition group-hover:brightness-110 group-data-focused:ring-4">
        {item.cardImage && (
          <img
            src={item.cardImage.url}
            alt=""
            loading="lazy"
            draggable={false}
            className="size-full object-cover"
          />
        )}
        {!item.cardImage?.hasTitle && (
          <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/90 to-transparent p-2 pt-6 text-sm font-bold sm:p-3 sm:pt-8 sm:text-base">
            <span className="line-clamp-2">{item.title}</span>
          </span>
        )}
      </span>
      {item.progress !== undefined && (
        <span className="mx-auto mt-2 block h-1 w-4/5 overflow-hidden rounded-full bg-white/30">
          <span
            className="block h-full bg-red-600"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
          />
        </span>
      )}
      {caption && (
        <span className="mt-1.5 block truncate text-sm text-white/60 group-hover:text-white group-data-focused:text-white">
          {caption}
        </span>
      )}
    </FocusButton>
  );
}

/** Grey cards in place of the shelves while the server answers. */
export function ShelfSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-3">
      <div className="mx-(--gutter) h-6 w-48 rounded bg-white/10" />
      <div className="shelf flex gap-(--gap) overflow-hidden px-(--gutter)">
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="shelf-card aspect-video animate-pulse rounded-md bg-white/10"
          />
        ))}
      </div>
    </div>
  );
}
