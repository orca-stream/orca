import * as z from "zod";

export const JobKind = z.enum(["download_episode", "refresh_library", "check_series"]);
export type JobKind = z.infer<typeof JobKind>;

export const JobStatus = z.enum(["queued", "running", "done", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const ProgressDetail = z.object({
  bytes: z.number().optional(),
  total: z.number().optional(),
  speed: z.number().optional(),
  eta: z.number().optional(),
});
export type ProgressDetail = z.infer<typeof ProgressDetail>;

export const JobDto = z.object({
  id: z.string(),
  kind: JobKind,
  status: JobStatus,
  seriesId: z.string().nullable(),
  seriesTitle: z.string().nullable(),
  episodeId: z.string().nullable(),
  /** `S01E02`, for the jobs that are about one episode. */
  episodeCode: z.string().nullable(),
  progress: z.number().nullable(),
  progressDetail: ProgressDetail.nullable(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  lastError: z.string().nullable(),
  errorKind: z.enum(["retryable", "permanent"]).nullable(),
  runAfter: z.number(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type JobDto = z.infer<typeof JobDto>;

export const ListJobsQuery = z.object({
  /** Comma-separated: `queued,running`. */
  status: z
    .string()
    .transform((value) => value.split(",").filter((part) => part !== ""))
    .pipe(z.array(JobStatus).min(1))
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type ListJobsQuery = z.infer<typeof ListJobsQuery>;

export const EnqueueBody = z.object({ episodeIds: z.array(z.string()).min(1) });
export type EnqueueBody = z.infer<typeof EnqueueBody>;
