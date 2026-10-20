import type { JobKind, JobStatus, ProgressDetail } from "@orca/hm-contract";

/** The resources with a configured number of slots. `none` is for quick jobs that need no slot. */
export type FixedResource = "browser" | "download" | "ffmpeg" | "none";

/**
 * What limits how many jobs run at once. A `host:` lane belongs to one host of video players and
 * runs one job at a time: as many run together as there are hosts with work.
 */
export type Resource = FixedResource | HostLane;
export type HostLane = `host:${string}`;

export const HOST_LANE_PREFIX = "host:";

/** The lane of the host a player is on. */
export function hostLane(url: string): HostLane {
  return `${HOST_LANE_PREFIX}${new URL(url).hostname.toLowerCase()}`;
}

export function isHostLane(resource: string): resource is HostLane {
  return resource.startsWith(HOST_LANE_PREFIX);
}

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
