import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useEffectEvent, useState } from "react";
import { t } from "../i18n/locale";
import { loadGenrePage } from "../jellyfin/browse";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import type { MediaItem, Shelf as ShelfData } from "../jellyfin/library";
import { setFavorite } from "../jellyfin/title";
import { FocusButton } from "../navigation/Focusable";
import { BackIcon } from "@orca/ui/icons";
import { Billboard, BillboardSkeleton } from "./Billboard";
import { Glow } from "./Glow";
import { Shelf, ShelfSkeleton } from "./Shelf";

interface Props {
  connection: Connection;
  userId: string;
  genre: string;
  /** The library the home is filtered to, if any: a category stays within it. */
  libraryId: string | null;
  wide: boolean;
  onClose: () => void;
  onOpen: (item: MediaItem) => void;
  onPlay: (item: MediaItem) => void;
  onExpired: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; featured: MediaItem | null; shelves: ShelfData[] }
  | { kind: "error" };

/**
 * A category, laid out like the home as the phone app does: the back arrow and the genre's name
 * over the featured title's tint, a billboard, then shelves of the genre's titles.
 */
export function GenrePage(props: Props) {
  const { connection, userId, genre, libraryId, wide, onOpen, onPlay } = props;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [scrolled, setScrolled] = useState(false);
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "GENRE_PAGE",
    isFocusBoundary: true,
  });
  const fail = useEffectEvent((error: unknown) => {
    if (error instanceof SessionExpiredError) props.onExpired();
    else setState({ kind: "error" });
  });

  useEffect(() => {
    let current = true;
    loadGenrePage(connection, userId, genre, libraryId ?? undefined).then((page) => {
      if (current) setState({ kind: "ready", ...page });
    }, fail);
    return () => {
      current = false;
    };
  }, [connection, userId, genre, libraryId]);

  useEffect(() => {
    if (state.kind !== "loading") focusSelf();
  }, [state.kind, focusSelf]);

  function toggleList(item: MediaItem) {
    const flip = (favorite: boolean) =>
      setState((current) =>
        current.kind === "ready" && current.featured?.id === item.id
          ? { ...current, featured: { ...item, favorite } }
          : current,
      );
    flip(!item.favorite);
    setFavorite(connection, userId, item.id, !item.favorite).catch((error: unknown) => {
      flip(item.favorite);
      if (error instanceof SessionExpiredError) props.onExpired();
    });
  }

  const featured = state.kind === "ready" ? state.featured : null;
  const offset = wide ? "mt-2" : "mt-1.5";

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="genre-title"
        data-scroller
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 8)}
        className="fixed inset-0 isolate z-30 flow-root overflow-y-auto bg-black pb-28 sm:bg-[#141414] sm:pb-16"
      >
        {featured && <Glow url={featured.backdropUrl ?? featured.posterUrl} />}
        <div
          className={`sticky top-0 z-20 box-content flex items-center pt-[env(safe-area-inset-top)] transition-colors duration-300 ${
            wide ? "h-20 gap-4 px-(--gutter)" : "h-[52px] gap-[18px] pr-4 pl-1.5"
          } ${scrolled ? (wide ? "bg-[#141414]" : "bg-black") : "bg-transparent"}`}
        >
          <FocusButton
            aria-label={t.title.back}
            onPress={props.onClose}
            className={`grid size-11 flex-none place-items-center rounded-full outline-none focused:bg-white focused:text-black ${
              wide ? "-ml-2.5" : ""
            }`}
          >
            <BackIcon className="size-6" />
          </FocusButton>
          <h1
            id="genre-title"
            className={`truncate font-semibold ${wide ? "text-3xl" : "text-[23px]"}`}
          >
            {genre}
          </h1>
        </div>

        {state.kind === "loading" && (
          <>
            <BillboardSkeleton wide={wide} offset={offset} />
            <div className="mt-5 grid grid-cols-1 gap-[18px] sm:mt-8 sm:gap-8">
              <ShelfSkeleton wide={wide} />
            </div>
          </>
        )}
        {state.kind === "error" && (
          <p className="px-4 py-16 text-center text-white/70">{t.home.loadError}</p>
        )}
        {state.kind === "ready" && (
          <>
            {featured && (
              <Billboard
                item={featured}
                wide={wide}
                offset={offset}
                onPlay={() => onPlay(featured)}
                onOpen={() => onOpen(featured)}
                onToggleList={() => toggleList(featured)}
              />
            )}
            <div className="mt-5 grid grid-cols-1 gap-[18px] sm:mt-10 sm:gap-10">
              {state.shelves.map((shelf) => (
                <Shelf key={shelf.id} shelf={shelf} wide={wide} onOpen={onOpen} />
              ))}
            </div>
          </>
        )}
      </div>
    </FocusContext.Provider>
  );
}
