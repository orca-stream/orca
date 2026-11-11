import type { EpisodeDto, GuideEpisodeDto, GuideSeasonDto } from "@orca/hm-contract";
import { useState } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  ArrowDataTransferHorizontalIcon,
  Cancel01Icon,
  Clock01Icon,
  CloudOffIcon,
  Delete02Icon,
  ArrowDown03Icon,
  PauseIcon,
  RefreshIcon,
  Tick02Icon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes, formatDate, formatDuration } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { useRetryingImage } from "@/lib/retrying-image";
import { cn } from "@/lib/utils";
import {
  BAR_POPUP,
  GLASS_PANEL,
  ISLAND,
  PILL_BUTTON,
  PRIMARY,
  SECONDARY,
  SPLIT_HALF,
  SPLIT_PILL,
} from "./bar";
import { downloadFraction, downloadLine } from "./download-line";
import { GapCard } from "./EpisodeGrid";
import { episodeCode, guideKey } from "./preview-form";
import { isSelectable, seasonState, type SeasonGroup } from "./selection";
import { localToday, matchTmdb, numberRanges, type SeasonMatch } from "./tmdb-match";

/** The glass every chip over a frame is made of: dark, so it reads on any picture. */
const CHIP =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap backdrop-blur-md";

const STATUS_STYLE: Record<EpisodeDto["status"], string> = {
  available: "bg-emerald-500/90 text-white",
  downloading: "bg-primary text-primary-foreground",
  queued: "bg-white/90 text-foreground",
  missing: "bg-black/45 text-white/90",
  failed: "bg-warning text-white",
};

const STATUS_ICON: Partial<Record<EpisodeDto["status"], IconSvgElement>> = {
  available: Tick02Icon,
  queued: Clock01Icon,
  failed: Alert02Icon,
};

/** The episode's box, while it is not picked: its state at a glance, tinted like its chip. */
const BOX_STYLE: Record<EpisodeDto["status"] | "held", string> = {
  available: "bg-emerald-500/90 text-white ring-white/40",
  downloading: "bg-black/30 text-white/70 ring-white/30",
  queued: "bg-white/85 text-foreground ring-black/10",
  held: "bg-white/85 text-foreground ring-black/10",
  missing: "bg-black/30 text-white/85 ring-white/60",
  failed: "bg-warning text-white ring-white/40",
};

const BOX_ICON: Record<Exclude<EpisodeDto["status"], "downloading"> | "held", IconSvgElement> = {
  available: Tick02Icon,
  queued: Clock01Icon,
  held: PauseIcon,
  missing: CloudOffIcon,
  failed: Alert02Icon,
};

/** The pill buttons of the header and of the selection's bar. */

interface SeriesEpisodesProps {
  groups: SeasonGroup[];
  episodes: readonly EpisodeDto[];
  availableCount: number;
  /** The series is paused: its queued episodes wait for it, and say so. */
  paused?: boolean;
  selection: ReadonlySet<string>;
  /** TMDB's episodes by `guideKey`, where they are known: the frame, the name, the synopsis. */
  guide: ReadonlyMap<string, GuideEpisodeDto>;
  /** TMDB's whole list of each season the series has, where known: what no source brings. */
  guideSeasons?: ReadonlyMap<number, readonly GuideEpisodeDto[]>;
  /** The seasons TMDB has as aired that no source brings anything of. */
  absentSeasons?: readonly GuideSeasonDto[];
  missingCount: number;
  busy: "selected" | "missing" | null;
  failed: boolean;
  onToggle: (episodeId: string) => void;
  onToggleSeason: (season: number, on: boolean) => void;
  onClear: () => void;
  onDownloadSelected: () => void;
  onDownloadMissing: () => void;
  onRetry: (episodeId: string) => void;
  retryingId: string | null;
  /** Deletes a downloaded episode's file, so it can be downloaded again. */
  onDelete?: (episodeId: string) => void;
  deletingId?: string | null;
  /** What a change of source did, said under the header until the next one. */
  notice?: string | null;
  /**
   * More for the header, about the season shown (its preferred source). `half` is the class that
   * makes it the second half of the season's pill, empty when there is no season list to share.
   */
  seasonTools?: (season: number, half: string) => React.ReactNode;
  /** More for the selection's bar, before its download button (change the source). */
  selectionTools?: React.ReactNode;
  /** The mark of the source an episode takes its video from, over its frame. */
  sourceMark?: (episode: EpisodeDto) => React.ReactNode;
  /** The name of the source a file came from, when it isn't the episode's source any more. */
  fileSourceName?: (episode: EpisodeDto) => string | null;
}

/**
 * The series' episodes as frames on the backdrop, one season at a time. The header says how many
 * are here and fetches what is missing; picking frames brings up a bar to download just those.
 */
export function SeriesEpisodes({
  groups,
  episodes,
  availableCount,
  paused = false,
  selection,
  guide,
  guideSeasons = new Map(),
  absentSeasons = [],
  missingCount,
  busy,
  failed,
  onToggle,
  onToggleSeason,
  onClear,
  onDownloadSelected,
  onDownloadMissing,
  onRetry,
  retryingId,
  onDelete,
  deletingId = null,
  notice = null,
  seasonTools,
  selectionTools,
  sourceMark,
  fileSourceName,
}: SeriesEpisodesProps) {
  const t = useT();
  const [chosen, setChosen] = useState<number | null>(null);
  // Every season TMDB has as aired, not only those a source brings: one no source has is there
  // too, empty, so its episodes show as gaps.
  const rank = (season: number) => (season === 0 ? Number.POSITIVE_INFINITY : season);
  const listed: SeasonGroup[] = [
    ...groups,
    ...absentSeasons.map((season) => ({ season: season.number, episodes: [] })),
  ].toSorted((a, b) => rank(a.season) - rank(b.season));
  const tmdbCount = new Map(absentSeasons.map((season) => [season.number, season.episodeCount]));
  const group = listed.find((g) => g.season === chosen) ?? listed[0];
  const titleOf = (season: number) => (season === 0 ? t.series.specials : t.series.season(season));
  const seasonPicked = group ? seasonState(selection, episodes, group.season) : "none";
  // What TMDB lists for the seasons the series has and no source brought: aired, or still to air.
  const matches = matchTmdb(episodes, guideSeasons, new Set(), localToday());
  const gapsOf = (season: number) => matches.find((match) => match.season === season);
  const absent = matches.filter((match) => match.missing.length > 0);
  // The season's episodes and its gaps together, in number order.
  const shown = group
    ? (gapsOf(group.season) ?? wholeSeason(guideSeasons.get(group.season), localToday()))
    : undefined;
  const cells: Cell[] = group
    ? [
        ...group.episodes.map((episode) => ({
          kind: "episode" as const,
          episode,
          number: episode.episode,
        })),
        ...[...(shown?.missing ?? []), ...(shown?.upcoming ?? [])].map((number) => ({
          kind: "gap" as const,
          number,
          aired: shown?.missing.includes(number) ?? false,
        })),
      ].sort((a, b) => a.number - b.number)
    : [];

  const seasonPicker = listed.length > 1 && group !== undefined;
  const pairedTools = seasonPicker && group ? seasonTools?.(group.season, SPLIT_HALF) : null;
  const loneTools = !seasonPicker && group ? seasonTools?.(group.season, "") : null;

  return (
    // One panel, as adding a series shows its episodes: the header and the selection's bar float
    // inside it over the frames. A clip, not a hidden overflow, so both can stick.
    <section aria-labelledby="episodes-title" className={cn(GLASS_PANEL, "min-w-0 overflow-clip")}>
      {/* What is shown on the left, what it does to the whole series on the right. */}
      <header className={cn(ISLAND, "top-4 mx-4 mt-4")}>
        {/* The season's list is the heading when there is one; the title only names a lone season. */}
        <h2 id="episodes-title" className={cn("text-base font-medium", seasonPicker && "sr-only")}>
          {t.series.episodes}
        </h2>
        {seasonPicker && (
          // The season and its source in one pill: the source is the season's, not the series'.
          <div className={SPLIT_PILL}>
            {/* A season at a time, only when there is more than one: a list, so eleven fit as well as two. */}
            <Select
              value={group.season}
              onValueChange={(season) => season !== null && setChosen(season)}
            >
              <SelectTrigger
                aria-label={t.series.seasonPicker}
                className={cn(
                  "h-12 gap-2 rounded-full border-0 px-5 text-sm focus-visible:ring-3 focus-visible:ring-ring/40 data-[size=default]:h-12",
                  SPLIT_HALF,
                )}
              >
                <SelectValue>
                  {() => (
                    <SeasonLabel
                      group={group}
                      title={titleOf(group.season)}
                      tmdb={tmdbCount.get(group.season)}
                    />
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                alignItemWithTrigger={false}
                align="start"
                // Not down to the window's foot: a long show's seasons scroll under the arrows.
                className={cn(
                  BAR_POPUP,
                  "max-h-[min(28rem,var(--available-height))] w-max min-w-(--anchor-width)",
                )}
              >
                {listed.map((g) => (
                  <SelectItem
                    key={g.season}
                    value={g.season}
                    className="rounded-xl py-2 pl-3 text-base"
                  >
                    <SeasonLabel
                      group={g}
                      title={titleOf(g.season)}
                      tmdb={tmdbCount.get(g.season)}
                    />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {pairedTools}
          </div>
        )}
        {!seasonPicker && loneTools}
        {(absent.length > 0 || absentSeasons.length > 0) && (
          <Gaps matches={absent} seasons={absentSeasons} onPick={(season) => setChosen(season)} />
        )}
        {/* The count beside the button it scopes: what is missing is counted over every season. */}
        <div className="ml-auto flex items-center gap-4">
          <span className="text-sm text-muted-foreground tabular-nums">
            {t.series.available(availableCount, episodes.length)}
          </span>
          <button
            type="button"
            disabled={missingCount === 0 || busy !== null}
            aria-busy={busy === "missing" || undefined}
            onClick={onDownloadMissing}
            className={cn(PILL_BUTTON, PRIMARY)}
          >
            {busy === "missing" ? (
              <Spinner aria-hidden="true" />
            ) : (
              <HugeiconsIcon icon={ArrowDown03Icon} className="size-4" />
            )}
            {t.series.downloadMissing}
          </button>
        </div>
      </header>
      {failed && (
        <p role="alert" className="px-4 pt-4 text-sm text-warning">
          {t.series.actionFailed}
        </p>
      )}
      {notice && !failed && (
        <p role="status" className="px-4 pt-4 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {group && (
        // No gap: the grid's 8px plus each card's own 8px make the panel's 16px, to its edge and between frames.
        <section aria-label={titleOf(group.season)} className="px-2 pt-2 pb-2">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))]">
            {cells.map((cell) => {
              if (cell.kind === "gap") {
                const code = episodeCode(group.season, cell.number);
                return (
                  <li key={`gap:${code}`}>
                    <GapCard
                      code={code}
                      aired={cell.aired}
                      tmdb={guide.get(guideKey(group.season, cell.number)) ?? null}
                      missing={{ label: t.series.gapLabel, hint: t.series.gapHint(code) }}
                    />
                  </li>
                );
              }
              const { episode } = cell;
              return (
                <li key={episode.id}>
                  <EpisodeCard
                    episode={episode}
                    picked={selection.has(episode.id)}
                    paused={paused}
                    tmdb={guide.get(guideKey(episode.season, episode.episode)) ?? null}
                    onToggle={() => onToggle(episode.id)}
                    onRetry={() => onRetry(episode.id)}
                    retrying={retryingId === episode.id}
                    {...(onDelete ? { onDelete: () => onDelete(episode.id) } : {})}
                    deleting={deletingId === episode.id}
                    source={sourceMark?.(episode)}
                    fileFrom={fileSourceName?.(episode) ?? null}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* What is picked, and what to do with it: there only while something is. */}
      {selection.size > 0 && (
        <div
          role="toolbar"
          aria-label={t.series.selected(selection.size)}
          className={cn(ISLAND, "bottom-4 mx-4 mb-4")}
        >
          {/* On the left what changes the selection, on the right what acts on it. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClear}
              aria-label={t.series.clearSelection}
              title={t.series.clearSelection}
              className={cn(PILL_BUTTON, SECONDARY, "size-10 justify-center px-0")}
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
            </button>
            <span className="text-sm font-medium tabular-nums">
              {t.series.selected(selection.size)}
            </span>
          </div>
          {group && group.episodes.length > 0 && seasonPicked !== "all" && (
            <button
              type="button"
              onClick={() => onToggleSeason(group.season, true)}
              className="rounded-full text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              {groups.length > 1 ? t.series.selectSeason(group.season) : t.series.selectEvery}
            </button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selectionTools}
            <button
              type="button"
              disabled={busy !== null}
              aria-busy={busy === "selected" || undefined}
              onClick={onDownloadSelected}
              className={cn(PILL_BUTTON, PRIMARY)}
            >
              {busy === "selected" ? (
                <Spinner aria-hidden="true" />
              ) : (
                <HugeiconsIcon icon={ArrowDown03Icon} className="size-4" />
              )}
              {t.series.downloadSelected(selection.size)}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** A cell of a season's grid: one of its episodes, or one TMDB lists that no source brings. */
type Cell =
  | { kind: "episode"; episode: EpisodeDto; number: number }
  | { kind: "gap"; number: number; aired: boolean };

/**
 * What TMDB lists as aired and no source brings, as an amber sign in the header: the episodes of
 * each season on hover, and a season's row shows that season.
 */
function Gaps({
  matches,
  seasons,
  onPick,
}: {
  matches: SeasonMatch[];
  /** Whole seasons no source brings, after the episodes missing from the ones it does. */
  seasons: readonly GuideSeasonDto[];
  onPick: (season: number) => void;
}) {
  const t = useT();
  const count =
    matches.reduce((sum, match) => sum + match.missing.length, 0) +
    seasons.reduce((sum, season) => sum + season.episodeCount, 0);
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={100}
        render={<span />}
        className="flex h-8 cursor-help items-center gap-1.5 rounded-full bg-warning/12 px-2.5 text-xs font-medium text-warning"
      >
        <HugeiconsIcon icon={Alert02Icon} className="size-4" />
        {t.series.gaps(count)}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        sideOffset={8}
        className="w-80 rounded-2xl border border-(--glass-edge) bg-(--glass-strong) p-2 text-sm shadow-[0_16px_48px_-20px_var(--glass-shadow)] ring-0 supports-backdrop-filter:bg-(--glass) supports-backdrop-filter:backdrop-blur-[24px]"
      >
        <p className="px-2 pt-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t.series.gapsTitle}
        </p>
        <ul className="flex flex-col">
          {matches.map((match) => (
            <li key={match.season}>
              <button
                type="button"
                onClick={() => onPick(match.season)}
                className="w-full rounded-xl px-2 py-1.5 text-left tabular-nums transition-colors hover:bg-white/60 focus-visible:bg-white/60 focus-visible:outline-none"
              >
                {t.series.gapsSeason(match.season, numberRanges(match.missing))}
              </button>
            </li>
          ))}
        </ul>
        {seasons.length > 0 && (
          <p className="px-2 pt-1.5 pb-2">
            <span className="block tabular-nums">
              {t.series.gapsSeasons(
                numberRanges(
                  seasons.map((season) => season.number),
                  (n) => String(n),
                ),
              )}
            </span>
            <span className="block text-xs text-muted-foreground">{t.series.gapsSeasonsHint}</span>
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * A season's name and how many of its episodes are here, in the picker and on its button. A
 * season no source brings counts against TMDB's episodes, in amber.
 */
function SeasonLabel({
  group,
  title,
  tmdb,
}: {
  group: SeasonGroup;
  title: string;
  /** TMDB's number of episodes, for a season no source brings. */
  tmdb?: number;
}) {
  const t = useT();
  const have = group.episodes.filter((e) => e.status === "available").length;
  return (
    <span className="flex items-center gap-2">
      {title}
      {tmdb === undefined ? (
        <span className="text-xs tabular-nums opacity-70">
          {have}/{group.episodes.length}
        </span>
      ) : (
        <span title={t.series.seasonNoSource} className="text-xs text-warning tabular-nums">
          0/{tmdb}
        </span>
      )}
    </span>
  );
}

/** A season no source brings, as gaps: all TMDB lists, aired or still to air by `today`. */
function wholeSeason(
  listed: readonly GuideEpisodeDto[] | undefined,
  today: string,
): Pick<SeasonMatch, "missing" | "upcoming"> | undefined {
  if (!listed) return undefined;
  const aired = (episode: GuideEpisodeDto) => episode.airDate !== null && episode.airDate <= today;
  return {
    missing: listed.filter(aired).map((episode) => episode.number),
    upcoming: listed.filter((episode) => !aired(episode)).map((episode) => episode.number),
  };
}

function EpisodeCard({
  episode,
  picked,
  paused,
  tmdb,
  onToggle,
  onRetry,
  retrying,
  onDelete,
  deleting = false,
  source,
  fileFrom = null,
}: {
  source?: React.ReactNode;
  /** Where its file was downloaded from, when that isn't its source any more. */
  fileFrom?: string | null;
  episode: EpisodeDto;
  picked: boolean;
  paused: boolean;
  tmdb: GuideEpisodeDto | null;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const code = episodeCode(episode.season, episode.episode);
  const { src: still, onError: onStillError } = useRetryingImage(tmdb?.stillUrl);
  // TMDB's name when it has one, as adding a series shows it; the site's on hover.
  const title = tmdb?.name || episode.title;
  const selectable = isSelectable(episode);
  const here = episode.status === "available";
  const percent = toPercent(downloadFraction(episode));
  const download = downloadLine(episode, t, locale);
  const length =
    episode.durationSec !== null
      ? formatDuration(Math.round(episode.durationSec))
      : tmdb?.runtimeMin
        ? t.add.minutes(tmdb.runtimeMin)
        : null;
  const airDate = episode.airDate ?? tmdb?.airDate ?? null;
  const details = [
    airDate ? formatDate(airDate, locale) : null,
    length,
    episode.sizeBytes === null ? null : formatBytes(episode.sizeBytes, locale),
    episode.format?.toUpperCase() ?? null,
  ].filter((part) => part !== null);
  const overview = tmdb?.overview || episode.plot;
  // A queued episode of a paused series waits for the series, not for its turn.
  const held = paused && episode.status === "queued";
  const statusIcon = held ? PauseIcon : STATUS_ICON[episode.status];
  const boxState = held ? "held" : episode.status;

  return (
    <article
      onClick={selectable ? onToggle : undefined}
      className={cn(
        // Rounded around the frame (its 15px plus the 8px padding), so the hover and the pick never
        // show a square corner against the rounded panel.
        "group/card flex h-full flex-col gap-3 rounded-[23px] p-2 transition-colors duration-300",
        selectable && "cursor-pointer hover:bg-white/35",
        picked && "bg-primary/8",
      )}
    >
      <div className="relative aspect-video overflow-hidden rounded-[15px] bg-linear-to-br from-primary/15 via-white/40 to-info/20">
        {still ? (
          <img
            src={still}
            alt=""
            loading="lazy"
            onError={onStillError}
            className={cn(
              "size-full object-cover transition-[filter,scale] duration-500 group-hover/card:scale-[1.03]",
              // What is not here yet is shown faded, so what can be watched stands out.
              !here && !picked && "grayscale-[60%]",
            )}
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-full flex-col items-center justify-center gap-1 text-primary/50"
          >
            <HugeiconsIcon icon={Video01Icon} className="size-8" />
            <span className="font-mono text-sm">{code}</span>
          </div>
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/35 via-transparent to-black/45"
        />

        <div className="absolute top-2 right-13 left-2 flex items-start gap-1.5">
          {source}
          <span className={cn(CHIP, "bg-black/45 font-mono text-white")}>{code}</span>
          {episode.inferred && (
            <span title={t.add.inferredHint} className={cn(CHIP, "bg-warning/90 text-white")}>
              {t.series.inferred}
            </span>
          )}
          {episode.fileOutdated && (
            <span
              title={t.series.fileOutdatedHint}
              className={cn(CHIP, "min-w-0 shrink bg-info/90 text-white")}
            >
              <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} className="size-3.5 shrink-0" />
              <span className="truncate">
                {fileFrom ? t.series.fileFrom(fileFrom) : t.series.fileOutdated}
              </span>
            </span>
          )}
        </div>

        {/* The episode's box: picked to download, or its state; one on its way can't be picked again. */}
        <button
          type="button"
          role="checkbox"
          aria-checked={picked}
          aria-disabled={selectable ? undefined : true}
          aria-label={t.series.selectEpisode(code)}
          onClick={(event) => {
            event.stopPropagation();
            if (selectable) onToggle();
          }}
          className={cn(
            "absolute top-2 right-2 flex size-10 items-center justify-center rounded-full shadow-md ring-1 backdrop-blur-md transition-colors focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none",
            picked
              ? "bg-primary text-primary-foreground ring-black/10"
              : cn(BOX_STYLE[boxState], selectable ? "hover:brightness-95" : "cursor-not-allowed"),
          )}
        >
          {picked ? (
            <HugeiconsIcon icon={ArrowDown03Icon} className="size-4.5" />
          ) : boxState === "downloading" ? (
            <Spinner aria-hidden="true" className="size-4" />
          ) : (
            <HugeiconsIcon icon={BOX_ICON[boxState]} className="size-4.5" />
          )}
        </button>

        {/* Wrapped in reverse, so the cross axis is flipped too: `items-start` keeps every chip on the frame's foot, level with the 40px trash. */}
        <div className="absolute inset-x-2 bottom-2 flex flex-wrap-reverse items-start gap-1.5">
          {percent === null ? (
            <span className={cn(CHIP, STATUS_STYLE[episode.status])}>
              {statusIcon && <HugeiconsIcon icon={statusIcon} className="size-3.5" />}
              {held ? t.series.paused : t.series.episodeStatus[episode.status]}
            </span>
          ) : (
            // The chip is the progress bar: the accent fills it from the left over the dark glass,
            // and the white label reads on both.
            <span
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label={`${code} ${t.series.episodeStatus.downloading}`}
              className={cn(CHIP, "relative isolate overflow-hidden bg-black/45 text-white")}
            >
              <span
                aria-hidden="true"
                style={{ width: `${percent}%` }}
                className="absolute inset-y-0 left-0 -z-10 bg-primary transition-[width] duration-500 ease-out"
              />
              {statusIcon && <HugeiconsIcon icon={statusIcon} className="size-3.5" />}
              {t.series.episodeStatus[episode.status]}
              <span className="tabular-nums">{t.series.detail.progress(percent)}</span>
            </span>
          )}
          {episode.status === "failed" && (
            <button
              type="button"
              disabled={retrying}
              aria-busy={retrying || undefined}
              onClick={(event) => {
                event.stopPropagation();
                onRetry();
              }}
              className={cn(
                CHIP,
                "bg-white/90 text-foreground transition-colors hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none",
              )}
            >
              {retrying ? (
                <Spinner aria-hidden="true" className="size-3.5" />
              ) : (
                <HugeiconsIcon icon={RefreshIcon} className="size-3.5" />
              )}
              {t.series.retryEpisode}
            </button>
          )}
          {here && onDelete && <FrameTrash code={code} pending={deleting} onConfirm={onDelete} />}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1 px-2 pb-1.5">
        <h4
          title={title === episode.title ? undefined : episode.title}
          className="truncate font-medium"
        >
          {title}
        </h4>
        {download && (
          <p
            className={cn(
              "truncate text-xs tabular-nums",
              episode.status === "downloading" ? "text-primary" : "text-muted-foreground",
            )}
          >
            {download}
          </p>
        )}
        {details.length > 0 && (
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {details.join(" · ")}
          </p>
        )}
        {overview && <p className="line-clamp-2 text-sm text-foreground/70">{overview}</p>}
      </div>
    </article>
  );
}

/**
 * The trash over a downloaded episode's frame: there on hover (always on a touch screen). Clicked,
 * it asks in a glass card over it, so nothing on the frame moves. Once deleted the episode is
 * missing, and the card drops it.
 */
function FrameTrash({
  code,
  pending,
  onConfirm,
}: {
  code: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <PopoverTrigger
        aria-label={t.series.deleteEpisode(code)}
        title={t.series.deleteEpisode(code)}
        // The card picks the episode on a click: deleting it is not picking it.
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "ml-auto flex size-10 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/30 backdrop-blur-md transition-[opacity,background-color] hover:bg-destructive focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none data-popup-open:bg-destructive",
          !open &&
            "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <HugeiconsIcon icon={Delete02Icon} className="size-4.5" />
      </PopoverTrigger>
      {/* Clicks inside reach the card through the portal: they mustn't pick the episode. */}
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        onClick={(event) => event.stopPropagation()}
        className={cn(BAR_POPUP, "w-[min(20rem,var(--available-width))] gap-4 p-4")}
      >
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t.series.deleteEpisode(code)}</p>
          <p className="text-sm text-muted-foreground">{t.series.deleteEpisodeHint}</p>
        </div>
        {/* Sibling buttons, 8px apart. */}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => setOpen(false)}
            className="h-10 rounded-full px-4 text-sm font-medium transition-colors hover:bg-white/70 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={onConfirm}
            className="relative flex h-10 items-center justify-center gap-2 rounded-full bg-destructive px-4 text-sm font-medium text-white transition-colors hover:bg-destructive/85 focus-visible:ring-3 focus-visible:ring-destructive/40 focus-visible:outline-none disabled:pointer-events-none"
          >
            <span className={cn("inline-flex items-center gap-2", pending && "invisible")}>
              <HugeiconsIcon icon={Delete02Icon} className="size-4" />
              {t.series.deleteEpisodeConfirm}
            </span>
            {pending && <Spinner aria-hidden="true" className="absolute size-4" />}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
