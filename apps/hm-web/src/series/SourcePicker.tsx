import type { EpisodeDto, ExtractorDto, SeriesDto } from "@orca/hm-contract";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDataTransferHorizontalIcon, Link01Icon, StarIcon } from "@hugeicons/core-free-icons";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { useT } from "@/i18n/locale";
import { cn } from "@/lib/utils";
import { CHIP_HOVER_CARD } from "./AiringChip";
import { BAR_POPUP, PILL_BUTTON, SECONDARY } from "./bar";
import { offersSeason, sortBySpan, sourceSpans, sourcesFor } from "./source-spans";
import { numberRanges } from "./tmdb-match";

type Source = SeriesDto["sources"][number];

/** The series' sources with what reads each, in the order of what they bring. */
function useSources(series: SeriesDto, episodes: readonly EpisodeDto[]) {
  const api = useApi();
  const extractors = useQuery(queries.extractors(api));
  const extractorOf = (source: Source) =>
    extractors.data?.find((extractor) => extractor.id === source.extractorId) ?? null;
  return sortBySpan(series.sources, episodes).map((source) => ({
    source,
    extractor: extractorOf(source),
  }));
}

/** Who reads a source, as its rows show it: the extractor's mark, or a plain link. */
function SourceMark({
  extractor,
  closed = false,
  className,
}: {
  extractor: ExtractorDto | null;
  closed?: boolean;
  className?: string;
}) {
  return extractor ? (
    <ExtractorMark
      extractor={extractor}
      // White whatever a highlighted row paints its children: a list item turns every descendant
      // dark, down to the icon's own paths.
      className={cn(
        "rounded-full text-white! **:text-white!",
        closed && "opacity-45 grayscale",
        className,
      )}
      iconClassName="size-4"
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-black/5 text-muted-foreground",
        className,
      )}
    >
      <HugeiconsIcon icon={Link01Icon} className="size-4" />
    </span>
  );
}

/** Its address without the scheme: what tells two apart is at their end. */
const addressOf = (source: Source) => source.sourceUrl.replace(/^https?:\/\//, "");

/** The last part of its address (`black-clover-2nd-season`): short, and what tells two apart. */
const tailOf = (source: Source) =>
  new URL(source.sourceUrl).pathname.split("/").filter(Boolean).at(-1) ?? addressOf(source);

/** What a source holds, a season at a time; until it holds something, how it numbers. */
function holdsOf(t: ReturnType<typeof useT>, source: Source, episodes: readonly EpisodeDto[]) {
  const spans = sourceSpans(episodes, source.id);
  return spans.length > 0
    ? spans
        .map((span) =>
          t.series.detail.sourceSpan(span.season, span.from, span.to, numberRanges(span.gaps)),
        )
        .join(" · ")
    : t.series.sourceNumbering(source.season, source.episodeOffset);
}

/**
 * The site's name, and below it what it holds and the end of its address (two sources of one site
 * share the name; the end of the address tells them apart, its start doesn't).
 */
function SourceLines({
  source,
  extractor,
  episodes,
  extra,
}: {
  source: Source;
  extractor: ExtractorDto | null;
  episodes: readonly EpisodeDto[];
  extra?: string | null;
}) {
  const t = useT();
  const holds = holdsOf(t, source, episodes);
  return (
    <span className="flex min-w-0 flex-1 flex-col text-left leading-snug">
      <span className="truncate">{extractor?.name ?? addressOf(source)}</span>
      <span className="truncate text-xs text-muted-foreground">
        {[extra, source.closed ? t.series.detail.sourceClosed : null, holds, tailOf(source)]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  );
}

/**
 * "Change source" in the selection's bar: the series' sources, and the picked episodes take their
 * video from the one chosen. Nothing is downloaded; what it did is said by `onDone`.
 */
export function SwitchSourceButton({
  series,
  episodes,
  selection,
  disabled = false,
  onDone,
  onFailed,
}: {
  series: SeriesDto;
  episodes: readonly EpisodeDto[];
  selection: ReadonlySet<string>;
  disabled?: boolean;
  onDone: (message: string) => void;
  onFailed: () => void;
}) {
  const t = useT();
  const { switchSource } = useMutations();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const sources = useSources(series, episodes);
  const picked = episodes.filter((episode) => selection.has(episode.id));
  const seasons = [...new Set(picked.map((episode) => episode.season))].toSorted((a, b) => a - b);
  const usable = new Set(sourcesFor(series, episodes, seasons).map((source) => source.id));
  // The source every picked episode is on already: choosing it changes nothing.
  const current = picked.every((episode) => episode.sourceId === picked[0]?.sourceId)
    ? (picked[0]?.sourceId ?? null)
    : null;

  async function choose(sourceId: string) {
    setPending(sourceId);
    try {
      const result = await switchSource.mutateAsync({
        seriesId: series.id,
        body: { sourceId, episodeIds: picked.map((episode) => episode.id) },
      });
      setOpen(false);
      onDone(
        t.series.switchSourceDone(
          result.switched,
          result.notListed.join(", "),
          result.busy.join(", "),
        ),
      );
    } catch {
      onFailed();
    } finally {
      setPending(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => pending === null && setOpen(next)}>
      <PopoverTrigger
        disabled={disabled || series.sources.length < 2}
        className={cn(PILL_BUTTON, SECONDARY)}
      >
        <HugeiconsIcon icon={ArrowDataTransferHorizontalIcon} className="size-4" />
        {t.series.switchSource}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className={cn(BAR_POPUP, "w-[min(26rem,var(--available-width))] gap-2 p-2")}
      >
        <div className="flex flex-col gap-1 px-2 pt-2">
          <p className="font-medium">{t.series.switchSourceTitle(picked.length)}</p>
          <p className="text-sm text-muted-foreground">{t.series.switchSourceHint}</p>
        </div>
        <ul className="flex max-h-80 flex-col overflow-y-auto overscroll-contain [scrollbar-width:thin]">
          {/* Only those that can bring the picked episodes' seasons: the others have nothing to
              give them. */}
          {sources
            .filter(({ source }) => usable.has(source.id))
            .map(({ source, extractor }) => {
              const here = source.id === current;
              return (
                <li key={source.id}>
                  <button
                    type="button"
                    disabled={here || pending !== null}
                    aria-busy={pending === source.id || undefined}
                    onClick={() => void choose(source.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/70 focus-visible:bg-white/70 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-60"
                  >
                    <SourceMark extractor={extractor} closed={source.closed} className="size-10" />
                    <SourceLines
                      source={source}
                      extractor={extractor}
                      episodes={episodes}
                      extra={here ? t.series.switchSourceCurrent : null}
                    />
                    {pending === source.id && <Spinner aria-hidden="true" className="size-4" />}
                  </button>
                </li>
              );
            })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** The value of "any source" in the list: a source id is never empty. */
const ANY = "";

/**
 * The season's preferred source, in the episodes' header: while it is open, the new episodes of the
 * season come only from it. Saved as soon as it is picked.
 */
export function PreferredSourceSelect({
  series,
  episodes,
  season,
  onFailed,
  className,
}: {
  series: SeriesDto;
  episodes: readonly EpisodeDto[];
  season: number;
  onFailed: () => void;
  /** Merged into the trigger's, as the half of a pill shared with the season. */
  className?: string;
}) {
  const t = useT();
  const { patchSeries } = useMutations();
  const key = String(season);
  const chosen = series.preferredSources[key] ?? ANY;
  // Only those that can bring the season's episodes (and the one chosen, whatever it brings now).
  const sources = useSources(series, episodes).filter(
    ({ source }) => source.id === chosen || offersSeason(source, episodes, season),
  );
  const [saving, setSaving] = useState(false);
  const preferred = sources.find(({ source }) => source.id === chosen) ?? null;

  async function pick(value: string) {
    const next = { ...series.preferredSources };
    if (value === ANY) delete next[key];
    else next[key] = value;
    setSaving(true);
    try {
      await patchSeries.mutateAsync({ seriesId: series.id, patch: { preferredSources: next } });
    } catch {
      onFailed();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Select value={chosen} onValueChange={(value) => value !== null && void pick(value)}>
      <SelectTrigger
        aria-label={t.series.preferredSource(season)}
        title={preferred ? t.series.preferredHint(season) : t.series.preferredSource(season)}
        className={cn(
          "h-12 max-w-60 gap-2 rounded-full border-0 bg-white/55 pr-5 pl-1 text-sm ring-1 ring-black/5 hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/40 data-[size=default]:h-12 data-popup-open:bg-white",
          className,
        )}
      >
        <SelectValue>
          {() =>
            preferred ? (
              <span className="flex min-w-0 items-center gap-2">
                <SourceMark extractor={preferred.extractor} className="size-10" />
                <span className="truncate">
                  {preferred.extractor?.name ?? tailOf(preferred.source)}
                </span>
              </span>
            ) : (
              <span className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
                <span className="flex size-10 shrink-0 items-center justify-center">
                  {saving ? (
                    <Spinner aria-hidden="true" className="size-4" />
                  ) : (
                    <HugeiconsIcon icon={StarIcon} className="size-4" aria-hidden="true" />
                  )}
                </span>
                {t.series.preferredAny}
              </span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        align="start"
        className={cn(
          BAR_POPUP,
          "max-h-[min(28rem,var(--available-height))] w-[min(26rem,var(--available-width))]",
        )}
      >
        <p className="px-3 pt-2 pb-1 text-sm text-muted-foreground">
          {t.series.preferredExplain(season)}
        </p>
        <SelectItem value={ANY} className="rounded-xl py-2 pl-2 text-base">
          <span className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black/5 text-muted-foreground">
              <HugeiconsIcon icon={StarIcon} className="size-4" aria-hidden="true" />
            </span>
            {t.series.preferredAny}
          </span>
        </SelectItem>
        {sources.map(({ source, extractor }) => (
          <SelectItem key={source.id} value={source.id} className="rounded-xl py-2 pl-2 text-base">
            <span className="flex min-w-0 items-center gap-3">
              <SourceMark extractor={extractor} closed={source.closed} className="size-10" />
              <SourceLines source={source} extractor={extractor} episodes={episodes} />
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The source an episode takes its video from, as a mark over its frame: the extractor's circle, and
 * on hover which site, which address and what else it brought.
 */
export function EpisodeSourceMark({
  series,
  episodes,
  episode,
}: {
  series: SeriesDto;
  episodes: readonly EpisodeDto[];
  episode: EpisodeDto;
}) {
  const t = useT();
  const found = useSources(series, episodes).find(({ source }) => source.id === episode.sourceId);
  if (!found) return null;
  const { source, extractor } = found;
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={0}
        closeDelay={100}
        render={<span />}
        aria-label={t.series.episodeSource(extractor?.name ?? addressOf(source))}
        // The card picks the episode on a click: looking at its source is not picking it.
        onClick={(event) => event.stopPropagation()}
        className="flex shrink-0 cursor-help rounded-full shadow-md ring-1 ring-white/40"
      >
        <SourceMark extractor={extractor} className="size-7 [&_svg]:size-3.5" />
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" sideOffset={6} className={CHIP_HOVER_CARD}>
        <div className="flex items-center gap-2">
          <SourceMark extractor={extractor} closed={source.closed} className="size-8" />
          <div className="flex min-w-0 flex-col leading-snug">
            <span className="font-medium">{extractor?.name ?? t.series.unknownExtractor}</span>
            <span className="text-xs break-all text-muted-foreground">{addressOf(source)}</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {[source.closed ? t.series.detail.sourceClosed : null, holdsOf(t, source, episodes)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {episode.fileOutdated && <p className="mt-1 text-xs">{t.series.fileOutdatedHint}</p>}
      </HoverCardContent>
    </HoverCard>
  );
}
