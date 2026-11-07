import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect, useEffectEvent, useState } from "react";
import { t } from "../i18n/locale";
import { search, suggestions } from "../jellyfin/browse";
import { SessionExpiredError, type Connection } from "../jellyfin/client";
import type { MediaItem } from "../jellyfin/library";
import { PosterCard } from "../home/PosterCard";
import { FocusButton, FocusInput } from "../navigation/Focusable";
import { BackIcon, PlayCircleIcon } from "@orca/ui/icons";

interface Props {
  connection: Connection;
  userId: string;
  wide: boolean;
  onClose: () => void;
  onOpen: (item: MediaItem) => void;
  onExpired: () => void;
}

/** Waits for the typing to pause before asking the server. */
const DEBOUNCE_MS = 300;

export function SearchPage({ connection, userId, wide, onClose, onOpen, onExpired }: Props) {
  const [term, setTerm] = useState("");
  const [suggested, setSuggested] = useState<MediaItem[] | null>(null);
  const [results, setResults] = useState<{ term: string; items: MediaItem[] } | null>(null);
  const { ref, focusKey } = useFocusable({
    focusKey: "SEARCH_PAGE",
    isFocusBoundary: true,
    preferredChildFocusKey: "SEARCH_INPUT",
  });
  const query = term.trim();
  const fail = useEffectEvent((error: unknown) => {
    if (error instanceof SessionExpiredError) onExpired();
  });

  useEffect(() => {
    let current = true;
    suggestions(connection, userId).then((items) => {
      if (current) setSuggested(items);
    }, fail);
    return () => {
      current = false;
    };
  }, [connection, userId]);

  useEffect(() => {
    if (!query) return;
    // Aborted, not a reassigned flag: React's immutability rule rejects reassigning a variable
    // after render, and a late answer for an older query must not land.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      search(connection, userId, query).then((items) => {
        if (!controller.signal.aborted) setResults({ term: query, items });
      }, fail);
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [connection, userId, query]);

  const shown = query ? results : null;

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={t.home.search}
        className="fixed inset-0 z-30 overflow-y-auto bg-black pb-28"
      >
        <div className="sticky top-0 z-10 box-content flex h-[52px] items-center gap-1 bg-[#2f2f2f] px-1 pt-[env(safe-area-inset-top)]">
          <FocusButton
            aria-label={t.title.back}
            onPress={onClose}
            className="grid size-11 flex-none place-items-center rounded-full outline-none focused:bg-white focused:text-black"
          >
            <BackIcon className="size-6" />
          </FocusButton>
          <FocusInput
            focusKey="SEARCH_INPUT"
            type="search"
            // The phone app opens the keyboard at once.
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t.search.placeholder}
            aria-label={t.search.placeholder}
            enterKeyHint="search"
            className="h-full min-w-0 flex-1 bg-transparent pr-3 text-[17px] text-white outline-none placeholder:text-white/50"
          />
        </div>

        {shown ? (
          shown.items.length === 0 ? (
            <p className="px-3 py-10 text-center text-white/60">{t.search.nothing(shown.term)}</p>
          ) : (
            <section className="px-3">
              <h2 className="mt-4 mb-2 text-[19px] font-bold">{t.search.results}</h2>
              <ul className={`grid gap-1.5 ${wide ? "grid-cols-6" : "grid-cols-3"}`}>
                {shown.items.map((item) => (
                  <li key={item.id}>
                    <PosterCard item={item} onOpen={() => onOpen(item)} />
                  </li>
                ))}
              </ul>
            </section>
          )
        ) : (
          <section>
            <h2 className="mt-4 mb-2 px-3 text-[19px] font-bold">{t.search.suggested}</h2>
            <ul className="grid gap-1.5">
              {(suggested ?? []).map((item) => (
                <li key={item.id}>
                  <SuggestionRow item={item} onOpen={() => onOpen(item)} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </FocusContext.Provider>
  );
}

/** A landscape still, the title, and a round play button on the right: one 75 px row. */
function SuggestionRow({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const image = item.cardImage?.url ?? item.backdropUrl;
  return (
    <FocusButton
      onPress={onOpen}
      className="flex w-full items-center gap-3 pr-3 pl-3 text-left outline-none focused:bg-white/15"
    >
      <span className="aspect-video w-[131px] flex-none overflow-hidden rounded-[3px] bg-neutral-800">
        {image && <img src={image} alt="" loading="lazy" className="size-full object-cover" />}
      </span>
      <span className="line-clamp-2 flex-1 text-[16px] leading-[21px] font-bold">{item.title}</span>
      <PlayCircleIcon className="size-[31px] flex-none text-white" />
    </FocusButton>
  );
}
