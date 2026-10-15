import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useEffectEvent, useState } from "react";
import { t } from "../i18n/locale";
import { loadGenre } from "../jellyfin/browse";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import type { MediaItem } from "../jellyfin/library";
import { FocusButton } from "../navigation/Focusable";
import { BackIcon } from "../ui/icons";
import { PosterCard } from "./PosterCard";

interface Props {
  connection: Connection;
  userId: string;
  genre: string;
  /** The library the home is filtered to, if any: a category stays within it. */
  libraryId: string | null;
  wide: boolean;
  onClose: () => void;
  onOpen: (item: MediaItem) => void;
  onExpired: () => void;
}

/** Every movie and series in a category, as a grid of posters. */
export function GenrePage(props: Props) {
  const { connection, userId, genre, libraryId, wide } = props;
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "GENRE_PAGE",
    isFocusBoundary: true,
  });
  const fail = useEffectEvent((error: unknown) => {
    if (error instanceof SessionExpiredError) props.onExpired();
    else setItems([]);
  });

  useEffect(() => {
    let current = true;
    loadGenre(connection, userId, genre, libraryId ?? undefined).then((loaded) => {
      if (current) setItems(loaded);
    }, fail);
    return () => {
      current = false;
    };
  }, [connection, userId, genre, libraryId]);

  useEffect(() => {
    if (items) focusSelf();
  }, [items, focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="genre-title"
        className="fixed inset-0 z-30 overflow-y-auto bg-black pb-28"
      >
        <div className="sticky top-0 z-10 flex h-[52px] items-center gap-2 bg-black px-1">
          <FocusButton
            aria-label={t.title.back}
            onPress={props.onClose}
            className="grid size-11 flex-none place-items-center rounded-full outline-none focused:bg-white focused:text-black"
          >
            <BackIcon className="size-6" />
          </FocusButton>
          <h1 id="genre-title" className="truncate text-[20px] font-bold">
            {genre}
          </h1>
        </div>
        <ul className={`mt-2 grid gap-1.5 px-3 ${wide ? "grid-cols-6" : "grid-cols-3"}`}>
          {(items ?? Array.from({ length: 9 }, () => null)).map((item, index) => (
            <li key={item?.id ?? index}>
              {item ? (
                <PosterCard item={item} onOpen={() => props.onOpen(item)} />
              ) : (
                <span className="block aspect-[111/155] animate-pulse rounded-[4px] bg-white/10" />
              )}
            </li>
          ))}
        </ul>
      </div>
    </FocusContext.Provider>
  );
}
