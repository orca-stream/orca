import { useEffect, useEffectEvent, useState } from "react";
import { t } from "../i18n/locale";
import { search } from "../jellyfin/browse";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import type { MediaItem } from "../jellyfin/library";
import { LandscapeCard } from "../home/LandscapeCard";
import { FocusButton } from "../navigation/Focusable";

interface Props {
  connection: Connection;
  userId: string;
  term: string;
  onOpen: (item: MediaItem) => void;
  onGenre: (genre: string) => void;
  onExpired: () => void;
}

/** Waits for the typing to pause before asking the server. */
const DEBOUNCE_MS = 300;
const EXPLORE = 10;

/**
 * Netflix web's search: the results take the home's place under the header, as a grid of
 * landscape cards, with the results' genres to explore further.
 */
export function SearchResults({ connection, userId, term, onOpen, onGenre, onExpired }: Props) {
  const [results, setResults] = useState<{ term: string; items: MediaItem[] } | null>(null);
  const fail = useEffectEvent((error: unknown) => {
    if (error instanceof SessionExpiredError) onExpired();
  });

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      search(connection, userId, term).then((items) => {
        if (current) setResults({ term, items });
      }, fail);
    }, DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [connection, userId, term]);

  if (!results) return <div className="min-h-dvh" />;
  if (results.items.length === 0) {
    return (
      <p className="px-(--gutter) pt-36 text-center text-lg text-white/70">
        {t.search.nothing(results.term)}
      </p>
    );
  }

  const genres = [...new Set(results.items.flatMap((item) => item.genres))].slice(0, EXPLORE);
  return (
    <section aria-label={t.search.results} className="min-h-dvh px-(--gutter) pt-32">
      {genres.length > 0 && (
        <p className="flex flex-wrap items-center gap-y-1 text-[17px]">
          <span className="mr-2.5 text-white/50">{t.search.explore}</span>
          {genres.map((genre, index) => (
            <FocusButton
              key={genre}
              onPress={() => onGenre(genre)}
              className={`px-2.5 leading-5 outline-none hover:underline focused:underline ${
                index > 0 ? "border-l border-white/30" : "pl-0"
              }`}
            >
              {genre}
            </FocusButton>
          ))}
        </p>
      )}
      <ul className="mt-6 grid grid-cols-3 gap-x-2 gap-y-5 lg:grid-cols-5">
        {results.items.map((item) => (
          <li key={item.id}>
            <LandscapeCard item={item} onOpen={() => onOpen(item)} showBadge />
          </li>
        ))}
      </ul>
    </section>
  );
}
