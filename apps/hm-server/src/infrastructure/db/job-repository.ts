import { and, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { ProgressDetail } from "@orca/hm-contract";
import type {
  Clock,
  EnqueueResult,
  JobRepository,
  ListJobsFilter,
} from "../../application/ports.ts";
import { uuidv7 } from "../../domain/ids.ts";
import type { Job, NewJob } from "../../domain/job.ts";
import type { Database_, Db } from "./client.ts";
import { jobs } from "./schema.ts";

type Row = typeof jobs.$inferSelect;

function toJob(row: Row): Job {
  return {
    ...row,
    kind: row.kind as Job["kind"],
    status: row.status as Job["status"],
    resource: row.resource as Job["resource"],
    progressDetail: (row.progressDetail ?? null) as ProgressDetail | null,
    errorKind: row.errorKind as Job["errorKind"],
  };
}

/** The `RETURNING *` of the raw claim statement comes back with column names, not field names. */
function fromRaw(raw: Record<string, unknown>): Job {
  const parse = (value: unknown) =>
    typeof value === "string" ? (JSON.parse(value) as unknown) : null;
  return toJob({
    id: raw.id as string,
    kind: raw.kind as string,
    status: raw.status as string,
    payload: parse(raw.payload),
    seriesId: raw.series_id as string | null,
    episodeId: raw.episode_id as string | null,
    resource: raw.resource as string,
    priority: raw.priority as number,
    attempts: raw.attempts as number,
    maxAttempts: raw.max_attempts as number,
    runAfter: raw.run_after as number,
    leaseOwner: raw.lease_owner as string | null,
    leaseExpiresAt: raw.lease_expires_at as number | null,
    progress: raw.progress as number | null,
    progressDetail: parse(raw.progress_detail),
    lastError: raw.last_error as string | null,
    errorKind: raw.error_kind as string | null,
    dedupeKey: raw.dedupe_key as string | null,
    createdAt: raw.created_at as number,
    updatedAt: raw.updated_at as number,
    startedAt: raw.started_at as number | null,
    finishedAt: raw.finished_at as number | null,
  });
}

const ACTIVE = sql`${jobs.status} in ('queued', 'running')`;

export class DrizzleJobRepository implements JobRepository {
  private readonly db: Db;
  private readonly clock: Clock;
  private readonly claimStatement;

  constructor(database: Pick<Database_, "db" | "sqlite">, clock: Clock) {
    this.db = database.db;
    this.clock = clock;
    // One UPDATE ... RETURNING is atomic in SQLite, and better-sqlite3 is synchronous, so two
    // workers can never take the same job.
    this.claimStatement = database.sqlite.prepare(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_owner = @owner,
         lease_expires_at = @leaseUntil, started_at = @now, updated_at = @now, finished_at = NULL
       WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= @now AND resource = @resource
                   ORDER BY priority DESC, created_at, id LIMIT 1)
       RETURNING *`,
    );
  }

  async enqueue(job: NewJob): Promise<EnqueueResult> {
    const now = this.clock.now();
    const row: Row = {
      id: uuidv7(now),
      kind: job.kind,
      status: "queued",
      payload: job.payload ?? {},
      seriesId: job.seriesId ?? null,
      episodeId: job.episodeId ?? null,
      resource: job.resource,
      priority: job.priority ?? 0,
      attempts: 0,
      maxAttempts: job.maxAttempts ?? 5,
      runAfter: job.runAfter ?? now,
      leaseOwner: null,
      leaseExpiresAt: null,
      progress: null,
      progressDetail: null,
      lastError: null,
      errorKind: null,
      dedupeKey: job.dedupeKey ?? null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    try {
      this.db.insert(jobs).values(row).run();
    } catch (error) {
      if (job.dedupeKey && isUniqueViolation(error)) {
        const existing = this.db
          .select()
          .from(jobs)
          .where(and(eq(jobs.dedupeKey, job.dedupeKey), ACTIVE))
          .get();
        if (existing) return { job: toJob(existing), created: false };
      }
      throw error;
    }
    return { job: toJob(row), created: true };
  }

  async claim(resource: Job["resource"], leaseOwner: string, leaseMs: number): Promise<Job | null> {
    const now = this.clock.now();
    const raw = this.claimStatement.get({
      owner: leaseOwner,
      leaseUntil: now + leaseMs,
      now,
      resource,
    }) as Record<string, unknown> | undefined;
    return raw ? fromRaw(raw) : null;
  }

  async heartbeat(id: string, leaseOwner: string, leaseMs: number): Promise<void> {
    this.db
      .update(jobs)
      .set({ leaseExpiresAt: this.clock.now() + leaseMs })
      .where(and(eq(jobs.id, id), eq(jobs.leaseOwner, leaseOwner), eq(jobs.status, "running")))
      .run();
  }

  async updateProgress(
    id: string,
    progress: number | null,
    detail: ProgressDetail | null,
  ): Promise<void> {
    this.db
      .update(jobs)
      .set({ progress, progressDetail: detail, updatedAt: this.clock.now() })
      .where(eq(jobs.id, id))
      .run();
  }

  async complete(id: string, leaseOwner: string): Promise<Job | null> {
    return this.settle(id, this.running(leaseOwner), {
      status: "done",
      progress: 1,
      finishedAt: this.clock.now(),
      lastError: null,
      errorKind: null,
    });
  }

  async fail(
    id: string,
    leaseOwner: string,
    error: string,
    kind: "retryable" | "permanent",
  ): Promise<Job | null> {
    return this.settle(id, this.running(leaseOwner), {
      status: "failed",
      lastError: error,
      errorKind: kind,
      finishedAt: this.clock.now(),
    });
  }

  async requeue(
    id: string,
    leaseOwner: string,
    runAfter: number,
    error: string,
  ): Promise<Job | null> {
    return this.settle(id, this.running(leaseOwner), {
      status: "queued",
      runAfter,
      lastError: error,
      errorKind: "retryable",
      progress: null,
      progressDetail: null,
    });
  }

  async cancelQueued(id: string): Promise<Job | null> {
    return this.settle(id, eq(jobs.status, "queued"), {
      status: "cancelled",
      finishedAt: this.clock.now(),
    });
  }

  async cancelRunning(id: string, leaseOwner: string): Promise<Job | null> {
    return this.settle(id, this.running(leaseOwner), {
      status: "cancelled",
      finishedAt: this.clock.now(),
    });
  }

  async retry(id: string): Promise<Job | null> {
    const now = this.clock.now();
    const updated = this.db
      .update(jobs)
      .set({
        status: "queued",
        attempts: 0,
        runAfter: now,
        lastError: null,
        errorKind: null,
        progress: null,
        progressDetail: null,
        finishedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "cancelled"])))
      .returning()
      .get();
    return updated ? toJob(updated) : null;
  }

  async postpone(id: string, runAfter: number): Promise<void> {
    this.db
      .update(jobs)
      .set({ runAfter, updatedAt: this.clock.now() })
      .where(and(eq(jobs.id, id), eq(jobs.status, "queued")))
      .run();
  }

  async recoverRunning(): Promise<number> {
    return this.recover(sql`${jobs.status} = 'running'`);
  }

  async recoverExpired(exceptIds: string[]): Promise<number> {
    const expired = sql`${jobs.status} = 'running' and ${jobs.leaseExpiresAt} < ${this.clock.now()}`;
    return this.recover(
      exceptIds.length > 0 ? sql`${expired} and ${notInArray(jobs.id, exceptIds)}` : expired,
    );
  }

  async get(id: string): Promise<Job | null> {
    const row = this.db.select().from(jobs).where(eq(jobs.id, id)).get();
    return row ? toJob(row) : null;
  }

  async list(filter: ListJobsFilter): Promise<{ items: Job[]; nextCursor: string | null }> {
    const conditions = [
      filter.status ? inArray(jobs.status, filter.status) : undefined,
      filter.cursor ? lt(jobs.id, filter.cursor) : undefined,
    ].filter((condition) => condition !== undefined);
    const rows = this.db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(jobs.id))
      .limit(filter.limit + 1)
      .all();
    const items = rows.slice(0, filter.limit).map(toJob);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > filter.limit && last ? last.id : null };
  }

  private recover(where: ReturnType<typeof sql>): number {
    const result = this.db
      .update(jobs)
      .set({
        status: "queued",
        leaseOwner: null,
        leaseExpiresAt: null,
        attempts: sql`max(${jobs.attempts} - 1, 0)`,
        updatedAt: this.clock.now(),
      })
      .where(where)
      .run();
    return result.changes;
  }

  private running(leaseOwner: string) {
    return and(eq(jobs.status, "running"), eq(jobs.leaseOwner, leaseOwner));
  }

  /** One conditional UPDATE: it only lands if the row is still in the state the caller expects. */
  private settle(id: string, expected: ReturnType<typeof and>, patch: Partial<Row>): Job | null {
    const updated = this.db
      .update(jobs)
      .set({ leaseOwner: null, leaseExpiresAt: null, ...patch, updatedAt: this.clock.now() })
      .where(and(eq(jobs.id, id), expected))
      .returning()
      .get();
    return updated ? toJob(updated) : null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}
