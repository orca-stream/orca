import type { ExtractorDto, SeriesDto } from "@orca/hm-contract";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Alert02Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  Home01Icon,
  Link01Icon,
  Search01Icon,
  Tv01Icon,
} from "@hugeicons/core-free-icons";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useApi } from "@/api/context";
import { posterUrl, queries } from "@/api/queries";
import { Dock, DockAdd, DockButton, DockPlaces, DockSeparator } from "@/components/dock";
import { Loading } from "@/components/loading";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import {
  CENTRED_TILE_GRID,
  FILL_TILE_GRID,
  ROUND_ACTION,
  TILE_GRID,
  Tile,
  TileLink,
} from "@/components/tile";
import { useElementWidth } from "@/hooks/use-element-width";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { DownloadingBadge } from "@/components/downloading-badge";
import { AiringChip, CHIP_HOVER_CARD } from "./AiringChip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { runningFraction } from "./download-line";
import { airingHint, finishedStatus } from "./airing";

/** The chips along a tile's top edge, all 24px tall: the open sources' pill sets it with its marks. */
const CHIP = "flex h-6 items-center rounded-full px-2.5 text-xs font-medium ring-1";

/**
 * What TMDB tells of a series for its card (the same cached lookup its page asks for): the cover,
 * its own when the server has one, and whether the show still airs.
 */
function useShow(series: SeriesDto) {
  const api = useApi();
  const tmdbId = series.tmdbId ?? "";
  const lookup = useQuery({ ...queries.showLookup(api, tmdbId), enabled: tmdbId !== "" });
  const show = lookup.data?.tmdbId === tmdbId ? lookup.data : null;
  return {
    cover: series.hasPoster ? posterUrl(series.id) : (show?.posterUrl ?? null),
    hint: airingHint(series.follow, show?.status ?? null),
    ended: finishedStatus(show?.status),
    nextEpisode: show?.nextEpisode ?? null,
  };
}

/**
 * The sources a series is still read from (the closed ones left out), as a chip in the card's top
 * left corner: each site's mark once, overlapping, and how many there are. Which, on hover. Amber,
 * with a warning, when TMDB says the show won't air again: those are worth closing.
 */
function OpenSources({ series, ended }: { series: SeriesDto; ended: "ended" | "canceled" | null }) {
  const t = useT();
  const api = useApi();
  const extractors = useQuery(queries.extractors(api));
  const open = series.sources.filter((source) => !source.closed);
  if (open.length === 0) return null;

  const sites = new Map<string, { extractor: ExtractorDto | null; count: number }>();
  for (const source of open) {
    const site = sites.get(source.extractorId);
    if (site) site.count += 1;
    else {
      const extractor = extractors.data?.find((one) => one.id === source.extractorId) ?? null;
      sites.set(source.extractorId, { extractor, count: 1 });
    }
  }
  const label = t.series.openSources(open.length);
  const warning = ended && t.series.detail.sourceStillOpenHint(ended);
  const markOf = (id: string, extractor: ExtractorDto | null, icon?: typeof Alert02Icon) =>
    extractor ? (
      <ExtractorMark
        key={id}
        extractor={extractor}
        icon={icon}
        className="size-5 rounded-full ring-white"
        iconClassName="size-3"
      />
    ) : (
      <span
        key={id}
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black/10 ring-1 ring-white"
      >
        <HugeiconsIcon icon={icon ?? Link01Icon} className="size-3" />
      </span>
    );

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={100}
        render={<span />}
        className={cn(
          "flex h-6 shrink-0 cursor-help items-center gap-1.5 rounded-full pr-2.5 pl-0.5 text-xs font-medium tabular-nums ring-1",
          warning
            ? "bg-amber-100 text-amber-900 ring-amber-500/40"
            : "bg-white/80 text-foreground/80 ring-black/5",
        )}
      >
        <span className="sr-only">{warning ? `${label}. ${warning}` : label}</span>
        <span aria-hidden="true" className="flex -space-x-1.5">
          {[...sites.entries()].map(([id, { extractor }]) =>
            markOf(id, extractor, warning ? Alert02Icon : undefined),
          )}
        </span>
        <span aria-hidden="true">{open.length}</span>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" sideOffset={6} className={CHIP_HOVER_CARD}>
        <p className="font-medium">{label}</p>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {[...sites.entries()].map(([id, { extractor, count }]) => (
            <li key={id} className="flex items-center gap-2">
              {markOf(id, extractor)}
              <span className="min-w-0 flex-1 truncate">{extractor?.name ?? id}</span>
              <span className="text-muted-foreground tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
        {warning && (
          <p className="mt-2 flex gap-1.5 border-t border-(--glass-edge) pt-2 text-amber-900">
            <HugeiconsIcon
              icon={Alert02Icon}
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {warning}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * A series as a home card: its cover is the whole card, darkened towards the bottom so the name and
 * how many of its episodes are here read over it.
 */
function SeriesTile({ series }: { series: SeriesDto }) {
  const t = useT();
  const { cover, hint, ended, nextEpisode } = useShow(series);
  const downloading = series.downloadingCount;

  return (
    <Tile className={cover ? "bg-black/80" : "bg-linear-to-b from-primary/10 to-transparent"}>
      {cover && (
        <>
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover/tile:scale-[1.04]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-linear-to-t from-black/85 via-black/35 via-40% to-transparent to-65%"
          />
        </>
      )}
      <div className="absolute inset-x-4 top-4 z-10 flex items-start gap-1.5 sm:inset-x-5 sm:top-5">
        <OpenSources series={series} ended={ended} />
        {(series.follow || hint || downloading > 0) && (
          <p className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
            {hint ? (
              <AiringChip hint={hint} nextEpisode={nextEpisode} className="h-6 py-0 pl-2 pr-2.5" />
            ) : (
              series.follow && (
                <span className={cn(CHIP, "bg-white/80 text-foreground/80 ring-black/5")}>
                  {t.series.following}
                </span>
              )
            )}
            {downloading > 0 && (
              <DownloadingBadge
                count={downloading}
                progress={runningFraction([series])}
                seriesId={series.id}
              />
            )}
          </p>
        )}
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        {!cover && (
          <span className="flex size-20 items-center justify-center rounded-3xl bg-linear-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/30">
            <HugeiconsIcon icon={Tv01Icon} className="size-10" />
          </span>
        )}
      </div>
      <div className="relative flex items-end gap-2 p-4 sm:gap-3 sm:p-5">
        <div className={cn("min-w-0 flex-1", cover && "text-white")}>
          <h2
            title={series.title}
            className="line-clamp-2 text-base leading-tight font-semibold tracking-tight sm:text-lg"
          >
            <TileLink href={`/series/${encodeURIComponent(series.id)}`}>{series.title}</TileLink>
          </h2>
          <p
            className={cn(
              "mt-0.5 truncate text-xs tabular-nums sm:text-sm",
              cover ? "text-white/75" : "text-muted-foreground",
            )}
          >
            {series.year ? `${series.year} · ` : ""}
            {series.availableCount}/{series.episodeCount}
          </p>
        </div>
        <span aria-hidden="true" className={cn(ROUND_ACTION, "group-hover/tile:scale-105")}>
          <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-5" />
        </span>
      </div>
    </Tile>
  );
}

/** The very first card: the way back home, where the series and the extractors are. */
function HomeTile() {
  const t = useT();
  return (
    <Tile>
      <div className="flex flex-1 items-center justify-center p-4 pb-1 sm:p-6 sm:pb-2">
        <span className="flex size-20 items-center justify-center rounded-3xl bg-white/80 text-primary shadow-lg ring-1 shadow-black/5 ring-black/5 transition-transform duration-300 motion-safe:group-hover/tile:scale-105">
          <HugeiconsIcon icon={Home01Icon} className="size-10" />
        </span>
      </div>
      <div className="flex items-end gap-2 p-4 pt-2 sm:gap-3 sm:p-5 sm:pt-3">
        <h2 className="min-w-0 flex-1 text-base leading-tight font-semibold tracking-tight sm:text-lg">
          <TileLink href="/">{t.nav.home}</TileLink>
        </h2>
      </div>
    </Tile>
  );
}

/** A tile's narrowest column and the gap between them, from sm up (see FILL_TILE_GRID). */
const TILE_MIN = 248;
const TILE_GAP = 24;

/** The card after it: the way to add one more, as plain as the series tile on home. */
function AddTile() {
  const t = useT();
  return (
    <Tile className="bg-linear-to-b from-primary/10 to-transparent">
      <div className="flex flex-1 items-center justify-center p-4 pb-1 sm:p-6 sm:pb-2">
        <span className="flex size-20 items-center justify-center rounded-3xl bg-linear-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/30 transition-transform duration-300 motion-safe:group-hover/tile:scale-105">
          <HugeiconsIcon icon={Add01Icon} className="size-10" />
        </span>
      </div>
      <div className="flex items-end gap-2 p-4 pt-2 sm:gap-3 sm:p-5 sm:pt-3">
        <h2 className="min-w-0 flex-1 text-base leading-tight font-semibold tracking-tight sm:text-lg">
          <TileLink href="/series/new">{t.series.add}</TileLink>
        </h2>
      </div>
    </Tile>
  );
}

/** Whether a key pressed on this goes into it as text. */
function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}

/** A title as the search compares it: no case, no accents. */
function folded(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * The dock turned into a search bar: the magnifier on the left, the query in the middle and, on the
 * right, the way to clear it (or, once empty, to put the dock back).
 */
function SearchBar({
  input,
  query,
  onChange,
  onClose,
}: {
  input: RefObject<HTMLInputElement | null>;
  query: string;
  onChange: (query: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const empty = query === "";

  return (
    <div className="flex w-[min(32rem,calc(100vw-2.5rem))] items-center gap-1 duration-200 animate-in fade-in-0 zoom-in-95">
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center text-primary"
      >
        <HugeiconsIcon icon={Search01Icon} className="size-5.5" />
      </span>
      <input
        ref={input}
        type="search"
        autoFocus
        value={query}
        aria-label={t.dock.searchField}
        placeholder={t.dock.searchPlaceholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      <DockButton
        label={empty ? t.dock.close : t.dock.clear}
        icon={Cancel01Icon}
        onClick={() => {
          if (empty) return onClose();
          onChange("");
          input.current?.focus();
        }}
      />
    </div>
  );
}

/**
 * The series as a grid of home cards filling the window, as far from its edges as from each other,
 * with no bar or title above them. The dock below holds the ways out and a search that narrows them.
 */
export function SeriesListScreen() {
  const t = useT();
  const api = useApi();
  const list = useQuery(queries.seriesList(api));
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  // "/" opens the search ready to type, as on most sites; typed into a field, it is just a slash.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target)) return;
      event.preventDefault();
      setSearching(true);
      searchInput.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  const needle = folded(query.trim());
  const shown = list.data?.filter((series) => folded(series.title).includes(needle)) ?? [];
  const [measure, width] = useElementWidth<HTMLDivElement>();
  // Fewer tiles than a row holds would sit to the left of a filling grid: they go in the middle,
  // at home's size, until there are enough to fill the row.
  const fillsARow = 2 + shown.length >= Math.floor((width + TILE_GAP) / (TILE_MIN + TILE_GAP));

  return (
    <div ref={measure} className="flex w-full flex-col items-center gap-6">
      <h1 className="sr-only">{t.series.title}</h1>
      {list.isPending && <Loading />}
      {list.isError && (
        <p role="alert" className="text-sm text-warning">
          {t.dashboard.loadFailed}
        </p>
      )}
      {list.isSuccess && (
        <ul className={needle !== "" ? CENTRED_TILE_GRID : fillsARow ? FILL_TILE_GRID : TILE_GRID}>
          {/* While a search narrows the list, only the series that match are left. */}
          {needle === "" && (
            <>
              <HomeTile />
              <AddTile />
            </>
          )}
          {shown.map((series) => (
            <SeriesTile key={series.id} series={series} />
          ))}
        </ul>
      )}
      {list.isSuccess && list.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t.series.empty} {t.series.emptyHint}
        </p>
      )}
      {list.isSuccess && needle !== "" && shown.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          {t.dock.noMatch(query.trim())}
        </p>
      )}
      <Dock label={t.dock.label} pinned={searching}>
        {searching ? (
          <SearchBar
            input={searchInput}
            query={query}
            onChange={setQuery}
            onClose={() => {
              setQuery("");
              setSearching(false);
            }}
          />
        ) : (
          <div className="flex items-center gap-1 duration-200 animate-in fade-in-0 zoom-in-95">
            <DockPlaces here="series" />
            <DockAdd />
            <DockSeparator />
            <DockButton
              label={t.dock.search}
              icon={Search01Icon}
              tone="primary"
              onClick={() => setSearching(true)}
            />
          </div>
        )}
      </Dock>
    </div>
  );
}
