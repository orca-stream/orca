import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  });
}

/** The one source a series added from the fake site has. */
const firstSource = async (seriesId: string) => (await h.series.listSources([seriesId]))[0]!;
const patchSource = async (
  seriesId: string,
  patch: Parameters<Harness["series"]["updateSource"]>[1],
) => h.series.updateSource((await firstSource(seriesId)).id, patch);

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
      [1, 3, "missing"],
    ]);
    expect(await h.series.get(created.id)).toMatchObject({ lastCheckedAt: h.clock.now() });
    expect(await firstSource(created.id)).toMatchObject({ remoteMarker: "m2" });
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

  it("stores the new episodes of a followed series without queueing them: downloads are asked for", async () => {
    const followed = await addFake({ follow: true });
    site.marker = "m2";
    site.episodes = [...site.episodes, fakeEpisode(3)];
    await check(followed.id);
    expect(await downloadJobs()).toEqual([]);
    const third = (await h.series.listEpisodes(followed.id)).find((e) => e.episode === 3);
    expect(third).toMatchObject({ status: "missing" });
  });

  it("takes a new episode whose video is already in its folder as available: no download, no notice", async () => {
    const followed = await addFake({ follow: true });
    const season = join(h.root, "Fake Show (1960)", "Season 01");
    await mkdir(season, { recursive: true });
    await writeFile(join(season, "Fake Show S01E03.mp4"), "video");
    site.marker = "m2";
    site.episodes = [...site.episodes, fakeEpisode(3)];

    await check(followed.id);

    const third = (await h.series.listEpisodes(followed.id)).find((e) => e.episode === 3);
    expect(third).toMatchObject({
      status: "available",
      filePath: "Fake Show (1960)/Season 01/Fake Show S01E03.mp4",
    });
    expect(await downloadJobs()).toHaveLength(0);
    expect(h.extraNotifier.sent.filter((n) => n.kind === "new_episodes")).toHaveLength(0);
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

  it("treats a series from before known_refs as 'everything listed now is known': nothing is added, nothing forced", async () => {
    const created = await addFake({ only: ["show/e1.mp4"], follow: false });
    // A row as migration 0002 left it: the column is NULL, and the marker is an older kind.
    await patchSource(created.id, { knownRefs: null, remoteMarker: "old-form" });
    site.marker = "m2";
    site.episodes = [fakeEpisode(1), fakeEpisode(2), fakeEpisode(3)];

    const result = await check(created.id);

    expect(result).toMatchObject({ changed: true, added: 0, skipped: 0 });
    expect((await h.series.listEpisodes(created.id)).map((e) => e.sourceRef)).toEqual([
      "show/e1.mp4",
    ]);
    const stored = await firstSource(created.id);
    expect(stored.remoteMarker).toBe("m2");
    expect(stored.knownRefs).toEqual(["show/e1.mp4", "show/e2.mp4", "show/e3.mp4"]);

    // The person is told what happened, since nothing new was downloaded.
    const learned = (await h.notifications.list(10)).filter((n) => n.kind === "episodes_learned");
    expect(learned).toHaveLength(1);
    expect(learned[0]).toMatchObject({
      seriesId: created.id,
      data: { seriesTitle: "Fake Show", count: 2 },
    });

    // From here on it behaves like any other series: only what is truly new is added.
    site.marker = "m3";
    site.episodes = [...site.episodes, fakeEpisode(4)];
    expect(await check(created.id)).toMatchObject({ added: 1 });
    expect((await h.series.listEpisodes(created.id)).map((e) => e.sourceRef)).toEqual([
      "show/e1.mp4",
      "show/e4.mp4",
    ]);
  });

  it("says nothing when a legacy series has nothing it did not already have", async () => {
    const created = await addFake({ follow: false });
    await patchSource(created.id, { knownRefs: null, remoteMarker: "old-form" });
    site.marker = "m2";
    await check(created.id);
    expect((await h.notifications.list(10)).map((n) => n.kind)).toEqual([]);
  });

  it("keeps an empty known list apart from a missing one", async () => {
    const created = await addFake({ follow: false });
    await patchSource(created.id, { knownRefs: [] });
    expect((await firstSource(created.id)).knownRefs).toEqual([]);
    await patchSource(created.id, { knownRefs: null });
    expect((await firstSource(created.id)).knownRefs).toBeNull();
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
    // Not "known": once its number is free it is added, rather than lost for good.
    expect((await firstSource(created.id)).knownRefs).not.toContain("show/other.mp4");
    site.marker = "m3";
    site.episodes = [
      fakeEpisode(1),
      fakeEpisode(2),
      fakeEpisode(3, { sourceRef: "show/other.mp4" }),
    ];
    expect(await check(created.id)).toMatchObject({ added: 1, skipped: 0 });
  });

  it("tells the panel about episodes it could not add, once per check", async () => {
    const created = await addFake({ follow: false });
    site.marker = "m2";
    site.episodes = [
      fakeEpisode(1),
      fakeEpisode(2),
      fakeEpisode(2, { sourceRef: "show/other.mp4" }),
    ];
    await check(created.id);
    const rows = await h.notifications.list(10);
    expect(rows.map((n) => n.kind)).toEqual(["episodes_skipped"]);
    expect(rows[0]).toMatchObject({
      seriesId: created.id,
      data: { seriesTitle: "Fake Show", count: 1 },
    });
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
    expect(await h.series.get(created.id)).toMatchObject({ lastCheckedAt: null });
    expect(await firstSource(created.id)).toMatchObject({ remoteMarker: "m1" });

    h.deps.series.upsertEpisodes = upsert;
    expect(await check(created.id)).toMatchObject({ changed: true, added: 1 });
    expect((await firstSource(created.id)).remoteMarker).toBe("m2");
  });

  it("turns a site that is down into a retryable error, from the marker and from the extract", async () => {
    const created = await addFake();
    site.failMarker = networkError();
    await expect(check(created.id)).rejects.toBeInstanceOf(RetryableError);
    site.failMarker = null;
    site.marker = "m2";
    site.failExtract = networkError();
    await expect(check(created.id)).rejects.toBeInstanceOf(RetryableError);
    expect((await firstSource(created.id)).remoteMarker).toBe("m1");
  });

  it("passes the site's Retry-After on to the retry", async () => {
    const created = await addFake();
    site.failMarker = new ExtractorError("network", "slow down", { retryAfterMs: 90_000 });
    const error = (await check(created.id).catch((e: unknown) => e)) as RetryableError;
    expect(error).toBeInstanceOf(RetryableError);
    expect(error.retryAfterMs).toBe(90_000);
  });

  it("makes a series that is gone from the site permanent", async () => {
    const created = await addFake();
    site.failMarker = new ExtractorError("not-found", "gone");
    await expect(check(created.id)).rejects.toBeInstanceOf(PermanentError);
  });

  it("makes an extractor that was removed permanent", async () => {
    const created = await addFake();
    h.deps.extractors = { list: () => [], find: () => null, get: () => null };
    await expect(check(created.id)).rejects.toBeInstanceOf(PermanentError);
  });

  it("ignores a series that was deleted meanwhile", async () => {
    await expect(check("nope")).resolves.toMatchObject({ changed: false });
  });
});
