import type { JobDto } from "@orca/hm-contract";
import { Video01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatDuration, formatSpeed } from "@/i18n/format";
import { useLocale, useT } from "@/i18n/locale";
import { toPercent } from "@/lib/percent";
import { useRetryingImage } from "@/lib/retrying-image";
import { cn } from "@/lib/utils";
import { useJobArt } from "./job-art";
import { jobSpeedAndEta } from "./job-view";

/**
 * The episode's frame, 16:9: TMDB's still, else the series' poster blurred behind, else a
 * camera on a soft gradient. A badge over it says what the frame alone can't (a percentage, a
 * place in the queue).
 */
export function JobThumb({
  still,
  poster,
  className,
  children,
}: {
  still: string | null;
  poster: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const frame = useRetryingImage(still);
  return (
    <div
      className={cn(
        "relative isolate flex aspect-video shrink-0 items-center justify-center overflow-hidden rounded-lg bg-linear-to-br from-primary/15 via-white/40 to-info/20 text-primary/50 ring-1 ring-black/5",
        className,
      )}
    >
      {frame.src ? (
        <img src={frame.src} alt="" onError={frame.onError} className="size-full object-cover" />
      ) : poster ? (
        <>
          <img
            src={poster}
            alt=""
            className="absolute inset-0 -z-10 size-full scale-125 object-cover blur-md"
          />
          <img src={poster} alt="" className="h-full object-contain shadow-md" />
        </>
      ) : (
        <HugeiconsIcon icon={Video01Icon} className="size-5" />
      )}
      {children}
    </div>
  );
}

/** The series (a link to it) over the episode's code and name, or what the job does. */
function JobTitle({ job, title }: { job: JobDto; title: string | null }) {
  const t = useT();
  const series = job.seriesTitle;
  return (
    <div className="min-w-0 flex-1 leading-tight">
      {series && (
        <p className="truncate text-xs text-muted-foreground">
          {job.seriesId ? (
            <Link
              href={`/series/${encodeURIComponent(job.seriesId)}`}
              className="hover:text-foreground hover:underline"
            >
              {series}
            </Link>
          ) : (
            series
          )}
        </p>
      )}
      <p className="truncate text-sm font-medium">
        {job.episodeCode ? (
          <>
            <span className="font-mono">{job.episodeCode}</span>
            {title && <span className="text-foreground/70"> · {title}</span>}
          </>
        ) : (
          // A job about the whole series (looking for new episodes, refreshing the library).
          t.dashboard.kinds[job.kind]
        )}
      </p>
    </div>
  );
}

/**
 * One job as a row: its frame on the left, the series and episode beside it, and below what the
 * job is doing (how far, how fast, how long; why it failed; when it finished). `action` is the
 * round 40px button at its end (cancel, retry), if any.
 */
export function JobRow({
  job,
  detail,
  badge,
  action,
}: {
  job: JobDto;
  /** A line in place of the progress, for a job that isn't running. */
  detail?: ReactNode;
  /** Over the frame, bottom left. */
  badge?: ReactNode;
  action?: ReactNode;
}) {
  const t = useT();
  const locale = useLocale();
  const running = job.status === "running";
  const art = useJobArt(job, { withPlayer: running });
  const percent = toPercent(job.progress);
  const { bytesPerSecond, etaSeconds } = jobSpeedAndEta(job);
  const { bytes, total } = job.progressDetail ?? {};
  const name =
    job.episodeCode && job.seriesTitle
      ? `${job.seriesTitle} ${job.episodeCode}`
      : (job.seriesTitle ?? t.dashboard.kinds[job.kind]);

  const line = running
    ? [
        art.player,
        bytes === undefined
          ? t.series.detail.findingVideo
          : total
            ? t.series.detail.downloadedOf(formatBytes(bytes, locale), formatBytes(total, locale))
            : formatBytes(bytes, locale),
        bytesPerSecond === null ? null : formatSpeed(bytesPerSecond, locale),
        etaSeconds === null ? null : `${t.dashboard.eta} ${formatDuration(etaSeconds)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <li className="flex items-center gap-4 rounded-xl p-2 transition-colors hover:bg-white/60">
      <JobThumb still={art.still} poster={art.poster} className={running ? "h-18" : "h-12"}>
        {running && percent !== null && (
          <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 text-[11px] leading-4 font-semibold text-white tabular-nums backdrop-blur-sm">
            {percent}%
          </span>
        )}
        {badge}
      </JobThumb>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <JobTitle job={job} title={art.title} />
          {action}
        </div>
        {running && (
          <>
            <Progress value={percent} aria-label={t.dashboard.progress(name)} />
            <p className="truncate text-xs text-muted-foreground">{line}</p>
          </>
        )}
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
    </li>
  );
}
