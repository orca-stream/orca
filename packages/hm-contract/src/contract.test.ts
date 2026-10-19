import { describe, expect, it } from "vite-plus/test";
import {
  ApiErrorBody,
  CreateSeriesBody,
  HmEvent,
  ListJobsQuery,
  LoginBody,
  Page,
  PreviewDto,
  SeriesDto,
  SeriesPatch,
} from "./index.ts";
import * as z from "zod";
import { readFileSync } from "node:fs";
import { HM_EVENT_TYPES, isHmEvent, needsLicenseAck } from "./rules.ts";

describe("needsLicenseAck", () => {
  it.each([
    ["unknown", 1960, true],
    ["unknown", null, true],
    ["public-domain", 1962, false],
    ["public-domain", 1977, false],
    ["public-domain", 1978, true],
    ["cc0", 1996, true],
    ["cc-by", 1950, false],
    ["public-domain", null, true],
    ["public-domain", undefined, true],
  ] as const)("license %s, year %s -> %s", (license, year, expected) => {
    expect(needsLicenseAck({ license, year })).toBe(expected);
  });
});

describe("ListJobsQuery", () => {
  it("reads status as a comma-separated list and applies limits", () => {
    expect(ListJobsQuery.parse({ status: "queued,running", limit: "20" })).toEqual({
      status: ["queued", "running"],
      limit: 20,
    });
    expect(ListJobsQuery.parse({})).toEqual({ limit: 50 });
  });

  it("rejects an unknown status and a limit out of range", () => {
    expect(ListJobsQuery.safeParse({ status: "queued,nope" }).success).toBe(false);
    expect(ListJobsQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(ListJobsQuery.safeParse({ limit: "1000" }).success).toBe(false);
  });
});

describe("bodies", () => {
  it("requires non-empty credentials", () => {
    expect(LoginBody.safeParse({ username: "", password: "x" }).success).toBe(false);
    expect(LoginBody.safeParse({ username: "sam", password: "x" }).success).toBe(true);
  });

  it("caps credential length so a login cannot bloat the server's memory", () => {
    expect(LoginBody.safeParse({ username: "a".repeat(257), password: "x" }).success).toBe(false);
    expect(LoginBody.safeParse({ username: "a".repeat(256), password: "x" }).success).toBe(true);
    expect(LoginBody.safeParse({ username: "sam", password: "x".repeat(1025) }).success).toBe(
      false,
    );
  });

  it("defaults the optional flags of a new series to false", () => {
    const body = CreateSeriesBody.parse({
      previewId: "p1",
      title: "Show",
      year: 1962,
      episodeKeys: ["a/b.mp4"],
    });
    expect(body).toMatchObject({ follow: false, downloadNow: false, licenseAck: false });
  });

  it("caps titles at 150 characters, so they stay valid folder names", () => {
    const long = "x".repeat(151);
    const base = { previewId: "p", year: 1962, episodeKeys: ["a"] };
    expect(CreateSeriesBody.safeParse({ ...base, title: long }).success).toBe(false);
    expect(CreateSeriesBody.safeParse({ ...base, title: "x".repeat(150) }).success).toBe(true);
    expect(SeriesPatch.safeParse({ title: long }).success).toBe(false);
  });

  it("allows clearing the year in a patch", () => {
    expect(SeriesPatch.parse({ year: null })).toEqual({ year: null });
  });
});

describe("HmEvent", () => {
  it("discriminates on type", () => {
    const progress = HmEvent.parse({
      type: "job.progress",
      seq: 3,
      jobId: "j1",
      progress: 0.5,
      detail: { bytes: 5, total: 10 },
    });
    expect(progress.type).toBe("job.progress");
    expect(HmEvent.safeParse({ type: "nope", seq: 1 }).success).toBe(false);
  });
});

describe("Page and errors", () => {
  it("wraps items with a cursor", () => {
    const schema = Page(z.string());
    expect(schema.parse({ items: ["a"], nextCursor: null })).toEqual({
      items: ["a"],
      nextCursor: null,
    });
  });

  it("shapes an error body", () => {
    expect(
      ApiErrorBody.parse({ error: "bad_request", issues: [{ path: "url", message: "x" }] }),
    ).toBeTruthy();
  });
});

describe("PreviewDto and SeriesDto additions", () => {
  it("PreviewDto carries a nullable posterUrl and SeriesDto a downloadingCount", () => {
    expect(PreviewDto.shape.posterUrl.safeParse(null).success).toBe(true);
    expect(PreviewDto.shape.posterUrl.safeParse("/api/series/preview/x/poster").success).toBe(true);
    expect(PreviewDto.shape.posterUrl.safeParse(undefined).success).toBe(false);
    expect(SeriesDto.shape.downloadingCount.safeParse(2).success).toBe(true);
    expect(SeriesDto.shape.downloadingCount.safeParse(1.5).success).toBe(false);
  });
});

describe("the rules module", () => {
  it("is exported on its own and still re-exported by the main entry", async () => {
    const main = await import("./index.ts");
    expect(main.needsLicenseAck).toBe(needsLicenseAck);
  });

  it("imports nothing from zod, so the panel can use it without the schemas", () => {
    const source = readFileSync(new URL("./rules.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']zod["']/);
    // Relative imports are fine only as `import type`, which is erased.
    expect(source).not.toMatch(/^import\s+(?!type\b)[^;]*from\s+["']\./m);
  });

  it("lists the same event types as the HmEvent schema", () => {
    expect([...HM_EVENT_TYPES].sort()).toEqual(
      HmEvent.options.map((option) => option.shape.type.value).sort(),
    );
  });
});

describe("isHmEvent", () => {
  const job = {
    id: "j1",
    kind: "download_episode",
    status: "running",
    seriesId: "s1",
    seriesTitle: "S",
    episodeId: "e1",
    episodeCode: "S01E01",
    progress: 0.5,
    progressDetail: null,
    attempts: 1,
    maxAttempts: 5,
    lastError: null,
    errorKind: null,
    runAfter: 0,
    createdAt: 0,
    startedAt: 0,
    finishedAt: null,
  };
  const valid = [
    { type: "job.updated", seq: 1, job },
    { type: "job.progress", seq: 2, jobId: "j1", progress: 0.5, detail: null },
    { type: "series.updated", seq: 3, seriesId: "s1" },
  ];

  it.each(valid)("accepts what the schema accepts: $type", (event) => {
    expect(HmEvent.safeParse(event).success).toBe(true);
    expect(isHmEvent(event)).toBe(true);
  });

  it.each([
    null,
    "job.updated",
    {},
    { type: "nope", seq: 1 },
    { type: "series.updated", seq: "1", seriesId: "s1" },
    { type: "series.updated", seq: 1 },
    { type: "job.updated", seq: 1, job: null },
    { type: "job.updated", seq: 1, job: { id: 3 } },
    { type: "job.progress", seq: 1, jobId: "j1", progress: "x", detail: null },
  ])("rejects %j", (event) => {
    expect(isHmEvent(event)).toBe(false);
  });
});
