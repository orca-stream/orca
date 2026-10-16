import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useRef, useState } from "react";
import { onXbox } from "../host";
import { t } from "../i18n/locale";
import type { MediaItem, Shelf as ShelfData, ShelfTitle } from "../jellyfin/library";
import { ChevronIcon } from "../ui/icons";
import { cardKey } from "./focus-keys";
import { LandscapeCard } from "./LandscapeCard";
import { PosterCard } from "./PosterCard";
import { revealCard } from "./scroll";
import { TvCard } from "./TvCard";

function titleOf(title: ShelfTitle): string {
  switch (title.kind) {
    case "continueWatching":
      return t.home.continueWatching;
    case "nextUp":
      return t.home.nextUp;
    case "latest":
      return t.home.latest(title.library);
    case "recent":
      return t.home.recent;
    case "topRated":
      return t.home.topRated;
    case "movies":
      return t.home.moviesShelf;
    case "shows":
      return t.home.showsShelf;
    case "genre":
      return title.genre;
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
  /** Wide screens get landscape cards; phones, posters, as in the Netflix app; the Xbox, its TV app's. */
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
  const row = useRef<HTMLUListElement>(null);
  const [arrows, setArrows] = useState<Arrows | null>(null);
  const tv = wide && onXbox;

  /** Where the cards sit, and which way the row can still go. Read on hover, not on every render. */
  function measure() {
    const list = row.current;
    const card = list?.querySelector("li > * > span");
    if (!list || !card) return;
    const box = card.getBoundingClientRect();
    const top = box.top - list.getBoundingClientRect().top;
    const next = {
      top,
      height: box.height,
      back: list.scrollLeft > 1,
      forward: list.scrollLeft + list.clientWidth < list.scrollWidth - 1,
    };
    setArrows((current) =>
      current &&
      current.top === next.top &&
      current.height === next.height &&
      current.back === next.back &&
      current.forward === next.forward
        ? current
        : next,
    );
  }

  /**
   * Netflix web's arrows: a screen of cards at a time, landing with a whole card at the gutter.
   * Forward starts from the card the right edge cut; back goes a screen's width, to the card there.
   */
  function page(direction: 1 | -1) {
    const list = row.current;
    if (!list) return;
    const gutter = Number.parseFloat(getComputedStyle(list).paddingLeft) || 0;
    const cards = Array.from(list.children) as HTMLElement[];
    const from = list.scrollLeft;
    const target =
      direction === 1
        ? cards.find(
            (card) => card.offsetLeft + card.offsetWidth > from + list.clientWidth - gutter,
          )
        : cards.find((card) => card.offsetLeft - gutter >= from - (list.clientWidth - 2 * gutter));
    if (!target) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({
      left: Math.max(0, target.offsetLeft - gutter),
      behavior: smooth ? "smooth" : "auto",
    });
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <section
        ref={ref}
        id={headingId}
        aria-labelledby={`${headingId}-title`}
        // The TV's shelves sit closer than the home's gap: the details under a card fill the rest.
        className={tv ? "-mt-8 scroll-mt-24" : "scroll-mt-24"}
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
        <div className="group/shelf relative" onPointerEnter={wide ? measure : undefined}>
          <ul
            ref={row}
            onScroll={wide ? measure : undefined}
            className={
              tv
                ? "tv-shelf relative flex gap-(--gap) overflow-x-auto pt-3 pl-(--gutter)"
                : wide
                  ? "shelf relative flex gap-(--gap) overflow-x-auto px-(--gutter) pt-3 pb-4"
                  : "no-scrollbar flex gap-1.5 overflow-x-auto px-3"
            }
          >
            {shelf.items.map((item) => (
              <li key={item.id} className={tv ? "flex-none" : wide ? "shelf-card" : "poster-card"}>
                {tv ? (
                  <TvCard
                    item={item}
                    focusKey={cardKey(shelf, item)}
                    onOpen={() => onOpen(item)}
                    caption={episodeLabel(item)}
                  />
                ) : wide ? (
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
          {wide && !tv && arrows && (
            <>
              <ShelfArrow left hidden={!arrows.back} box={arrows} onPress={() => page(-1)} />
              <ShelfArrow hidden={!arrows.forward} box={arrows} onPress={() => page(1)} />
            </>
          )}
        </div>
      </section>
    </FocusContext.Provider>
  );
}

interface Arrows {
  top: number;
  height: number;
  back: boolean;
  forward: boolean;
}

/**
 * The arrow on each side of a shelf, for a mouse: shown while the pointer is over the shelf, in the
 * gutter beside the cards. Keys and the gamepad move card by card, so it never takes focus.
 */
function ShelfArrow(props: { left?: boolean; hidden: boolean; box: Arrows; onPress: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={props.onPress}
      style={{ top: props.box.top, height: props.box.height }}
      className={`absolute z-10 grid w-[calc(var(--gutter)-0.25rem)] max-w-12 min-w-8 place-items-center rounded-md bg-black/50 opacity-0 transition-opacity group-hover/shelf:opacity-100 hover:bg-black/70 ${
        props.left ? "left-0 rounded-l-none" : "right-0 rounded-r-none"
      } ${props.hidden ? "pointer-events-none invisible" : ""}`}
    >
      <ChevronIcon left={props.left} className="size-8 transition-transform hover:scale-125" />
    </button>
  );
}

/** Grey cards in place of the shelves while the server answers. */
export function ShelfSkeleton({ wide }: { wide: boolean }) {
  if (wide && onXbox) {
    return (
      <div aria-hidden="true" className="grid grid-cols-1 gap-3">
        <div className="mx-(--gutter) h-6 w-48 rounded bg-white/10" />
        <div className="tv-shelf flex gap-(--gap) overflow-hidden px-(--gutter)">
          {Array.from({ length: 7 }, (_, index) => (
            <div
              key={index}
              className="aspect-[2/3] h-(--tv-h) flex-none animate-pulse rounded-md bg-white/10"
            />
          ))}
        </div>
      </div>
    );
  }
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
