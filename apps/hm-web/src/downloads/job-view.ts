import type { JobDto } from "@orca/hm-contract";
import { etaSeconds } from "@/i18n/format";

const byId = (a: JobDto, b: JobDto) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The queue in the order the worker will take it: running first, then the waiting ones oldest
 * first, with the jobs that sit out a retry delay behind those that can start now.
 */
export function splitActive(jobs: readonly JobDto[]): { running: JobDto[]; queued: JobDto[] } {
  const running = jobs.filter((job) => job.status === "running").toSorted(byId);
  const queued = jobs
    .filter((job) => job.status === "queued")
    .toSorted((a, b) => a.runAfter - b.runAfter || byId(a, b));
  return { running, queued };
}

/** 1-based place in the queue, or null when the job is not there. */
export function queuePosition(queued: readonly JobDto[], jobId: string): number | null {
  const index = queued.findIndex((job) => job.id === jobId);
  return index === -1 ? null : index + 1;
}

export function jobSpeedAndEta(job: JobDto): {
  bytesPerSecond: number | null;
  etaSeconds: number | null;
} {
  const detail = job.progressDetail;
  const bytesPerSecond = detail?.speed && detail.speed > 0 ? detail.speed : null;
  if (detail?.eta !== undefined) return { bytesPerSecond, etaSeconds: Math.ceil(detail.eta) };
  if (bytesPerSecond === null) return { bytesPerSecond, etaSeconds: null };
  return {
    bytesPerSecond,
    etaSeconds: etaSeconds({
      loaded: detail?.bytes ?? 0,
      total: detail?.total ?? null,
      bytesPerSecond,
    }),
  };
}

/** For a job waiting to be retried: how long is left and which attempt it will be. */
export function retryWait(
  job: JobDto,
  now: number,
): { seconds: number; attempt: number; of: number } | null {
  if (job.status !== "queued" || job.attempts === 0 || job.runAfter <= now) return null;
  return {
    seconds: Math.ceil((job.runAfter - now) / 1000),
    attempt: job.attempts + 1,
    of: job.maxAttempts,
  };
}

export function retryableJobs(jobs: readonly JobDto[]): JobDto[] {
  return jobs.filter((job) => job.status === "failed" && job.errorKind === "retryable");
}

export function canCancel(job: JobDto): boolean {
  return job.status === "queued" || job.status === "running";
}

/** What a job is about: the series and episode when it has them, else what kind of job it is. */
export function jobName(job: JobDto, kindLabel: string): string {
  if (!job.seriesTitle) return kindLabel;
  return job.episodeCode ? `${job.seriesTitle} ${job.episodeCode}` : job.seriesTitle;
}

/**
 * Whether the job is the server's own housekeeping rather than something asked for: the library
 * refresh it queues after each episode lands, so Jellyfin picks it up. The lists leave it out unless
 * it failed.
 */
export function isHousekeeping(job: JobDto): boolean {
  return job.kind === "refresh_library";
}
