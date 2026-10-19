import type { HmEvent, JobDto } from "@orca/hm-contract";
import { describe, expect, it } from "vite-plus/test";
import { keys } from "../api/keys";
import { patchProgress, placeJob, planEvent, type JobLists } from "./apply-event";

function job(over: Partial<JobDto> = {}): JobDto {
  return {
    id: "j1",
    kind: "download_episode",
    status: "running",
    seriesId: "s1",
    seriesTitle: "Show",
    episodeId: "e1",
    episodeCode: "S01E01",
    progress: 0.1,
    progressDetail: null,
    attempts: 1,
    maxAttempts: 5,
    lastError: null,
    errorKind: null,
    runAfter: 0,
    createdAt: 0,
    startedAt: 0,
    finishedAt: null,
    ...over,
  };
}

describe("planEvent", () => {
  it("turns a progress tick into one progress patch and nothing to refetch", () => {
    const event: HmEvent = {
      type: "job.progress",
      seq: 5,
      jobId: "j1",
      progress: 0.5,
      detail: { bytes: 5, total: 10 },
    };
    expect(planEvent(event, 4)).toEqual([
      { type: "progress", jobId: "j1", progress: 0.5, detail: { bytes: 5, total: 10 } },
    ]);
  });

  it("places an updated job and refreshes its series", () => {
    const j = job({ status: "done", progress: 1 });
    const ops = planEvent({ type: "job.updated", seq: 2, job: j }, 1);
    expect(ops).toContainEqual({ type: "place", job: j });
    expect(ops).toContainEqual({ type: "invalidate", key: keys.seriesDetail("s1") });
    expect(ops).toContainEqual({ type: "invalidate", key: keys.episodes("s1") });
    expect(ops).toContainEqual({ type: "invalidate", key: keys.seriesList });
  });

  it("refreshes the history only when a job reaches a final state", () => {
    const running = planEvent({ type: "job.updated", seq: 2, job: job() }, 1);
    expect(running).not.toContainEqual({ type: "invalidate", key: keys.jobsHistory });
    const done = planEvent({ type: "job.updated", seq: 2, job: job({ status: "done" }) }, 1);
    expect(done).toContainEqual({ type: "invalidate", key: keys.jobsHistory });
  });

  it("does not touch series for a job that belongs to none", () => {
    const ops = planEvent(
      { type: "job.updated", seq: 2, job: job({ kind: "refresh_library", seriesId: null }) },
      1,
    );
    expect(ops.filter((op) => op.type === "invalidate" && op.key[0] === "series")).toEqual([]);
  });

  it("refreshes a series on series.updated", () => {
    const ops = planEvent({ type: "series.updated", seq: 3, seriesId: "s9" }, 2);
    expect(ops).toEqual([
      { type: "invalidate", key: keys.seriesDetail("s9") },
      { type: "invalidate", key: keys.episodes("s9") },
      { type: "invalidate", key: keys.seriesList },
    ]);
  });

  it("refetches everything on a gap in the sequence, then still applies the event", () => {
    const ops = planEvent({ type: "series.updated", seq: 9, seriesId: "s9" }, 4);
    expect(ops.slice(0, 2)).toEqual([
      { type: "invalidate", key: keys.jobs },
      { type: "invalidate", key: keys.series },
    ]);
    expect(ops.length).toBeGreaterThan(2);
  });

  it("treats a lower seq (the server restarted) as a gap, and the first event as none", () => {
    expect(planEvent({ type: "series.updated", seq: 1, seriesId: "s" }, 40)[0]).toEqual({
      type: "invalidate",
      key: keys.jobs,
    });
    expect(planEvent({ type: "series.updated", seq: 7, seriesId: "s" }, null)[0]).toEqual({
      type: "invalidate",
      key: keys.seriesDetail("s"),
    });
  });
});

const empty: JobLists = { active: [], failed: [] };

describe("placeJob", () => {
  it("puts a running job among the active ones, replacing its earlier copy", () => {
    const lists = placeJob(
      { active: [job({ progress: 0.1 })], failed: [] },
      job({ progress: 0.9 }),
    );
    expect(lists.active).toHaveLength(1);
    expect(lists.active[0]?.progress).toBe(0.9);
  });

  it("moves a failed job to the errors list and out of the active one", () => {
    const lists = placeJob({ active: [job()], failed: [] }, job({ status: "failed" }));
    expect(lists.active).toEqual([]);
    expect(lists.failed.map((j) => j.id)).toEqual(["j1"]);
  });

  it("moves a retried job back to the active list and out of the errors", () => {
    const lists = placeJob(
      { active: [], failed: [job({ status: "failed" })] },
      job({ status: "queued" }),
    );
    expect(lists.failed).toEqual([]);
    expect(lists.active.map((j) => j.status)).toEqual(["queued"]);
  });

  it("drops a finished or cancelled job from both lists", () => {
    const start: JobLists = { active: [job()], failed: [job({ id: "j2", status: "failed" })] };
    expect(placeJob(start, job({ status: "done" })).active).toEqual([]);
    expect(placeJob(start, job({ id: "j2", status: "cancelled" })).failed).toEqual([]);
  });

  it("keeps the newest first and ignores other kinds of lists it was not given", () => {
    const lists = placeJob(
      { active: [job({ id: "j1" })], failed: [] },
      job({ id: "j3", status: "queued" }),
    );
    expect(lists.active.map((j) => j.id)).toEqual(["j3", "j1"]);
    expect(placeJob(empty, job({ id: "x", status: "done" }))).toEqual(empty);
  });
});

describe("patchProgress", () => {
  it("updates only the job it names", () => {
    const jobs = [job({ id: "a" }), job({ id: "b" })];
    const next = patchProgress(jobs, "b", 0.7, { speed: 10 });
    expect(next[0]).toBe(jobs[0]);
    expect(next[1]).toMatchObject({ progress: 0.7, progressDetail: { speed: 10 } });
  });

  it("returns the same array when the job is not there", () => {
    const jobs = [job({ id: "a" })];
    expect(patchProgress(jobs, "zzz", 1, null)).toBe(jobs);
  });
});
