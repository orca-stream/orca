import { HugeiconsIcon } from "@hugeicons/react";
import { Film01Icon, FolderCheckIcon, Tv01Icon } from "@hugeicons/core-free-icons";
import type { SiteSearchResultDto } from "@orca/hm-contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import type { ExtractorDto, SeriesDto } from "@/api/types";
import { Tile } from "@/components/tile";
import {
  Pagination,
  PaginationButton,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/spinner";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { paletteOf } from "@/extractors/palette";
import { useDebounced } from "@/hooks/use-debounced";
import { useElementWidth } from "@/hooks/use-element-width";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { isSiteSearch, pagesAround, readableLabel } from "./site-search";

/** How long the name has to stay put before the sites are asked. */
const SEARCH_DELAY_MS = 400;
/** A result's narrowest column and the gap between them: the series' own grid (`FILL_TILE_GRID`). */
const TILE_MIN = 248;
const TILE_GAP = 24;
/** A page is this many full rows of whatever columns fit. */
const ROWS_PER_PAGE = 3;

/** A result, with the site that found it: picking it reads its address with that site's extractor. */
export type SiteFound = SiteSearchResultDto & { extractorId: string };

/** What the sites found for `query`, and what to say above the results. */
function useSiteSearch(query: string, extractors: readonly ExtractorDto[]) {
  const t = useT();
  const api = useApi();
  const typed = query.trim();
  const asked = useDebounced(isSiteSearch(typed) ? typed : "", SEARCH_DELAY_MS);
  const search = useQuery({
    ...queries.siteSearch(api, asked),
    enabled: asked !== "",
    // The results stay while the next answer comes, instead of blinking empty on every key.
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
  // Nothing to show yet: the first answer for this name (or any) has not come.
  const waiting = found.length === 0 && (search.isPending || asked !== typed);

  const status = allFailed
    ? t.add.siteSearchAllFailed
    : waiting
      ? t.add.siteSearching
      : found.length === 0
        ? t.add.siteNoResults(asked)
        : [
            t.add.siteSearchFor(asked),
            t.add.siteResults(found.length),
            failed.length > 0 ? t.add.siteSearchSome(failed.join(", ")) : null,
          ]
            .filter(Boolean)
            .join(" · ");

  return {
    asked,
    found,
    status,
    waiting: waiting && !allFailed,
    fetching: search.isFetching || asked !== typed,
  };
}

/**
 * What the searchable sites found by the name in the address, as a grid of covers a page at a time.
 * Picking one reads its address with the site that found it; one already added opens instead.
 */
export function SiteResults({
  query,
  extractors,
  series,
  reading,
  onPick,
}: {
  query: string;
  extractors: readonly ExtractorDto[];
  /** The series there are: a result that is one of them says so. */
  series: readonly SeriesDto[];
  /** The address being read, after a pick: the others wait. */
  reading: string | null;
  onPick: (found: SiteFound) => void;
}) {
  const t = useT();
  const { asked, found, status, waiting, fetching } = useSiteSearch(query, extractors);
  // Wider than a scrollbar: its coming and going with a short page must not change the columns.
  const [measure, width] = useElementWidth<HTMLElement>(SCROLLBAR_SLACK);
  const section = useRef<HTMLElement | null>(null);
  // One ref for the life of the list: a new function each render would be attached again on every
  // commit, measuring (and setting the width) each time — a loop once the width flips with the
  // page's scrollbar (a short last page), which blanked the screen.
  const sectionRef = useCallback(
    (node: HTMLElement | null) => {
      measure(node);
      section.current = node;
    },
    [measure],
  );
  const columns = Math.max(2, Math.floor((width + TILE_GAP) / (TILE_MIN + TILE_GAP)));
  const pageSize = columns * ROWS_PER_PAGE;
  // The first result shown, for the name it was shown for: a new name starts over, and a resize
  // keeps that result on the page it falls in.
  const [first, setFirst] = useState({ asked, index: 0 });
  const start = first.asked === asked ? first.index : 0;
  const pageCount = Math.max(1, Math.ceil(found.length / pageSize));
  const page = Math.min(Math.floor(start / pageSize), pageCount - 1);
  const shown = found.slice(page * pageSize, (page + 1) * pageSize);
  const extractorOf = (id: string) => extractors.find((extractor) => extractor.id === id) ?? null;

  function goTo(next: number) {
    setFirst({ asked, index: next * pageSize });
    // Back to the top of the results, under the bar, as a new page of a book.
    section.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }

  return (
    <section
      ref={sectionRef}
      aria-label={t.add.siteResultsLabel}
      aria-busy={fetching || undefined}
      className="flex w-full scroll-mt-32 flex-col gap-4"
    >
      <p role="status" className="px-2 text-sm text-muted-foreground">
        {status}
      </p>
      {waiting ? (
        <ul aria-hidden="true" className={RESULT_GRID}>
          {Array.from({ length: pageSize }, (_, index) => (
            <li key={index} className="glass aspect-3/4 animate-pulse rounded-3xl" />
          ))}
        </ul>
      ) : (
        shown.length > 0 && (
          <ul
            className={cn(RESULT_GRID, "transition-opacity duration-200", fetching && "opacity-60")}
          >
            {shown.map((item) => (
              <ResultTile
                key={`${item.extractorId} ${item.url}`}
                item={item}
                extractor={extractorOf(item.extractorId)}
                yours={
                  item.seriesId ? (series.find((one) => one.id === item.seriesId) ?? null) : null
                }
                reading={reading === item.url}
                disabled={reading !== null}
                onPick={() => onPick(item)}
              />
            ))}
          </ul>
        )
      )}
      {!waiting && pageCount > 1 && (
        <Pagination aria-label={t.add.sitePages}>
          <PaginationContent className="glass rounded-full p-2">
            <PaginationItem>
              <PaginationPrevious
                aria-label={t.add.sitePrevious}
                title={t.add.sitePrevious}
                disabled={page === 0}
                onClick={() => goTo(page - 1)}
              />
            </PaginationItem>
            {pagesAround(page, pageCount).map((index, at) => (
              <PaginationItem key={index ?? `gap ${at}`}>
                {index === null ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationButton
                    isActive={index === page}
                    aria-label={t.add.sitePage(index + 1)}
                    onClick={() => goTo(index)}
                  >
                    {index + 1}
                  </PaginationButton>
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                aria-label={t.add.siteNext}
                title={t.add.siteNext}
                disabled={page === pageCount - 1}
                onClick={() => goTo(page + 1)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </section>
  );
}

/** More than a scrollbar takes: a width change smaller than this is the scrollbar, not a resize. */
const SCROLLBAR_SLACK = 24;

/** The series' own grid: the columns stretch to fill the row (see `FILL_TILE_GRID`). */
const RESULT_GRID =
  "grid w-full grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))] sm:gap-6";

/** A result as the series' tiles are: its cover filling the card, its name and year over a shade. */
function ResultTile({
  item,
  extractor,
  yours,
  reading,
  disabled,
  onPick,
}: {
  item: SiteFound;
  extractor: ExtractorDto | null;
  yours: SeriesDto | null;
  reading: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const t = useT();
  const cover = item.posterUrl;
  const mine = item.seriesId !== null;
  // What it is (a movie), or what the site calls it (an OVA, a special): a hint of what to add it
  // as. A site's word for its own code (`tvshows`, `animes`) says nothing, so it is left out.
  const kindWord = item.kind === "movie" ? t.add.asMovie : readableLabel(item.label);
  const facts = [
    item.year === null ? null : String(item.year),
    item.seasons === null ? null : t.add.cardSeasons(item.seasons),
    item.originalTitle,
  ].filter((fact) => fact !== null);
  const label = [
    item.title,
    kindWord,
    ...facts,
    mine ? (yours ? `${t.add.siteFoundYours} · ${yours.title}` : t.add.siteFoundYours) : null,
    extractor ? t.add.siteFoundOn(extractor.name) : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <Tile
      covered={cover !== null}
      className={cn(
        "isolate has-[button:focus-visible]:ring-3 has-[button:focus-visible]:ring-ring/50",
        cover ? "bg-black/80" : "bg-linear-to-b from-primary/10 to-transparent",
        disabled && !reading && "opacity-60",
      )}
    >
      {cover && (
        <>
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover/tile:scale-[1.04]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-linear-to-t from-black/85 via-black/35 via-40% to-transparent to-65%"
          />
        </>
      )}
      <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-2 sm:inset-x-5 sm:top-5">
        {mine ? (
          // Already added, from any of its seasons: picking it opens that series.
          <span
            title={yours ? `${t.add.siteFoundYours} · ${yours.title}` : t.add.siteFoundYours}
            className="flex h-6 min-w-0 items-center gap-1 rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-xs"
          >
            <HugeiconsIcon icon={FolderCheckIcon} className="size-3.5 shrink-0" />
            <span className="truncate">{t.add.siteFoundYours}</span>
          </span>
        ) : kindWord ? (
          <span
            aria-hidden="true"
            title={kindWord}
            className="flex h-6 min-w-0 items-center gap-1 rounded-full bg-white/85 px-2.5 text-xs font-medium text-foreground shadow-xs ring-1 ring-black/5"
          >
            {item.kind === "movie" && (
              <HugeiconsIcon icon={Film01Icon} className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{kindWord}</span>
          </span>
        ) : (
          <span />
        )}
        {extractor && (
          // Over the card's button, so the pointer finds it: the site's name slides out of its icon.
          <span
            aria-hidden="true"
            style={paletteOf(extractor.id)}
            className="group/source relative z-10 flex h-10 min-w-0 shrink-0 items-center rounded-full bg-linear-to-br from-(--from) to-(--to) text-white shadow-sm ring-1 ring-white/50"
          >
            <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-300 ease-out group-hover/source:grid-cols-[1fr] motion-reduce:transition-none">
              <span className="min-w-0 overflow-hidden">
                <span className="block max-w-40 truncate pr-1 pl-4 text-sm font-medium whitespace-nowrap">
                  {extractor.name}
                </span>
              </span>
            </span>
            <ExtractorMark
              extractor={extractor}
              className="size-10 rounded-full bg-none ring-0"
              iconClassName="size-5"
            />
          </span>
        )}
      </div>
      <div className="flex flex-1 items-center justify-center">
        {reading ? (
          <span className="flex size-20 items-center justify-center rounded-3xl bg-white/85 text-primary shadow-lg">
            <Spinner className="size-8" />
          </span>
        ) : (
          !cover && (
            <span className="flex size-20 items-center justify-center rounded-3xl bg-linear-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/30">
              <HugeiconsIcon
                icon={item.kind === "movie" ? Film01Icon : Tv01Icon}
                className="size-10"
              />
            </span>
          )
        )}
      </div>
      <div className={cn("min-w-0 p-4 sm:p-5", cover && "text-white")}>
        <h3
          title={item.title}
          className="line-clamp-2 text-base leading-tight font-semibold tracking-tight sm:text-lg"
        >
          <button
            type="button"
            aria-label={label}
            disabled={disabled}
            onClick={onPick}
            className="text-left outline-none after:absolute after:inset-0 after:content-[''] disabled:cursor-default"
          >
            {item.title}
          </button>
        </h3>
        {facts.length > 0 && (
          <p
            className={cn(
              "mt-0.5 truncate text-xs tabular-nums sm:text-sm",
              cover ? "text-white/75" : "text-muted-foreground",
            )}
          >
            {facts.join(" · ")}
          </p>
        )}
      </div>
    </Tile>
  );
}
