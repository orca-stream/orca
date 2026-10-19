import type { JobKind, JobStatus, ProgressDetail } from "@orca/hm-contract";

/** What limits how many jobs run at once. `none` is for quick jobs that need no slot. */
export type Resource = "browser" | "download" | "ffmpeg" | "none";

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** JSON, validated per kind where it is read. */
  payload: unknown;
  seriesId: string | null;
  episodeId: string | null;
  resource: Resource;
  priority: number;
  attempts: number;
  maxAttempts: number;
  /** Epoch ms: backoff and scheduling. */
  runAfter: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  progress: number | null;
  progressDetail: ProgressDetail | null;
  lastError: string | null;
  errorKind: "retryable" | "permanent" | null;
  dedupeKey: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export type NewJob = Pick<Job, "kind" | "payload" | "resource"> &
  Partial<
    Pick<Job, "seriesId" | "episodeId" | "priority" | "maxAttempts" | "runAfter" | "dedupeKey">
  >;

export function isTerminal(status: JobStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}
