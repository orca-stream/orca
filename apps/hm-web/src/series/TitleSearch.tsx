import { Autocomplete } from "@base-ui/react/autocomplete";
import { HugeiconsIcon } from "@hugeicons/react";
import { TextFontIcon, Tv01Icon } from "@hugeicons/core-free-icons";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import type { ShowSearchResultDto } from "@/api/types";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { useDebounced } from "@/hooks/use-debounced";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { BAR_POPUP, BAR_ROW } from "./bar";
import { searchQuery } from "./title-search";

/** How long the title has to stay put before TMDB is asked. */
const SEARCH_DELAY_MS = 350;
/**
 * The title of a new series, which is also where it is looked up on TMDB: what is typed (or, with
 * nothing typed, the site's name for it) lists TMDB's shows of that name below the row, and picking
 * one fills in its title, year and TMDB id. Typing alone stays a title of one's own.
 */
export function TitleSearch({
  value,
  siteTitle,
  onType,
  onPick,
}: {
  value: string;
  siteTitle: string | null;
  onType: (title: string) => void;
  onPick: (show: ShowSearchResultDto) => void;
}) {
  const t = useT();
  const api = useApi();
  const row = useRef<HTMLDivElement>(null);
  const wanted = searchQuery(value, siteTitle);
  const query = useDebounced(wanted, SEARCH_DELAY_MS);
  const search = useQuery({
    ...queries.showSearch(api, query),
    enabled: query !== "",
    // The list stays while the next answer comes, instead of blinking empty on every key.
    placeholderData: keepPreviousData,
  });
  const results = query !== "" ? (search.data ?? []) : [];

  // Said above the list: what it is for, or why it is empty.
  const status =
    query === ""
      ? null
      : search.isError
        ? search.error instanceof ApiError && search.error.status === 503
          ? t.add.tmdbUnavailable
          : t.add.tmdbSearchFailed
        : search.isSuccess && !search.isPlaceholderData && results.length === 0
          ? t.add.tmdbNoResults(query)
          : search.isPending
            ? t.add.tmdbSearching
            : t.add.tmdbSearchFor(query);

  return (
    <Autocomplete.Root
      items={results}
      value={value}
      onValueChange={(next, details) => {
        // Only typing writes the title: a pick fills it in through `onPick`, with the rest.
        if (details.reason === "input-change" || details.reason === "input-clear") onType(next);
      }}
      itemToStringValue={(show: ShowSearchResultDto) => show.title}
      filter={null}
      openOnInputClick
    >
      <InputGroup ref={row} className={cn(BAR_ROW, "rounded-none")}>
        <Autocomplete.Input
          render={
            <InputGroupInput
              aria-label={t.add.fieldTitle}
              placeholder={t.add.titlePlaceholder}
              className="h-full text-base"
            />
          }
        />
        <InputGroupAddon align="inline-start" className="w-[46px] justify-start pl-4">
          {search.isFetching ? (
            <Spinner aria-label={t.add.tmdbSearching} className="size-5" />
          ) : (
            <HugeiconsIcon icon={TextFontIcon} className="size-5" />
          )}
        </InputGroupAddon>
      </InputGroup>
      <Autocomplete.Portal hidden={status === null}>
        <Autocomplete.Positioner anchor={row} sideOffset={8} align="start" className="isolate z-50">
          <Autocomplete.Popup
            aria-busy={search.isFetching || undefined}
            className={cn(
              BAR_POPUP,
              "w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) duration-100 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0",
            )}
          >
            <Autocomplete.Status className="px-3 pt-2 pb-1 text-sm text-muted-foreground empty:hidden">
              {status}
            </Autocomplete.Status>
            <Autocomplete.List className="no-scrollbar max-h-[min(26rem,calc(var(--available-height)-3rem))] scroll-py-1 overflow-y-auto overscroll-contain">
              {(show: ShowSearchResultDto) => (
                <Autocomplete.Item
                  key={show.tmdbId}
                  value={show}
                  onClick={() => onPick(show)}
                  className="flex cursor-default items-center gap-3 rounded-xl p-2 outline-hidden select-none data-highlighted:bg-black/6"
                >
                  <ResultPoster url={show.posterUrl} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-base">{show.title}</span>
                    {show.originalTitle && (
                      <span className="truncate text-sm text-muted-foreground">
                        {t.add.tmdbOriginal(show.originalTitle)}
                      </span>
                    )}
                    {show.overview && (
                      <span className="line-clamp-1 text-sm text-muted-foreground">
                        {show.overview}
                      </span>
                    )}
                  </span>
                  {show.year !== null && (
                    <span className="shrink-0 pr-2 text-sm text-muted-foreground tabular-nums">
                      {show.year}
                    </span>
                  )}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}

/** A result's poster as a small card; without one, a TV in its place. */
function ResultPoster({ url }: { url: string | null }) {
  return (
    <span className="flex h-15 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/5 text-muted-foreground">
      {url ? (
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <HugeiconsIcon icon={Tv01Icon} className="size-5" />
      )}
    </span>
  );
}
