import type { ExtractorDto, SeriesDto } from "@orca/hm-contract";
import { Add01Icon, ArrowUpRight01Icon, Tv01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { Link } from "wouter";
import { useApi } from "@/api/context";
import { posterUrl, queries } from "@/api/queries";
import { DownloadingBadge } from "@/components/downloading-badge";
import { Dock, DockAdd, DockPlaces } from "@/components/dock";
import { extractorHref } from "@/extractors/href";
import { ROUND_ACTION, TILE_GRID, Tile, TileLink } from "@/components/tile";
import { useT } from "@/i18n/locale";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { paletteOf } from "@/extractors/palette";
import { cn } from "@/lib/utils";
import { runningFraction } from "@/series/download-line";

/** How many covers the series card fans out. */
const FANNED = 3;

/**
 * Up to three covers fanned like cards in a hand; they open a little more on hover. Each one opens its
 * series, and the one under the pointer comes to the front. A series' own
 * poster, else TMDB's (the same cached lookup its card and page ask for): with Jellyfin, which keeps
 * the images itself, a series seldom has one of its own.
 */
function Covers({ series }: { series: SeriesDto[] }) {
  const api = useApi();
  // The latest first: an episode just downloaded, or the series just added.
  const latest = (s: SeriesDto) => Math.max(s.lastDownloadAt ?? 0, s.createdAt);
  const candidates = series
    .filter((s) => s.hasPoster || s.tmdbId !== null)
    .toSorted((a, b) => latest(b) - latest(a));
  const lookups = useQueries({
    queries: candidates
      .filter((s) => !s.hasPoster)
      .slice(0, FANNED * 2)
      .map((s) => queries.showLookup(api, s.tmdbId ?? "", s.kind)),
  });
  const tmdbPoster = new Map(
    lookups.flatMap((q) => (q.data?.posterUrl ? [[q.data.tmdbId, q.data.posterUrl] as const] : [])),
  );
  const covers = candidates
    .flatMap((s) => {
      const src = s.hasPoster ? posterUrl(s) : tmdbPoster.get(s.tmdbId ?? "");
      return src ? [{ id: s.id, title: s.title, src }] : [];
    })
    .slice(0, FANNED);
  if (covers.length === 0) {
    return (
      <span className="flex size-20 items-center justify-center rounded-3xl bg-linear-to-br from-sky-400 to-primary text-white shadow-lg shadow-primary/30">
        <HugeiconsIcon icon={Tv01Icon} className="size-10" />
      </span>
    );
  }
  // Held like a hand of cards: each turns about one point well below the hand, so their tops trace
  // one even arc. The latest is in the middle and in front; the next ones behind, either side.
  // Spread at 11° on hover the hand is 1.34 cards tall wide, so a card is never taller than the
  // room allows: the whole hand stays inside the tile, at most 12 px into its padding either side.
  const slots = covers.length === 3 ? [1, 0, 2] : covers.length === 2 ? [1, 0] : [0];
  const middle = (covers.length - 1) / 2;
  // Above the tile's stretched link, but only the covers catch the pointer: the rest of the box
  // still opens the list.
  return (
    <div className="pointer-events-none relative z-10 h-full w-full [container-type:size]">
      {covers.map((s, rank) => {
        const offset = (slots[rank] ?? 0) - middle;
        return (
          <Link
            key={s.id}
            href={`/series/${encodeURIComponent(s.id)}`}
            aria-label={s.title}
            title={s.title}
            style={{ "--o": offset, "--z": covers.length - rank } as CSSProperties}
            className="pointer-events-auto absolute top-1/2 left-1/2 z-(--z) aspect-2/3 h-[min(84cqh,calc((100cqw+1.5rem)/1.36))] origin-[50%_180%] -translate-x-1/2 -translate-y-1/2 rotate-[calc(var(--o)*8deg)] overflow-hidden rounded-xl shadow-xl ring-1 ring-white/70 transition-transform duration-300 ease-out outline-none group-hover/tile:rotate-[calc(var(--o)*11deg)] hover:z-10 focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring"
          >
            <img src={s.src} alt="" loading="lazy" className="size-full object-cover" />
          </Link>
        );
      })}
    </div>
  );
}

function SeriesTile() {
  const t = useT();
  const api = useApi();
  const list = useQuery(queries.seriesList(api));
  const series = list.data ?? [];
  const downloading = series.reduce((sum, s) => sum + s.downloadingCount, 0);

  return (
    <Tile className="bg-linear-to-b from-primary/10 to-transparent">
      {downloading > 0 && (
        <DownloadingBadge
          count={downloading}
          progress={runningFraction(series)}
          className="absolute top-4 right-4 z-10 sm:top-5 sm:right-5"
        />
      )}
      <div className="flex flex-1 items-center justify-center p-4 pb-1 sm:p-6 sm:pb-2">
        <Covers series={series} />
      </div>
      <div className="flex items-end gap-2 p-4 pt-2 sm:gap-3 sm:p-5 sm:pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-tight sm:text-xl">
            <TileLink href="/series">{t.nav.series}</TileLink>
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
            {list.isSuccess
              ? series.length === 0
                ? t.home.seriesEmpty
                : t.home.libraryCount(
                    series.filter((one) => one.kind !== "movie").length,
                    series.filter((one) => one.kind === "movie").length,
                  )
              : list.isError
                ? t.dashboard.loadFailed
                : t.common.loading}
          </p>
        </div>
        <Link
          href="/series/new"
          aria-label={t.series.add}
          className={cn(ROUND_ACTION, "relative z-10")}
        >
          <HugeiconsIcon icon={Add01Icon} className="size-5" />
        </Link>
      </div>
    </Tile>
  );
}

function ExtractorTile({ extractor }: { extractor: ExtractorDto }) {
  const t = useT();
  const palette = paletteOf(extractor.id);
  const sites = extractor.explicit ? [t.extractors.explicitOnly] : extractor.hosts;
  // The first site and how many more: a long list of mirrors would fill the card.
  const [first = t.home.anyPage, ...rest] = sites;

  return (
    <Tile>
      <div
        aria-hidden="true"
        style={palette}
        className="absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-(--wash) to-transparent"
      />
      {/* The sites, as one badge in the top right corner: the first and how many more. */}
      <div className="absolute inset-x-4 top-4 flex justify-end sm:inset-x-5 sm:top-5">
        <span
          title={sites.length > 1 ? sites.join("\n") : undefined}
          className="flex min-w-0 gap-1 rounded-full bg-white/70 px-2.5 py-0.5 text-xs text-muted-foreground ring-1 ring-black/5"
        >
          <span className="min-w-0 truncate">{first}</span>
          {rest.length > 0 && <span className="shrink-0">+{rest.length}</span>}
        </span>
      </div>
      {/* Centred and sized like the series tile's icon, so the row reads as one set. */}
      <div className="relative flex flex-1 items-center justify-center p-4 pb-1 sm:p-6 sm:pb-2">
        <ExtractorMark
          extractor={extractor}
          className="size-20 rounded-3xl shadow-lg"
          iconClassName="size-10"
        />
      </div>
      <div className="flex items-end gap-2 p-4 pt-0 sm:gap-3 sm:p-5 sm:pt-0">
        <h2 className="min-w-0 flex-1 text-base leading-tight font-semibold tracking-tight sm:text-lg">
          {extractor.name}
        </h2>
        {/* The link stays unpositioned and untransformed, or it would trap its stretched ::after. */}
        <TileLink href={extractorHref(extractor)}>
          <span className="sr-only">{t.extractors.tryIt}</span>
        </TileLink>
        <span aria-hidden="true" className={cn(ROUND_ACTION, "group-hover/tile:scale-105")}>
          <HugeiconsIcon icon={ArrowUpRight01Icon} className="size-5" />
        </span>
      </div>
    </Tile>
  );
}

/** Ghost tiles while the extractors load, so the grid keeps its shape. */
function PlaceholderTile() {
  return <Tile className="animate-pulse opacity-60" />;
}

/** Home: the series and every extractor, as one grid of 3:4 glass cards in the middle of the screen. */
export function HomeScreen() {
  const t = useT();
  const api = useApi();
  const extractors = useQuery(queries.extractors(api));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6">
      <h1 className="sr-only">{t.nav.home}</h1>
      <ul className={TILE_GRID}>
        <SeriesTile />
        {extractors.isPending && <PlaceholderTile />}
        {extractors.data?.map((extractor) => (
          <ExtractorTile key={extractor.id} extractor={extractor} />
        ))}
      </ul>
      {extractors.isError && (
        <p role="alert" className="text-sm text-warning">
          {t.dashboard.loadFailed}
        </p>
      )}
      {extractors.isSuccess && extractors.data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.extractors.empty}</p>
      )}
      <Dock label={t.dock.label}>
        <DockPlaces here="home" />
        <DockAdd />
      </Dock>
    </div>
  );
}
