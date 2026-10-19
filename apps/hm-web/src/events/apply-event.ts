import type { HmEvent, JobDto, ProgressDetail } from "@orca/hm-contract";
import { keys } from "../api/keys";

export type Op =
  | { type: "progress"; jobId: string; progress: number | null; detail: ProgressDetail | null }
  | { type: "place"; job: JobDto }
  | { type: "invalidate"; key: readonly unknown[] };

/** The two job lists the dashboard keeps live; the history is refetched, never patched. */
export interface JobLists {
  active: JobDto[];
  failed: JobDto[];
}

const FINAL = new Set<JobDto["status"]>(["done", "failed", "cancelled"]);

function refreshSeries(seriesId: string): Op[] {
  return [
    { type: "invalidate", key: keys.seriesDetail(seriesId) },
    { type: "invalidate", key: keys.episodes(seriesId) },
    { type: "invalidate", key: keys.seriesList },
  ];
}

/**
 * What an SSE event does to the cache, as data. `lastSeq` is the previous event's sequence number
 * (null before the first one): anything but the next number means events were missed, or the
 * server restarted and began again at 1, so what is on screen is refetched first.
 */
export function planEvent(event: HmEvent, lastSeq: number | null): Op[] {
  const ops: Op[] = [];
  if (lastSeq !== null && event.seq !== lastSeq + 1) {
    ops.push({ type: "invalidate", key: keys.jobs }, { type: "invalidate", key: keys.series });
  }
  switch (event.type) {
    case "job.progress":
      ops.push({
        type: "progress",
        jobId: event.jobId,
        progress: event.progress,
        detail: event.detail,
      });
      break;
    case "job.updated":
      ops.push({ type: "place", job: event.job });
      if (FINAL.has(event.job.status)) ops.push({ type: "invalidate", key: keys.jobsHistory });
      if (event.job.seriesId) ops.push(...refreshSeries(event.job.seriesId));
      break;
    case "series.updated":
      ops.push(...refreshSeries(event.seriesId));
      break;
  }
  return ops;
}

/** Newest first, as the server lists them (ids sort by creation). */
function newestFirst(jobs: JobDto[]): JobDto[] {
  return jobs.toSorted((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** Moves a job to the list its status belongs to: active, errors, or neither once it is done or cancelled. */
export function placeJob(lists: JobLists, job: JobDto): JobLists {
  const active = lists.active.filter((item) => item.id !== job.id);
  const failed = lists.failed.filter((item) => item.id !== job.id);
  if (job.status === "queued" || job.status === "running") active.push(job);
  if (job.status === "failed") failed.push(job);
  return { active: newestFirst(active), failed: newestFirst(failed) };
}

/** The same array when the job is not in it, so React Query can skip the re-render. */
export function patchProgress(
  jobs: JobDto[],
  jobId: string,
  progress: number | null,
  detail: ProgressDetail | null,
): JobDto[] {
  if (!jobs.some((job) => job.id === jobId)) return jobs;
  return jobs.map((job) =>
    job.id === jobId ? { ...job, progress, progressDetail: detail ?? job.progressDetail } : job,
  );
}
