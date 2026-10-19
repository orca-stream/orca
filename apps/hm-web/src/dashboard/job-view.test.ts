import { describe, expect, it } from "vite-plus/test";
import { makeJob } from "../test/fixtures";
import {
  activeBySeries,
  canCancel,
  jobName,
  jobSpeedAndEta,
  queuePosition,
  retryableJobs,
  retryWait,
  splitActive,
} from "./job-view";

describe("splitActive", () => {
  it("separates what runs from what waits, the oldest waiting job first", () => {
    const { running, queued } = splitActive([
      makeJob({ id: "j3", status: "queued" }),
      makeJob({ id: "j2", status: "running" }),
      makeJob({ id: "j1", status: "queued" }),
    ]);
    expect(running.map((j) => j.id)).toEqual(["j2"]);
    expect(queued.map((j) => j.id)).toEqual(["j1", "j3"]);
  });

  it("puts a job that waits for a retry after the ones that can start", () => {
    const { queued } = splitActive([
      makeJob({ id: "j1", runAfter: 9_000, attempts: 1 }),
      makeJob({ id: "j2", runAfter: 100 }),
    ]);
    expect(queued.map((j) => j.id)).toEqual(["j2", "j1"]);
  });
});

describe("queuePosition", () => {
  it("counts from one", () => {
    const queued = [makeJob({ id: "a" }), makeJob({ id: "b" })];
    expect(queuePosition(queued, "b")).toBe(2);
    expect(queuePosition(queued, "zzz")).toBeNull();
  });
});

describe("jobSpeedAndEta", () => {
  it("uses the speed and ETA the server measured", () => {
    const job = makeJob({ status: "running", progressDetail: { speed: 2_000_000, eta: 90 } });
    expect(jobSpeedAndEta(job)).toEqual({ bytesPerSecond: 2_000_000, etaSeconds: 90 });
  });

  it("works the ETA out from bytes, total and speed when the server sent none", () => {
    const job = makeJob({
      status: "running",
      progressDetail: { bytes: 400, total: 1000, speed: 100 },
    });
    expect(jobSpeedAndEta(job)).toEqual({ bytesPerSecond: 100, etaSeconds: 6 });
  });

  it("is empty before any progress arrives", () => {
    expect(jobSpeedAndEta(makeJob({ status: "running" }))).toEqual({
      bytesPerSecond: null,
      etaSeconds: null,
    });
  });
});

describe("retryWait", () => {
  it("says how long until a retry, with the attempt it will be", () => {
    const job = makeJob({ attempts: 2, maxAttempts: 5, runAfter: 180_000 });
    expect(retryWait(job, 0)).toEqual({ seconds: 180, attempt: 3, of: 5 });
  });

  it("is null for a job that is simply next, or whose time has come", () => {
    expect(retryWait(makeJob({ attempts: 0, runAfter: 500_000 }), 0)).toBeNull();
    expect(retryWait(makeJob({ attempts: 1, runAfter: 1_000 }), 5_000)).toBeNull();
  });
});

describe("retryableJobs", () => {
  it("keeps the failed jobs worth retrying, not the permanent ones", () => {
    const jobs = [
      makeJob({ id: "a", status: "failed", errorKind: "retryable" }),
      makeJob({ id: "b", status: "failed", errorKind: "permanent" }),
      makeJob({ id: "c", status: "failed", errorKind: null }),
    ];
    expect(retryableJobs(jobs).map((j) => j.id)).toEqual(["a"]);
  });
});

describe("canCancel", () => {
  it("is for queued and running jobs only", () => {
    expect(canCancel(makeJob({ status: "queued" }))).toBe(true);
    expect(canCancel(makeJob({ status: "running" }))).toBe(true);
    expect(canCancel(makeJob({ status: "failed" }))).toBe(false);
    expect(canCancel(makeJob({ status: "done" }))).toBe(false);
  });
});

describe("jobName", () => {
  it("names the episode, the series, or else the kind of job", () => {
    expect(jobName(makeJob(), "Descarga")).toBe("Beverly Hillbillies S01E01");
    expect(jobName(makeJob({ episodeCode: null }), "Descarga")).toBe("Beverly Hillbillies");
    expect(jobName(makeJob({ seriesTitle: null, episodeCode: null }), "Descarga")).toBe("Descarga");
  });
});

describe("activeBySeries", () => {
  it("counts the download jobs in the queue per series", () => {
    const counts = activeBySeries([
      makeJob({ id: "1", seriesId: "a", status: "running" }),
      makeJob({ id: "2", seriesId: "a", status: "queued" }),
      makeJob({ id: "3", seriesId: "b", status: "queued" }),
      makeJob({ id: "4", seriesId: "b", kind: "refresh_library" }),
      makeJob({ id: "5", seriesId: null }),
    ]);
    expect(counts.get("a")).toBe(2);
    expect(counts.get("b")).toBe(1);
    expect(counts.size).toBe(2);
  });
});
