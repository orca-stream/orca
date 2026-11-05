import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createCheckSeries } from "../src/application/check-series.ts";
import { fileOutdated } from "../src/domain/series.ts";
import { addBevhill, createHarness, type Harness } from "./harness.ts";
import { FakeSite, seasonUrl } from "./fakes/site.ts";

let h: Harness;
let site: FakeSite;

beforeEach(async () => {
  site = new FakeSite();
  h = await createHarness({ extractors: [site.extractor] });
});
afterEach(() => h.cleanup());

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected it to fail");
    },
    (error: unknown) => error,
  );

/** Previews an address and adds every episode it lists, with the given extra fields. */
async function add(slug: string, extra: Record<string, unknown> = {}) {
  const preview = await h.useCases.previewSeries(seasonUrl(slug));
  return h.useCases.addSeries({
    previewId: preview.previewId,
    episodeKeys: preview.episodes.map((episode) => episode.key),
    ...extra,
  });
}

/** Adds `slug` to the series choosing only its episode `number` (one the series doesn't have). */
async function addWithOnly(seriesId: string, slug: string, number: number) {
  const preview = await h.useCases.previewSeries(seasonUrl(slug));
  await h.useCases.addSeries({
    previewId: preview.previewId,
    seriesId,
    episodeKeys: [preview.episodes.find((e) => e.episode === number)!.key],
  });
  return (await h.useCases.getSeries(seriesId)).sources;
}

describe("changing the source of episodes", () => {
  it("takes the video from the new source, keeping the number, the status and the file", async () => {
    site.season("a", "Show", range(1, 3)).season("b", "Show", [1, 7]);
    const series = await add("a", { title: "Show" });
    const before = await h.series.listEpisodes(series.id);
    const one = before[0]!;
    await h.series.setEpisodeStatus(one.id, "available", "Show/Season 01/Show S01E01.mp4");
    const [a, b] = await addWithOnly(series.id, "b", 7);
    // Read again when the source changes: by now it lists episode 2 too.
    site.season("b", "Show", [1, 2, 7]);

    const result = await h.useCases.switchSource(series.id, {
      sourceId: b!.id,
      episodeIds: before.map((e) => e.id),
    });

    expect(result).toEqual({ switched: 2, notListed: ["S01E03"], busy: [] });
    const after = await h.series.listEpisodes(series.id);
    const byNumber = new Map(after.map((e) => [e.episode, e]));
    expect(byNumber.get(1)).toMatchObject({
      id: one.id,
      sourceId: b!.id,
      status: "available",
      filePath: "Show/Season 01/Show S01E01.mp4",
      // Its file is the first source's still.
      fileSourceId: a!.id,
    });
    expect(byNumber.get(1)!.source).toMatchObject({ url: expect.stringContaining("/anime/b/") });
    // Not downloaded: it only takes its video from there from now on.
    expect(byNumber.get(2)).toMatchObject({
      sourceId: b!.id,
      status: "missing",
      fileSourceId: null,
    });
    expect(byNumber.get(3)).toMatchObject({ sourceId: a!.id });
    expect(await h.jobs.activeDownloadJobs(after.map((e) => e.id))).toEqual([]);
    const dto = (await h.useCases.listEpisodes(series.id)).find((e) => e.id === one.id);
    expect(dto?.fileOutdated).toBe(true);

    // Back to the source its file came from: the file is that source's again.
    await h.useCases.switchSource(series.id, { sourceId: a!.id, episodeIds: [one.id] });
    const back = await h.series.getEpisode(one.id);
    expect(back).toMatchObject({ sourceId: a!.id, fileSourceId: null });
    expect(fileOutdated(back!)).toBe(false);
  });

  it("leaves an episode being downloaded alone, and settles what failed on the old source", async () => {
    site.season("a", "Show", range(1, 2)).season("b", "Show", [1, 2, 9]);
    const series = await add("a", { title: "Show" });
    const [, b] = await addWithOnly(series.id, "b", 9);
    const [first, second] = await h.series.listEpisodes(series.id);
    h.deps.queue = { notify: () => {} };
    await h.useCases.enqueue([first!.id]);
    const { job: failed } = await h.jobs.enqueue({
      kind: "download_episode",
      payload: { episodeId: second!.id },
      seriesId: series.id,
      episodeId: second!.id,
      resource: "browser",
      dedupeKey: "dl:failed",
    });
    await h.jobs.claim("browser", "w", 1000);
    await h.jobs.fail(failed.id, "w", "every player failed", "permanent");
    await h.series.setEpisodeStatus(second!.id, "failed");

    const result = await h.useCases.switchSource(series.id, {
      sourceId: b!.id,
      episodeIds: [first!.id, second!.id],
    });

    expect(result).toEqual({ switched: 1, notListed: [], busy: ["S01E01"] });
    expect(await h.series.getEpisode(second!.id)).toMatchObject({
      sourceId: b!.id,
      status: "missing",
    });
    expect(await h.jobs.get(failed.id)).toBeNull();
  });

  it("refuses a source of another series, and episodes of another series", async () => {
    site.season("a", "Show", [1]).season("c", "Other", [1]);
    const one = await add("a", { title: "Show" });
    const other = await add("c", { title: "Other" });
    const [episode] = await h.series.listEpisodes(one.id);
    expect(
      await fails(
        h.useCases.switchSource(one.id, {
          sourceId: other.sources[0]!.id,
          episodeIds: [episode!.id],
        }),
      ),
    ).toMatchObject({ code: "not_found" });
    const [foreign] = await h.series.listEpisodes(other.id);
    expect(
      await fails(
        h.useCases.switchSource(one.id, {
          sourceId: one.sources[0]!.id,
          episodeIds: [foreign!.id],
        }),
      ),
    ).toMatchObject({ code: "not_found" });
  });
});

describe("downloading an episode whose source changed", () => {
  /** A downloaded bevhill episode whose file is said to come from another source. */
  async function outdated() {
    const { series } = await addBevhill(h);
    const [episode] = await h.useCases.listEpisodes(series.id);
    await h.useCases.enqueue([episode!.id]);
    await h.queue.settle();
    const downloaded = (await h.series.getEpisode(episode!.id))!;
    const video = join(h.root, downloaded.filePath!);
    // As H&M names subtitles next to the video: they belong to it.
    const subtitles = video.replace(/\.mp4$/, ".eng.srt");
    await writeFile(subtitles, "old subtitles");
    await h.series.setEpisodeStatus(downloaded.id, "available", downloaded.filePath, "elsewhere");
    return { series, episode: downloaded, video, subtitles };
  }

  it('is not downloaded by "download missing", but is when picked, replacing the old file', async () => {
    const { series, episode, video, subtitles } = await outdated();
    h.downloader.calls.length = 0;
    expect(await h.useCases.downloadSeries(series.id)).not.toContainEqual(
      expect.objectContaining({ episodeId: episode.id }),
    );

    const [job] = await h.useCases.enqueue([episode.id]);
    expect(job?.episodeId).toBe(episode.id);
    await h.queue.settle();

    const after = (await h.series.getEpisode(episode.id))!;
    expect(after).toMatchObject({ status: "available", fileSourceId: null });
    expect(await exists(join(h.root, after.filePath!))).toBe(true);
    expect(
      h.downloader.calls.filter((call) => call.source.url === episode.source.url),
    ).toHaveLength(1);
    expect(await exists(subtitles)).toBe(false);
    expect(video).toBe(join(h.root, after.filePath!));
  });

  it("keeps the old file, available, when the new download fails", async () => {
    const { episode, video } = await outdated();
    h.downloader.once(() => Promise.reject(new Error("the new source broke")));
    await h.useCases.enqueue([episode.id]);
    await h.queue.settle();
    // Retries go on: give up at once.
    const [active] = await h.jobs.activeDownloadJobs([episode.id]);
    if (active) await h.useCases.cancelJob(active.id);
    await h.queue.settle();

    const after = (await h.series.getEpisode(episode.id))!;
    expect(after).toMatchObject({ status: "available", fileSourceId: "elsewhere" });
    expect(await exists(video)).toBe(true);
  });
});

describe("a season's preferred source", () => {
  it("takes new episodes of that season only from it while it is open", async () => {
    site.season("a", "Show", [1]).season("b", "Show", [1, 9]);
    const series = await add("a", { title: "Show" });
    const [a, b] = await addWithOnly(series.id, "b", 9);
    // Adding `b` from episode 9 closed `a` as finished: still airing, it is opened again.
    await h.useCases.patchSource(series.id, a!.id, { closed: false });
    await h.useCases.patchSeries(series.id, { preferredSources: { "1": b!.id } });
    h.deps.queue = { notify: () => {} };

    // Both list episode 2 now; only `a` lists 3.
    site.season("a", "Show", [1, 2, 3]).season("b", "Show", [1, 2, 9]);
    await createCheckSeries(h.deps)(series.id);
    const owners = (await h.series.listEpisodes(series.id)).map((e) => [
      e.episode,
      e.sourceId === a!.id ? "a" : "b",
    ]);
    expect(owners).toEqual([
      [1, "a"],
      [2, "b"],
      [9, "b"],
    ]);

    // Closed, it brings nothing new: the season takes from the others again.
    await h.useCases.patchSource(series.id, b!.id, { closed: true });
    site.season("a", "Show", [1, 2, 3, 4]);
    await createCheckSeries(h.deps)(series.id);
    expect((await h.series.listEpisodes(series.id)).map((e) => e.episode)).toEqual([1, 2, 3, 4, 9]);
  });

  it("must be a source of the series", async () => {
    site.season("a", "Show", [1]).season("c", "Other", [1]);
    const one = await add("a", { title: "Show" });
    const other = await add("c", { title: "Other" });
    expect(
      await fails(
        h.useCases.patchSeries(one.id, { preferredSources: { "1": other.sources[0]!.id } }),
      ),
    ).toMatchObject({ code: "bad_request" });
    const kept = await h.useCases.patchSeries(one.id, {
      preferredSources: { "1": one.sources[0]!.id },
    });
    expect(kept.preferredSources).toEqual({ "1": one.sources[0]!.id });
  });
});
