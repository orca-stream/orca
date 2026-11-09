import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Alert02Icon,
  Clock01Icon,
  CloudOffIcon,
  Delete02Icon,
  ArrowDown03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { useApi } from "@/api/context";
import { useMutations } from "@/api/mutations";
import { queries } from "@/api/queries";
import type { EpisodeDto, ExtractorDto, SeriesDto } from "@/api/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ExtractorMark } from "@/extractors/ExtractorMark";
import { formatBytes, formatDuration } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { cn } from "@/lib/utils";
import { BAR_POPUP } from "./bar";
import { downloadFraction, downloadLine } from "./download-line";

const STATUS_ICON = {
  available: Tick02Icon,
  queued: Clock01Icon,
  missing: CloudOffIcon,
  failed: Alert02Icon,
  downloading: ArrowDown03Icon,
} as const;

/** The row's buttons: 40px tall, as every button inside a row. */
const HALF =
  "flex h-10 shrink-0 items-center transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50";

const hostOf = (address: string) => {
  try {
    return new URL(address).hostname;
  } catch {
    return address;
  }
};

/** Who reads a source, as the pill and its list show it: the site's mark and its name. */
function SourceName({ extractor, name }: { extractor: ExtractorDto | null; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {extractor && (
        <ExtractorMark
          extractor={extractor}
          className="size-6 shrink-0 rounded-full"
          iconClassName="size-3.5"
        />
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * A movie's one video, in place of a list of episodes, as one row: whether it is here and how its
 * download goes, and a pill split in two — the source it is taken from (a list, with more than one)
 * and what can be done with it: download it, or delete its file once it is here.
 */
export function MovieVideo({
  series,
  episode,
  downloading,
  onDownload,
  onDelete,
  deleting,
  onSourceFailed,
}: {
  series: SeriesDto;
  episode: EpisodeDto | undefined;
  /** Asked to download, and waiting on the server. */
  downloading: boolean;
  onDownload: () => void;
  onDelete: () => void;
  deleting: boolean;
  onSourceFailed: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const extractors = useQuery(queries.extractors(api));
  const { switchSource } = useMutations();
  const [asking, setAsking] = useState(false);
  if (!episode) return null;

  const percent = toPercent(downloadFraction(episode));
  const line = downloadLine(episode, t, locale);
  const details = [
    episode.durationSec === null ? null : formatDuration(Math.round(episode.durationSec)),
    episode.sizeBytes === null ? null : formatBytes(episode.sizeBytes, locale),
    episode.format?.toUpperCase() ?? null,
  ].filter((part) => part !== null);
  const here = episode.status === "available";
  const canDownload = episode.status === "missing" || episode.status === "failed";
  const extractorOf = (id: string) => extractors.data?.find((e) => e.id === id) ?? null;
  const sources = series.sources.map((source) => {
    const extractor = extractorOf(source.extractorId);
    return { source, extractor, name: extractor?.name ?? source.extractorId };
  });
  const current = sources.find(({ source }) => source.id === episode.sourceId) ?? sources[0];
  const choosable = sources.length > 1 && episode.status !== "downloading";
  // Downloading it, deleting it, or neither (it is on its way): the pill's second half.
  const action = canDownload ? "download" : here ? "delete" : null;

  return (
    <div className="border-t border-t-(--glass-edge)">
      {/* 72px: 16px around the 40px buttons, as every row holding one; its mark and its text where
          the sources' rows have theirs, so the two read as one list. */}
      <div className="flex min-h-18 items-center gap-2 py-4 pr-4">
        <div className="flex min-w-0 flex-1 items-center">
          <span className="flex shrink-0 pr-2.5 pl-4">
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-full",
                here
                  ? "bg-emerald-500/15 text-emerald-600"
                  : episode.status === "failed"
                    ? "bg-warning/15 text-warning"
                    : episode.status === "downloading"
                      ? "bg-primary/10 text-primary"
                      : "bg-black/5 text-muted-foreground",
              )}
            >
              {episode.status === "downloading" ? (
                <Spinner aria-hidden="true" className="size-5" />
              ) : (
                <HugeiconsIcon icon={STATUS_ICON[episode.status]} className="size-5" />
              )}
            </span>
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pl-1.5">
            <p className="text-base">
              {t.series.movieVideo}
              <span className="text-muted-foreground">
                {" "}
                · {t.series.episodeStatus[episode.status]}
              </span>
              {percent !== null && (
                <span className="text-primary tabular-nums">
                  {" "}
                  {t.series.detail.progress(percent)}
                </span>
              )}
            </p>
            {(line ?? details.length > 0) && (
              <p
                className={cn(
                  "truncate text-sm tabular-nums",
                  episode.status === "downloading" ? "text-primary" : "text-muted-foreground",
                )}
              >
                {line ?? details.join(" · ")}
              </p>
            )}
            {percent !== null && (
              <span
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={t.series.movieVideo}
                className="mt-1 block h-1 overflow-hidden rounded-full bg-black/8"
              >
                <span
                  style={{ width: `${percent}%` }}
                  className="block h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                />
              </span>
            )}
          </div>
        </div>
        {/* Where it is taken from, then what to do with it: two sibling buttons, 8px apart, each
            whole (its own hover, never cut by the other). */}
        <div className="flex min-w-0 shrink items-center gap-2">
          {current &&
            (choosable ? (
              <Select
                value={current.source.id}
                onValueChange={(sourceId) => {
                  if (sourceId === null || sourceId === episode.sourceId) return;
                  switchSource.mutate(
                    { seriesId: series.id, body: { sourceId, episodeIds: [episode.id] } },
                    { onError: onSourceFailed },
                  );
                }}
              >
                <SelectTrigger
                  aria-label={t.series.movieSource}
                  title={t.series.movieSource}
                  className={cn(
                    HALF,
                    "min-w-0 gap-2 rounded-full border-0 bg-white/70 py-0 pr-3 pl-2 text-sm font-medium shadow-none ring-1 ring-black/5 hover:bg-white data-popup-open:bg-white data-[size=default]:h-10",
                  )}
                >
                  {switchSource.isPending && <Spinner aria-hidden="true" className="mx-1 size-4" />}
                  <SelectValue>
                    {() => <SourceName extractor={current.extractor} name={current.name} />}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger={false}
                  align="end"
                  className={cn(BAR_POPUP, "w-max min-w-(--anchor-width)")}
                >
                  {sources.map(({ source, extractor, name }) => (
                    <SelectItem
                      key={source.id}
                      value={source.id}
                      className="rounded-xl py-2 pl-3 text-base"
                    >
                      <SourceName extractor={extractor} name={name} />
                      <span className="ml-auto shrink-0 self-center pl-6 text-sm text-muted-foreground">
                        {hostOf(source.sourceUrl)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              // A lone source (or one busy downloading) is said, not offered.
              <span
                title={t.series.movieSource}
                className={cn(
                  HALF,
                  "min-w-0 rounded-full bg-white/70 pr-3 pl-2 text-sm font-medium ring-1 ring-black/5",
                )}
              >
                <SourceName extractor={current.extractor} name={current.name} />
              </span>
            ))}
          {action === "download" && (
            <button
              type="button"
              aria-label={
                episode.status === "failed" ? t.series.retryEpisode : t.series.movieDownload
              }
              title={episode.status === "failed" ? t.series.retryEpisode : t.series.movieDownload}
              disabled={downloading}
              aria-busy={downloading || undefined}
              onClick={onDownload}
              className={cn(
                HALF,
                "w-10 justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 hover:bg-primary/85",
              )}
            >
              {downloading ? (
                <Spinner aria-hidden="true" />
              ) : (
                <HugeiconsIcon icon={ArrowDown03Icon} className="size-5" />
              )}
            </button>
          )}
          {action === "delete" && (
            <button
              type="button"
              aria-label={t.series.movieDelete}
              title={t.series.movieDelete}
              disabled={deleting}
              aria-busy={deleting || undefined}
              onClick={() => setAsking(true)}
              className={cn(
                HALF,
                "w-10 justify-center rounded-full bg-white/70 ring-1 ring-black/5 hover:bg-destructive hover:text-white",
              )}
            >
              {deleting ? (
                <Spinner aria-hidden="true" />
              ) : (
                <HugeiconsIcon icon={Delete02Icon} className="size-5" />
              )}
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={asking}
        title={t.series.movieDelete}
        confirmLabel={t.series.deleteEpisodeConfirm}
        destructive
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onDelete();
        }}
      >
        {t.series.deleteEpisodeHint}
      </ConfirmDialog>
    </div>
  );
}
