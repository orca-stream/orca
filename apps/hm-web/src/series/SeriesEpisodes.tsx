import type { EpisodeDto, GuideEpisodeDto } from "@orca/hm-contract";
import { useState } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  Clock01Icon,
  CloudOffIcon,
  Download04Icon,
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
import { Spinner } from "@/components/ui/spinner";
import { formatBytes, formatDate, formatDuration } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { useRetryingImage } from "@/lib/retrying-image";
import { cn } from "@/lib/utils";
import { BAR_POPUP, GLASS_PANEL, ISLAND } from "./bar";
import { downloadFraction, downloadLine } from "./download-line";
import { episodeCode, guideKey } from "./preview-form";
import { isSelectable, seasonState, type SeasonGroup } from "./selection";

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
const PILL_BUTTON =
  "flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";
const PRIMARY = "bg-primary text-primary-foreground shadow-xs hover:bg-primary/85";
const SECONDARY = "bg-white/70 ring-1 ring-black/5 hover:bg-white";

interface SeriesEpisodesProps {
  groups: SeasonGroup[];
  episodes: readonly EpisodeDto[];
  availableCount: number;
  /** The series is paused: its queued episodes wait for it, and say so. */
  paused?: boolean;
  selection: ReadonlySet<string>;
  /** TMDB's episodes by `guideKey`, where they are known: the frame, the name, the synopsis. */
  guide: ReadonlyMap<string, GuideEpisodeDto>;
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
}: SeriesEpisodesProps) {
  const t = useT();
  const [chosen, setChosen] = useState<number | null>(null);
  const group = groups.find((g) => g.season === chosen) ?? groups[0];
  const titleOf = (season: number) => (season === 0 ? t.series.specials : t.series.season(season));
  const seasonPicked = group ? seasonState(selection, episodes, group.season) : "none";

  return (
    // One panel, as adding a series shows its episodes: the header and the selection's bar float
    // inside it over the frames. A clip, not a hidden overflow, so both can stick.
    <section aria-labelledby="episodes-title" className={cn(GLASS_PANEL, "min-w-0 overflow-clip")}>
      <header className={cn(ISLAND, "top-4 mx-4 mt-4")}>
        <h2 id="episodes-title" className="text-base font-medium">
          {t.series.episodes}
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {t.series.available(availableCount, episodes.length)}
        </span>
        {/* A season at a time, only when there is more than one: a list, so eleven fit as well as two. */}
        {groups.length > 1 && group && (
          <Select
            value={group.season}
            onValueChange={(season) => season !== null && setChosen(season)}
          >
            <SelectTrigger
              aria-label={t.series.seasonPicker}
              className="h-9 gap-2 rounded-full border-0 bg-white/55 px-3.5 text-sm ring-1 ring-black/5 hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/40 data-[size=default]:h-9 data-popup-open:bg-white sm:ml-3"
            >
              <SelectValue>
                {() => <SeasonLabel group={group} title={titleOf(group.season)} />}
              </SelectValue>
            </SelectTrigger>
            <SelectContent
              alignItemWithTrigger={false}
              align="start"
              className={cn(BAR_POPUP, "w-max min-w-(--anchor-width)")}
            >
              {groups.map((g) => (
                <SelectItem
                  key={g.season}
                  value={g.season}
                  className="rounded-xl py-2 pl-3 text-base"
                >
                  <SeasonLabel group={g} title={titleOf(g.season)} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <button
          type="button"
          disabled={missingCount === 0 || busy !== null}
          aria-busy={busy === "missing" || undefined}
          onClick={onDownloadMissing}
          className={cn(PILL_BUTTON, PRIMARY, "ml-auto")}
        >
          {busy === "missing" ? (
            <Spinner aria-hidden="true" />
          ) : (
            <HugeiconsIcon icon={Download04Icon} className="size-4" />
          )}
          {t.series.downloadMissing}
        </button>
      </header>
      {failed && (
        <p role="alert" className="px-4 pt-4 text-sm text-warning">
          {t.series.actionFailed}
        </p>
      )}

      {group && (
        // No gap: the grid's 8px plus each card's own 8px make the panel's 16px, to its edge and between frames.
        <section aria-label={titleOf(group.season)} className="px-2 pt-2 pb-2">
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))]">
            {group.episodes.map((episode) => (
              <li key={episode.id}>
                <EpisodeCard
                  episode={episode}
                  picked={selection.has(episode.id)}
                  paused={paused}
                  tmdb={guide.get(guideKey(episode.season, episode.episode)) ?? null}
                  onToggle={() => onToggle(episode.id)}
                  onRetry={() => onRetry(episode.id)}
                  retrying={retryingId === episode.id}
                />
              </li>
            ))}
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
          <span className="mr-auto text-sm font-medium tabular-nums">
            {t.series.selected(selection.size)}
          </span>
          {group && seasonPicked !== "all" && (
            <button
              type="button"
              onClick={() => onToggleSeason(group.season, true)}
              className={cn(PILL_BUTTON, SECONDARY)}
            >
              {groups.length > 1 ? t.series.selectSeason(group.season) : t.series.selectEvery}
            </button>
          )}
          <button type="button" onClick={onClear} className={cn(PILL_BUTTON, SECONDARY)}>
            {t.series.clearSelection}
          </button>
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
              <HugeiconsIcon icon={Download04Icon} className="size-4" />
            )}
            {t.series.downloadSelected(selection.size)}
          </button>
        </div>
      )}
    </section>
  );
}

/** A season's name and how many of its episodes are here, in the picker and on its button. */
function SeasonLabel({ group, title }: { group: SeasonGroup; title: string }) {
  const have = group.episodes.filter((e) => e.status === "available").length;
  return (
    <span className="flex items-center gap-2">
      {title}
      <span className="text-xs tabular-nums opacity-70">
        {have}/{group.episodes.length}
      </span>
    </span>
  );
}

function EpisodeCard({
  episode,
  picked,
  paused,
  tmdb,
  onToggle,
  onRetry,
  retrying,
}: {
  episode: EpisodeDto;
  picked: boolean;
  paused: boolean;
  tmdb: GuideEpisodeDto | null;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
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
          <span className={cn(CHIP, "bg-black/45 font-mono text-white")}>{code}</span>
          {episode.inferred && (
            <span title={t.add.inferredHint} className={cn(CHIP, "bg-warning/90 text-white")}>
              {t.series.inferred}
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
            "absolute top-2 right-2 flex size-9 items-center justify-center rounded-full shadow-md ring-1 backdrop-blur-md transition-colors focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none",
            picked
              ? "bg-primary text-primary-foreground ring-black/10"
              : cn(BOX_STYLE[boxState], selectable ? "hover:brightness-95" : "cursor-not-allowed"),
          )}
        >
          {picked ? (
            <HugeiconsIcon icon={Download04Icon} className="size-4.5" />
          ) : boxState === "downloading" ? (
            <Spinner aria-hidden="true" className="size-4" />
          ) : (
            <HugeiconsIcon icon={BOX_ICON[boxState]} className="size-4.5" />
          )}
        </button>

        <div className="absolute inset-x-2 bottom-2 flex flex-wrap-reverse items-end gap-1.5">
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
