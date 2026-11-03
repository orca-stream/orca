import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/api/context";
import { queries } from "@/api/queries";
import { Loading } from "@/components/loading";
import { useT } from "@/i18n/locale";
import { splitActive } from "./job-view";
import { JobRow } from "./JobRow";

/** How many waiting jobs the preview names before it only counts the rest. */
const QUEUED_SHOWN = 3;

/**
 * What is downloading, at a glance: the running jobs with their frame and progress, and the first
 * few that wait behind them. Of one series with `seriesId`, of all of them without. Only to look
 * at: cancelling and retrying live in the dock's downloads.
 */
export function DownloadsPreview({ seriesId }: { seriesId?: string }) {
  const t = useT();
  const api = useApi();
  const active = useQuery(queries.jobsActive(api));
  // The badge counts episode downloads only: a check or a refresh of the library isn't one.
  const jobs = (active.data ?? []).filter(
    (job) => job.kind === "download_episode" && (!seriesId || job.seriesId === seriesId),
  );
  const { running, queued } = splitActive(jobs);
  const more = queued.length - QUEUED_SHOWN;

  if (active.isPending) return <Loading className="m-4 self-center" />;
  if (jobs.length === 0) {
    return <p className="p-2 text-sm text-muted-foreground">{t.dashboard.empty}</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <p className="flex min-h-10 items-center gap-2 px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t.series.detail.nowDownloading}
        <span className="font-normal tabular-nums">{jobs.length}</span>
      </p>
      <ul className="flex flex-col gap-1">
        {running.map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
        {queued.slice(0, QUEUED_SHOWN).map((job) => (
          <JobRow key={job.id} job={job} detail={t.status.queued} />
        ))}
        {more > 0 && (
          <li className="px-2 pb-1 text-xs text-muted-foreground">
            {t.dashboard.moreQueued(more)}
          </li>
        )}
      </ul>
    </div>
  );
}
