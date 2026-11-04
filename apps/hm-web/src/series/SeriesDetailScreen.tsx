import type { SeriesDto, ShowLookupDto } from "@orca/hm-contract";
import { useQueries, useQuery } from "@tanstack/react-query";
import { type CSSProperties, useState } from "react";
import { Link, useParams } from "wouter";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Link04Icon,
  ArrowLeft01Icon,
  Download04Icon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  RssIcon,
} from "@hugeicons/core-free-icons";
import { ApiError } from "@/api/client";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { Dock, DockButton, DockAdd, DockLink, DockPlaces, DockSeparator } from "@/components/dock";
import { posterUrl, queries } from "@/api/queries";
import { EmptyState } from "@/components/empty-state";
import { Loading } from "@/components/loading";
import { Spinner } from "@/components/ui/spinner";
import { buttonVariants } from "@/components/ui/button";
import { useElementHeight } from "@/hooks/use-element-height";
import { useLocale, useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { GLASS_PANEL } from "./bar";
import { CurrentDownloads } from "./CurrentDownloads";
import { PosterImage } from "./Poster";
import { guideKey } from "./preview-form";
import { absentSeasons } from "./tmdb-match";
import { AiringChip } from "./AiringChip";
import { airingHint } from "./airing";
import { SeriesEpisodes } from "./SeriesEpisodes";
import { addSourceHref } from "./add-source";
import { SeriesSettings } from "./SeriesSettings";
import { ShowBackdrop } from "./ShowBackdrop";
import { groupBySeason, missingIds, pruneSelection, setSeason, toggleSelected } from "./selection";

/** A link to an id's page on its site, as a chip of the card. */
function IdChip({ label, href, title }: { label: string; href: string; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title={title}
      className="rounded-full bg-white/70 px-2.5 py-1 text-xs text-muted-foreground ring-1 ring-black/5 transition-colors tabular-nums hover:bg-white hover:text-foreground"
    >
      {label}
    </a>
  );
}

/**
 * Who the series is, the way the card beside adding a series says it: the poster, the name, what
 * TMDB tells of it, and how much of it is here.
 */
function SeriesHero({
  series,
  tmdb,
  seasons,
}: {
  series: SeriesDto;
  tmdb: ShowLookupDto | null;
  seasons: number | null;
}) {
  const t = useT();
  const { patchSeries } = useMutations();
  const poster = series.hasPoster ? posterUrl(series.id) : (tmdb?.posterUrl ?? null);
  const overview = series.plot ?? tmdb?.overview ?? null;
  const facts = [
    series.year === null ? null : String(series.year),
    seasons === null ? null : t.series.detail.seasons(seasons),
  ].filter((fact) => fact !== null);
  const share = series.episodeCount === 0 ? 0 : series.availableCount / series.episodeCount;
  const hint = airingHint(series.follow, tmdb?.status ?? null);

  return (
    <section aria-labelledby="series-title" className="relative p-4">
      {/* The page has no bar of its own, as adding a series hasn't: this is the way back. */}
      <Link
        href="/series"
        aria-label={t.series.back}
        title={t.series.back}
        className="absolute top-4 right-4 flex size-10 items-center justify-center rounded-full bg-white/70 text-muted-foreground ring-1 ring-black/5 transition-colors hover:bg-white hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
      </Link>
      <div className="flex gap-4">
        <PosterImage
          src={poster}
          className="w-32 shrink-0 self-start rounded-2xl shadow-sm sm:w-36"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 id="series-title" className="line-clamp-2 pr-13 text-2xl leading-tight font-semibold">
            {series.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {facts.length > 0 && <span>{facts.join(" · ")}</span>}
            {hint ? (
              <AiringChip hint={hint} nextEpisode={tmdb?.nextEpisode ?? null} />
            ) : (
              series.follow && (
                <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  <HugeiconsIcon icon={RssIcon} className="size-3.5" />
                  {t.series.following}
                </span>
              )
            )}
          </div>
          {overview && (
            <p title={overview} className="mt-1 line-clamp-5 text-sm text-foreground/75">
              {overview}
            </p>
          )}
          {(series.tmdbId || series.imdbId) && (
            <p className="mt-auto flex flex-wrap gap-1.5 pt-2">
              {series.tmdbId && (
                <IdChip
                  label={`TMDB ${series.tmdbId}`}
                  href={`https://www.themoviedb.org/tv/${encodeURIComponent(series.tmdbId)}`}
                  title={t.series.detail.tmdbLink}
                />
              )}
              {series.imdbId && (
                <IdChip
                  label={`IMDb ${series.imdbId}`}
                  href={`https://www.imdb.com/title/${encodeURIComponent(series.imdbId)}/`}
                  title={t.series.detail.imdbLink}
                />
              )}
            </p>
          )}
        </div>
      </div>

      {/* How much of it is here, as the bar under the card; holding it gets a column of its own. */}
      <div className="mt-4 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium tabular-nums">
              {t.series.available(series.availableCount, series.episodeCount)}
            </span>
            {series.paused ? (
              <span className="flex items-center gap-1 text-warning">
                <HugeiconsIcon icon={PauseIcon} className="size-4" />
                {t.series.pausedLine(series.downloadingCount)}
              </span>
            ) : (
              series.downloadingCount > 0 && (
                <span className="flex items-center gap-1 text-primary">
                  <HugeiconsIcon icon={Download04Icon} className="size-4" />
                  {t.series.downloading(series.downloadingCount)}
                </span>
              )
            )}
          </div>
          <div
            aria-hidden="true"
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/8"
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-primary to-sky-400 transition-[width] duration-500"
              style={{ width: `${Math.round(share * 100)}%` }}
            />
          </div>
        </div>
        {/* Only where there is something to hold, or something held. */}
        {(series.paused || series.downloadingCount > 0) && (
          <button
            type="button"
            aria-label={series.paused ? t.series.resume : t.series.pause}
            title={series.paused ? t.series.resume : t.series.pauseHint}
            disabled={patchSeries.isPending}
            aria-busy={patchSeries.isPending || undefined}
            onClick={() =>
              patchSeries.mutate({ seriesId: series.id, patch: { paused: !series.paused } })
            }
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/70 ring-1 ring-black/5 transition-colors hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none disabled:opacity-60"
          >
            {patchSeries.isPending ? (
              <Spinner aria-hidden="true" className="size-5" />
            ) : (
              <HugeiconsIcon icon={series.paused ? PlayIcon : PauseIcon} className="size-5" />
            )}
          </button>
        )}
      </div>
    </section>
  );
}

export function SeriesDetailScreen() {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const { id } = useParams<{ id: string }>();
  const series = useQuery(queries.seriesDetail(api, id));
  const episodesQuery = useQuery(queries.episodes(api, id));
  const { enqueue, checkSeries, deleteEpisodeFile } = useMutations();

  const episodes = episodesQuery.data;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  // Which of the two bulk buttons is waiting on the server, so only that one shows busy.
  const [bulk, setBulk] = useState<"selected" | "missing" | null>(null);
  const [panelRef, panelHeight] = useElementHeight<HTMLDivElement>();

  // What TMDB says of the show, once it has an id: its picture behind the glass, its seasons, and
  // a frame and a name for each episode (the same cached answers adding a series asked for).
  const tmdbId = series.data?.tmdbId ?? "";
  const lookup = useQuery({ ...queries.showLookup(api, tmdbId), enabled: tmdbId !== "" });
  const guide = useQuery({
    ...queries.guideSeasons(api, tmdbId, locale),
    enabled: tmdbId !== "",
  });
  const guideSeasons = new Set((guide.data ?? []).map((season) => season.number));
  const had = new Set((episodes ?? []).map((episode) => episode.season));
  // The seasons TMDB has as aired and no source brings: they are listed too, all of them gaps.
  const absent = absentSeasons(guide.data ?? [], had);
  const seasons = [
    ...[...had].filter((season) => guideSeasons.has(season)),
    ...absent.map((season) => season.number),
  ];
  const guideEpisodes = useQueries({
    queries: seasons.map((season) => queries.guideEpisodes(api, tmdbId, season, locale)),
  });
  // Each season's whole list as TMDB has it, once known: what no source brings shows as a gap.
  const guideBySeason = new Map(
    seasons.flatMap((season, index) => {
      const listed = guideEpisodes[index]?.data;
      return listed ? [[season, listed] as const] : [];
    }),
  );
  const stills = new Map(
    seasons.flatMap((season, index) =>
      (guideEpisodes[index]?.data ?? []).map(
        (episode) => [guideKey(season, episode.number), episode] as const,
      ),
    ),
  );

  // Live updates can finish or start a download under a pick: what no longer applies is dropped.
  const selection = episodes ? pruneSelection(picked, episodes) : picked;

  if (series.isError && series.error instanceof ApiError && series.error.status === 404) {
    return (
      <EmptyState
        title={t.series.notFound}
        action={
          <Link href="/series" className={buttonVariants({ variant: "outline" })}>
            {t.series.back}
          </Link>
        }
      />
    );
  }
  if (!series.data || !episodes) {
    return series.isError || episodesQuery.isError ? (
      <p role="alert" className="text-sm text-warning">
        {t.dashboard.loadFailed}
      </p>
    ) : (
      <Loading />
    );
  }

  const data = series.data;
  const tmdb = lookup.data?.tmdbId === tmdbId ? lookup.data : null;
  const groups = groupBySeason(episodes);
  const missing = missingIds(episodes);
  function downloadMissing() {
    setBulk("missing");
    enqueue.mutate(missing, { onSettled: () => setBulk(null) });
  }
  // In the order the grid shows them, which is the order they should download in.
  const orderedSelection = groups
    .flatMap((g) => g.episodes)
    .filter((e) => selection.has(e.id))
    .map((e) => e.id);
  const seasonCount = guide.isSuccess
    ? guide.data.filter((season) => season.number > 0).length || null
    : groups.filter((group) => group.season > 0).length || null;
  const backdrop = tmdb
    ? tmdb.backdropUrl
      ? { src: tmdb.backdropUrl, poster: false }
      : { src: data.hasPoster ? posterUrl(data.id) : tmdb.posterUrl, poster: true }
    : data.hasPoster
      ? { src: posterUrl(data.id), poster: true }
      : null;

  return (
    <div className="flex w-full flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,38rem)_minmax(0,1fr)] xl:items-start">
      <ShowBackdrop src={backdrop?.src ?? null} poster={backdrop?.poster} />

      {/* The card and the bar stay in sight beside a long season. Taller than the window, they
          scroll with the page until their end shows and stick there, so it is never held back
          behind the end of the list. */}
      <div
        ref={panelRef}
        style={{ "--panel-h": `${panelHeight}px` } as CSSProperties}
        className={cn(
          GLASS_PANEL,
          "min-w-0 overflow-clip xl:sticky xl:top-[min(1rem,calc(100svh-var(--panel-h)-1rem))]",
        )}
      >
        <SeriesHero series={data} tmdb={tmdb} seasons={seasonCount} />
        <SeriesSettings series={data} checkSeries={checkSeries} showStatus={tmdb?.status ?? null} />
        <CurrentDownloads episodes={episodes} guide={stills} />
      </div>

      <SeriesEpisodes
        groups={groups}
        episodes={episodes}
        availableCount={data.availableCount}
        paused={data.paused}
        selection={selection}
        guide={stills}
        guideSeasons={guideBySeason}
        absentSeasons={absent}
        missingCount={missing.length}
        busy={bulk}
        failed={enqueue.isError || deleteEpisodeFile.isError}
        onToggle={(episodeId) => setPicked(() => toggleSelected(selection, episodes, episodeId))}
        onToggleSeason={(season, on) => setPicked(() => setSeason(selection, episodes, season, on))}
        onClear={() => setPicked(new Set())}
        onDownloadSelected={() => {
          setBulk("selected");
          enqueue.mutate(orderedSelection, {
            onSuccess: () => setPicked(new Set()),
            onSettled: () => setBulk(null),
          });
        }}
        onDownloadMissing={downloadMissing}
        onRetry={(episodeId) => enqueue.mutate([episodeId])}
        retryingId={
          enqueue.isPending && enqueue.variables?.length === 1
            ? (enqueue.variables[0] ?? null)
            : null
        }
        onDelete={(episodeId) => deleteEpisodeFile.mutate({ seriesId: data.id, episodeId })}
        deletingId={deleteEpisodeFile.isPending ? deleteEpisodeFile.variables.episodeId : null}
      />
      <Dock label={t.dock.label}>
        <DockPlaces here="series" />
        <DockAdd />
        <DockSeparator />
        <DockLink
          href={addSourceHref(data, episodes ?? [])}
          label={t.series.detail.addSource}
          icon={Link04Icon}
        />
        <DockButton
          label={t.series.downloadMissing}
          icon={Download04Icon}
          pending={bulk === "missing"}
          disabled={missing.length === 0 || bulk !== null}
          onClick={downloadMissing}
        />
        <DockButton
          label={t.dock.checkNow}
          icon={RefreshIcon}
          tone="primary"
          pending={checkSeries.isPending}
          onClick={() => checkSeries.mutate(data.id)}
        />
      </Dock>
    </div>
  );
}
