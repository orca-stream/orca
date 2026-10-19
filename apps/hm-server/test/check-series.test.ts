import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createCheckSeries } from "../src/application/check-series.ts";
import { PermanentError, RetryableError } from "../src/domain/errors.ts";
import { ExtractorError } from "@orca/extractor-core";
import { createHarness, type Harness } from "./harness.ts";
import { FakeExtractor, FAKE_URL, fakeEpisode, networkError } from "./fakes/extractor.ts";

let h: Harness;
let site: FakeExtractor;
let check: ReturnType<typeof createCheckSeries>;

beforeEach(async () => {
  site = new FakeExtractor();
  h = await createHarness({ extractors: [site] });
  // Downloads are not under test here: keep the real queue from running what a check enqueues.
  h.deps.queue = { notify: () => {} };
  check = createCheckSeries(h.deps);
});
afterEach(() => h.cleanup());

/** Adds the fake site's series, optionally with only some of its episodes. */
async function addFake(options: { follow?: boolean; only?: string[] } = {}) {
  const preview = await h.useCases.previewSeries(FAKE_URL);
  return h.useCases.addSeries({
    previewId: preview.previewId,
    title: "Fake Show",
    year: 1960,
    episodeKeys: options.only ?? preview.episodes.map((episode) => episode.key),
    follow: options.follow ?? true,
    downloadNow: false,
    licenseAck: true,
  });
}

const downloadJobs = async () =>
  (await h.jobs.list({ status: ["queued", "running"], limit: 50 })).items.filter(
    (job) => job.kind === "download_episode",
  );

describe("CheckSeries: nothing changed", () => {
  it("compares the marker, does not extract again, and only stamps last_checked_at", async () => {
    const created = await addFake();
    h.clock.advance(60_000);
    const result = await check(created.id);
    expect(result).toMatchObject({ changed: false, added: 0 });
    expect(site.markerCalls).toBe(1);
    expect(site.extractCalls).toBe(1); // the preview, not the check
    expect((await h.series.get(created.id))?.lastCheckedAt).toBe(h.clock.now());
    expect(await h.series.listEpisodes(created.id)).toHaveLength(2);
  });
});

describe("CheckSeries: the series changed", () => {
  it("re-extracts, adds the new episode and saves the new marker", async () => {
    const created = await addFake();
    site.marker = "m2";
    site.episodes = [...site.episodes, fakeEpisode(3)];
    h.clock.advance(60_000);

    const result = await check(created.id);

    expect(result).toMatchObject({ changed: true, added: 1 });
    const episodes = await h.series.listEpisodes(created.id);
    expect(episodes.map((e) => [e.season, e.episode, e.status])).toEqual([
      [1, 1, "missing"],
      [1, 2, "missing"],
      [1, 3, "queued"],
    ]);
    const stored = await h.series.get(created.id);
    expect(stored).toMatchObject({ remoteMarker: "m2", lastCheckedAt: h.clock.now() });
  });

  it("matches episodes by their stable key: existing rows keep their id, status and file", async () => {
    const created = await addFake({ follow: false });
    const [first] = await h.series.listEpisodes(created.id);
    await h.series.setEpisodeStatus(first!.id, "available", "Fake Show (1960)/Season 01/x.mp4");
    site.marker = "m2";
    site.episodes = [fakeEpisode(1, { title: "Renamed by the site" }), fakeEpisode(2)];

    await check(created.id);

    const after = await h.series.getEpisode(first!.id);
    expect(after).toMatchObject({
      id: first!.id,
      title: "Renamed by the site",
      status: "available",
      filePath: "Fake Show (1960)/Season 01/x.mp4",
    });
    expect(await h.series.listEpisodes(created.id)).toHaveLength(2);
  });

  it("enqueues only the new episodes, and only when the series is followed", async () => {
    const followed = await addFake({ follow: true });
    site.marker = "m2";
    site.episodes = [...site.episodes, fakeEpisode(3)];
    await check(followed.id);
    const jobs = await downloadJobs();
    expect(jobs).toHaveLength(1);
    const episode = await h.series.getEpisode(jobs[0]!.episodeId!);
    expect(episode).toMatchObject({ episode: 3, status: "queued" });
  });

  it("leaves new episodes missing when the series is not followed (a manual check)", async () => {
    const created = await addFake({ follow: false });
    site.marker = "m2";
    site.episodes = [...site.episodes, fakeEpisode(3)];
    const result = await check(created.id);
    expect(result.added).toBe(1);
    expect(await downloadJobs()).toEqual([]);
    const last = (await h.series.listEpisodes(created.id)).at(-1);
    expect(last).toMatchObject({ episode: 3, status: "missing" });
  });

  it("does not add the episodes the user left out when adding the series", async () => {
    const created = await addFake({ only: ["show/e1.mp4"] });
    site.marker = "m2";
    site.episodes = [fakeEpisode(1), fakeEpisode(2), fakeEpisode(3)];
    const result = await check(created.id);
    // e2 existed already when the series was added and was declined; only e3 is news.
    expect(result.added).toBe(1);
    expect((await h.series.listEpisodes(created.id)).map((e) => e.sourceRef)).toEqual([
      "show/e1.mp4",
      "show/e3.mp4",
    ]);
  });

  it("skips a new episode whose number is taken by another one, and says so", async () => {
    const created = await addFake({ follow: false });
    site.marker = "m2";
    site.episodes = [
      fakeEpisode(1),
      fakeEpisode(2),
      fakeEpisode(2, { sourceRef: "show/other.mp4" }),
    ];
    const result = await check(created.id);
    expect(result).toMatchObject({ added: 0, skipped: 1 });
  });

  it("re-extracts every time when the extractor has no cheap marker", async () => {
    site.withoutMarker();
    const created = await addFake({ follow: false });
    const before = site.extractCalls;
    const result = await check(created.id);
    expect(site.extractCalls).toBe(before + 1);
    expect(result.changed).toBe(true);
    expect(result.added).toBe(0);
  });
});

describe("CheckSeries: failures", () => {
  it("saves the marker only after the episodes were stored, so a failure is retried", async () => {
    const created = await addFake({ follow: false });
    site.marker = "m2";
    site.episodes = [...site.episodes, fakeEpisode(3)];
    const upsert = h.deps.series.upsertEpisodes.bind(h.deps.series);
    h.deps.series.upsertEpisodes = async () => {
      throw new Error("disk full");
    };
    await expect(check(created.id)).rejects.toThrow("disk full");
    expect(await h.series.get(created.id)).toMatchObject({
      remoteMarker: "m1",
      lastCheckedAt: null,
    });

    h.deps.series.upsertEpisodes = upsert;
    expect(await check(created.id)).toMatchObject({ changed: true, added: 1 });
    expect((await h.series.get(created.id))?.remoteMarker).toBe("m2");
  });

  it("turns a site that is down into a retryable error, from the marker and from the extract", async () => {
    const created = await addFake();
    site.failMarker = networkError();
    await expect(check(created.id)).rejects.toBeInstanceOf(RetryableError);
    site.failMarker = null;
    site.marker = "m2";
    site.failExtract = networkError();
    await expect(check(created.id)).rejects.toBeInstanceOf(RetryableError);
    expect((await h.series.get(created.id))?.remoteMarker).toBe("m1");
  });

  it("makes a series that is gone from the site permanent", async () => {
    const created = await addFake();
    site.failMarker = new ExtractorError("not-found", "gone");
    await expect(check(created.id)).rejects.toBeInstanceOf(PermanentError);
  });

  it("makes an extractor that was removed permanent", async () => {
    const created = await addFake();
    h.deps.extractors = { list: () => [], find: () => null };
    await expect(check(created.id)).rejects.toBeInstanceOf(PermanentError);
  });

  it("ignores a series that was deleted meanwhile", async () => {
    await expect(check("nope")).resolves.toMatchObject({ changed: false });
  });
});
