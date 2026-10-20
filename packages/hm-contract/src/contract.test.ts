import { describe, expect, it } from "vite-plus/test";
import {
  ApiErrorBody,
  CreateSeriesBody,
  episodeOffset,
  ImdbId,
  mapEpisode,
  TmdbId,
  HmEvent,
  ListJobsQuery,
  LoginBody,
  MarkReadBody,
  NotificationDto,
  NotificationList,
  Page,
  PreviewDto,
  SeriesDto,
  SeriesPatch,
} from "./index.ts";
import * as z from "zod";
import { readFileSync } from "node:fs";
import { HM_EVENT_TYPES, isHmEvent } from "./rules.ts";

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
    expect(body).toMatchObject({ follow: false, downloadNow: false });
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
    expect(main.isHmEvent).toBe(isHmEvent);
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
  const notification = {
    id: "n1",
    kind: "new_episodes",
    title: "New episodes",
    body: "Show: 2 new episodes",
    seriesId: "s1",
    jobId: null,
    data: { seriesTitle: "Show", count: 2 },
    createdAt: 1,
    readAt: null,
  };
  const valid = [
    { type: "job.updated", seq: 1, job },
    { type: "job.progress", seq: 2, jobId: "j1", progress: 0.5, detail: null },
    { type: "series.updated", seq: 3, seriesId: "s1" },
    { type: "notification.created", seq: 4, notification },
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
    { type: "notification.created", seq: 1 },
    { type: "notification.created", seq: 1, notification: { id: 3 } },
  ])("rejects %j", (event) => {
    expect(isHmEvent(event)).toBe(false);
  });
});

describe("notifications", () => {
  const dto = {
    id: "n1",
    kind: "job_failed",
    title: "A download failed",
    body: "Show S01E01: HTTP 404",
    seriesId: null,
    jobId: "j1",
    data: { episodeCode: "S01E01", count: null },
    createdAt: 5,
    readAt: null,
  };

  it("describes a notification, its kinds and the list with its unread count", () => {
    expect(NotificationDto.safeParse(dto).success).toBe(true);
    expect(NotificationDto.safeParse({ ...dto, kind: "other" }).success).toBe(false);
    expect(NotificationList.safeParse({ items: [dto], unreadCount: 1 }).success).toBe(true);
    expect(NotificationList.safeParse({ items: [dto] }).success).toBe(false);
  });

  it("knows the kind for episodes that could not be added", () => {
    expect(NotificationDto.safeParse({ ...dto, kind: "episodes_skipped" }).success).toBe(true);
    expect(NotificationDto.safeParse({ ...dto, kind: "episodes_learned" }).success).toBe(true);
  });

  it("marks some notifications read, or all of them when no ids are given", () => {
    expect(MarkReadBody.parse({})).toEqual({});
    expect(MarkReadBody.parse({ ids: ["a"] })).toEqual({ ids: ["a"] });
    expect(MarkReadBody.safeParse({ ids: [] }).success).toBe(false);
    // A bound on what one request can carry.
    expect(MarkReadBody.safeParse({ ids: Array(500).fill("a") }).success).toBe(true);
    expect(MarkReadBody.safeParse({ ids: Array(501).fill("a") }).success).toBe(false);
    expect(MarkReadBody.safeParse({ ids: ["a".repeat(201)] }).success).toBe(false);
  });
});

describe("track preferences", () => {
  it("are optional in a patch, and null clears one", () => {
    expect(SeriesPatch.parse({})).toEqual({});
    expect(
      SeriesPatch.parse({ maxHeight: 720, audioLangs: ["spa", "eng"], subtitleLangs: [] }),
    ).toEqual({
      maxHeight: 720,
      audioLangs: ["spa", "eng"],
      subtitleLangs: [],
    });
    expect(SeriesPatch.parse({ maxHeight: null, audioLangs: null, subtitleLangs: null })).toEqual({
      maxHeight: null,
      audioLangs: null,
      subtitleLangs: null,
    });
  });

  it("take ISO 639-2 codes (three lower-case letters), never names", () => {
    for (const bad of ["english", "EN", "es", "sp1", ""]) {
      expect(SeriesPatch.safeParse({ audioLangs: [bad] }).success).toBe(false);
      expect(SeriesPatch.safeParse({ subtitleLangs: [bad] }).success).toBe(false);
    }
    // Audio needs at least one: an empty list would mean a silent video. Subtitles may be none.
    expect(SeriesPatch.safeParse({ audioLangs: [] }).success).toBe(false);
    expect(SeriesPatch.safeParse({ audioLangs: Array(11).fill("eng") }).success).toBe(false);
  });

  it("limit the height to a real video size", () => {
    for (const bad of [0, 100, 5000, 720.5]) {
      expect(SeriesPatch.safeParse({ maxHeight: bad }).success).toBe(false);
    }
    expect(SeriesPatch.safeParse({ maxHeight: 4320 }).success).toBe(true);
  });

  it("show on the series with null for 'use the defaults'", () => {
    expect(SeriesDto.shape.maxHeight.safeParse(null).success).toBe(true);
    expect(SeriesDto.shape.audioLangs.safeParse(["eng"]).success).toBe(true);
    expect(SeriesDto.shape.subtitleLangs.safeParse(undefined).success).toBe(false);
  });
});

describe("seasons in parts", () => {
  it("moves the lowest episode of an address to the first episode given, whatever the site counts from", () => {
    expect(episodeOffset(13, [1, 2, 3])).toBe(12);
    expect(episodeOffset(13, [13, 14])).toBe(0);
    expect(episodeOffset(1, [25, 26])).toBe(-24);
    expect(episodeOffset(null, [5])).toBe(0);
    expect(episodeOffset(7, [])).toBe(0);
    expect(mapEpisode({ season: 1, episode: 2 }, { season: 3, offset: 12 })).toEqual({
      season: 3,
      episode: 14,
    });
    expect(mapEpisode({ season: 2, episode: 2 }, { season: null, offset: 0 })).toEqual({
      season: 2,
      episode: 2,
    });
  });

  it("needs a title for a new series only, and defaults the numbering and the ids to none", () => {
    const base = { previewId: "p", episodeKeys: ["a"] };
    expect(CreateSeriesBody.safeParse(base).success).toBe(false);
    expect(CreateSeriesBody.parse({ ...base, seriesId: "s1" })).toMatchObject({
      seriesId: "s1",
      season: null,
      firstEpisode: null,
      tmdbId: null,
      imdbId: null,
    });
    expect(CreateSeriesBody.safeParse({ ...base, title: "x", season: -1 }).success).toBe(false);
  });

  it("accepts TMDB and IMDb ids only in their own shapes", () => {
    expect(TmdbId.safeParse("12345").success).toBe(true);
    expect(TmdbId.safeParse("tv/12345").success).toBe(false);
    expect(ImdbId.safeParse("tt0123456").success).toBe(true);
    expect(ImdbId.safeParse("0123456").success).toBe(false);
    expect(SeriesPatch.parse({ tmdbId: null, imdbId: " tt0123456 " })).toEqual({
      tmdbId: null,
      imdbId: "tt0123456",
    });
  });
});
