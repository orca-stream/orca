import { Autocomplete } from "@base-ui/react/autocomplete";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tv01Icon } from "@hugeicons/core-free-icons";
import type { SiteSearchResultDto } from "@orca/hm-contract";
import { MIN_SITE_SEARCH_LENGTH } from "@orca/hm-contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode, type RefObject } from "react";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import type { ExtractorDto } from "@/api/types";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { useDebounced } from "@/hooks/use-debounced";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { BAR_POPUP } from "./bar";

/** How long the name has to stay put before the sites are asked. */
const SEARCH_DELAY_MS = 400;

/** A result, with the site that found it: picking it reads its address with that site's extractor. */
export type SiteFound = SiteSearchResultDto & { extractorId: string };

/** What the sites found for `query` (when it is one), and what to say above the list. */
function useSiteSearch(query: string | null, extractors: readonly ExtractorDto[]) {
  const t = useT();
  const api = useApi();
  const typed = query?.trim() ?? "";
  const asked = useDebounced(typed.length >= MIN_SITE_SEARCH_LENGTH ? typed : "", SEARCH_DELAY_MS);
  const search = useQuery({
    ...queries.siteSearch(api, asked),
    enabled: asked !== "",
    // The list stays while the next answer comes, instead of blinking empty on every key.
    placeholderData: keepPreviousData,
  });
  const sites = asked !== "" ? (search.data ?? []) : [];
  const found: SiteFound[] = sites.flatMap((site) =>
    site.results.map((result) => ({ ...result, extractorId: site.extractorId })),
  );
  const failed = sites
    .filter((site) => site.failed)
    .map((site) => extractors.find((extractor) => extractor.id === site.extractorId)?.name)
    .filter((name) => name !== undefined);
  const allFailed = search.isError || (sites.length > 0 && failed.length === sites.length);

  const status =
    query === null
      ? null
      : typed.length < MIN_SITE_SEARCH_LENGTH
        ? t.add.siteSearchShort(MIN_SITE_SEARCH_LENGTH)
        : allFailed
          ? t.add.siteSearchAllFailed
          : search.isPending || asked !== typed
            ? t.add.siteSearching
            : found.length === 0
              ? t.add.siteNoResults(asked)
              : [
                  t.add.siteSearchFor(asked),
                  failed.length > 0 ? t.add.siteSearchSome(failed.join(", ")) : null,
                ]
                  .filter(Boolean)
                  .join(" · ");

  return { found, status, fetching: search.isFetching };
}

/**
 * The address, which is also where the sites are searched: text that is not a web address lists
 * what the searchable sites found by that name, below the whole bar, and picking one reads it. The
 * input inside is an `Autocomplete.Input`; typing goes through `onType` as before.
 */
export function SiteSearch({
  value,
  query,
  extractors,
  anchor,
  onType,
  onPick,
  children,
}: {
  value: string;
  /** What to search, or null when the address is not a search (a web address, or no site to ask). */
  query: string | null;
  extractors: readonly ExtractorDto[];
  anchor: RefObject<HTMLElement | null>;
  onType: (text: string) => void;
  onPick: (found: SiteFound) => void;
  children: ReactNode;
}) {
  const t = useT();
  const { found, status, fetching } = useSiteSearch(query, extractors);
  // Open only while the address is a search: a web address leaves the rest of the screen alone.
  const [open, setOpen] = useState(false);
  const extractorOf = (id: string) => extractors.find((extractor) => extractor.id === id) ?? null;

  return (
    <Autocomplete.Root
      items={found}
      value={value}
      onValueChange={(next, details) => {
        // Only typing writes the address: a pick fills it in through `onPick`.
        if (details.reason === "input-change" || details.reason === "input-clear") onType(next);
      }}
      itemToStringValue={(item: SiteFound) => item.url}
      filter={null}
      open={open && status !== null}
      onOpenChange={setOpen}
      // The fields below stay usable while the list is open.
      modal={false}
      openOnInputClick
    >
      {children}
      <Autocomplete.Portal hidden={status === null}>
        <Autocomplete.Positioner
          anchor={anchor}
          sideOffset={8}
          align="start"
          className="isolate z-50"
        >
          <Autocomplete.Popup
            aria-busy={fetching || undefined}
            className={cn(
              BAR_POPUP,
              "w-(--anchor-width) max-w-(--available-width) origin-(--transform-origin) duration-100 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0",
            )}
          >
            <Autocomplete.Status className="px-3 pt-2 pb-1 text-sm text-muted-foreground empty:hidden">
              {status}
            </Autocomplete.Status>
            <Autocomplete.List className="no-scrollbar max-h-[min(30rem,calc(var(--available-height)-3rem))] scroll-py-1 overflow-y-auto overscroll-contain">
              {(item: SiteFound) => {
                const extractor = extractorOf(item.extractorId);
                return (
                  <Autocomplete.Item
                    key={`${item.extractorId} ${item.url}`}
                    value={item}
                    onClick={() => onPick(item)}
                    className="flex cursor-default items-center gap-3 rounded-xl p-2 outline-hidden select-none data-highlighted:bg-black/6"
                  >
                    <ResultPoster url={item.posterUrl} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-base">{item.title}</span>
                      {item.originalTitle && (
                        <span className="truncate text-sm text-muted-foreground">
                          {t.add.tmdbOriginal(item.originalTitle)}
                        </span>
                      )}
                      {item.plot && (
                        <span className="line-clamp-1 text-sm text-muted-foreground">
                          {item.plot}
                        </span>
                      )}
                    </span>
                    {item.year !== null && (
                      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                        {item.year}
                      </span>
                    )}
                    {extractor && (
                      <span title={extractor.name} className="shrink-0 pr-1">
                        <ExtractorMark
                          extractor={extractor}
                          className="size-10 rounded-full"
                          iconClassName="size-5"
                        />
                        <span className="sr-only">{t.add.siteFoundOn(extractor.name)}</span>
                      </span>
                    )}
                  </Autocomplete.Item>
                );
              }}
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
