import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { PermanentError } from "../src/domain/errors.ts";
import { GenericPageExtractor } from "../src/infrastructure/generic-page-extractor.ts";
import { FakeDownloader } from "./fakes/ports.ts";
import { createHarness, type Harness } from "./harness.ts";
import { testGuard } from "./helpers.ts";

const PAGE = "https://videos.example.com/watch/one";
const PAGE_TWO = "https://videos.example.com/watch/two";
const MASTER = "https://cdn.example.com/master.m3u8";

let h: Harness;
beforeEach(async () => {
  h = await createHarness({
    extractors: [new GenericPageExtractor({ guard: testGuard() })],
    limits: { browser: 2, ffmpeg: 1, download: 2 },
  });
});
afterEach(() => h.cleanup());

async function addPage(url: string, title: string, downloadNow = true) {
  const preview = await h.useCases.previewSeries(url, undefined, "generic");
  return h.useCases.addSeries({
    previewId: preview.previewId,
    title,
    year: 1950,
    episodeKeys: [url],
    follow: false,
    downloadNow,
    licenseAck: true,
  });
}

const jobsOf = async (status: ("queued" | "running" | "done" | "failed")[]) =>
  (await h.jobs.list({ status, limit: 50 })).items.filter((job) => job.kind === "download_episode");

const until = async (condition: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition never became true");
};

describe("a page source", () => {
  it("is detected in a browser job, which hands the stream to a download job of its own resource", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: { Referer: PAGE } }];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    h.downloader.once(async (source, destPath, context) => {
      await gate;
      await FakeDownloader.writeFile(source, destPath, context);
    });
    await addPage(PAGE, "One");
    await until(() => h.downloader.calls.length === 1);

    const done = await jobsOf(["done"]);
    const running = await jobsOf(["running"]);
    expect(done.map((job) => job.resource)).toEqual(["browser"]);
    expect(running.map((job) => job.resource)).toEqual(["ffmpeg"]);
    expect(running[0]?.payload).toMatchObject({
      resolved: { kind: "hls", url: MASTER, headers: { Referer: PAGE } },
    });
    release();
    await h.queue.settle();
    const [episode] = await h.series.listEpisodes((await h.series.list())[0]!.id);
    expect(episode?.status).toBe("available");
    // The page itself stays the episode's source, to be detected again next time.
    expect(episode?.source).toEqual({ kind: "page", url: PAGE });
  });

  it("does not let downloads of several pages outrun the ffmpeg limit", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.downloader.once(async (source, dest, context) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await FakeDownloader.writeFile(source, dest, context);
    });
    h.downloader.once(async (source, dest, context) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      await FakeDownloader.writeFile(source, dest, context);
    });
    await addPage(PAGE, "One");
    await addPage(PAGE_TWO, "Two");
    await h.queue.settle();
    expect(h.detector.calls).toHaveLength(2);
    expect(h.downloader.calls).toHaveLength(2);
    expect(h.downloader.peak).toBe(1);
  });

  it("takes the first stream the detector ranks, whatever its kind", async () => {
    h.detector.streams = [
      { url: "https://cdn.example.com/manifest.mpd", kind: "dash", headers: {} },
      { url: "https://cdn.example.com/v720.m3u8", kind: "hls", headers: {} },
      { url: "https://cdn.example.com/clip.mp4", kind: "direct", headers: {} },
    ];
    await addPage(PAGE, "One");
    await h.queue.settle();
    expect(h.downloader.calls[0]?.source).toMatchObject({
      kind: "hls",
      url: "https://cdn.example.com/manifest.mpd",
    });
  });

  it("goes with a direct file when that is what the detector ranked first", async () => {
    h.detector.streams = [
      { url: "https://cdn.example.com/clip.mp4", kind: "direct", headers: {} },
      { url: MASTER, kind: "hls", headers: {} },
    ];
    await addPage(PAGE, "One");
    await h.queue.settle();
    expect(h.downloader.calls[0]?.source.kind).toBe("direct");
  });

  it("carries the detected Referer and Cookie to a direct download", async () => {
    h.detector.streams = [
      {
        url: "https://cdn.example.com/clip.mp4",
        kind: "direct",
        headers: { Referer: PAGE, Cookie: "sid=1" },
      },
    ];
    await addPage(PAGE, "One");
    await h.queue.settle();
    expect(h.downloader.calls[0]?.source).toEqual({
      kind: "direct",
      url: "https://cdn.example.com/clip.mp4",
      fileName: "clip.mp4",
      headers: { Referer: PAGE, Cookie: "sid=1" },
    });
  });

  it("is refused, for good, when the detected stream points inside the network", async () => {
    h.detector.streams = [
      { url: "http://inside.example.com/master.m3u8", kind: "hls", headers: {} },
    ];
    await addPage(PAGE, "One");
    await h.queue.settle();
    expect(h.downloader.calls).toEqual([]);
    const failed = await jobsOf(["failed"]);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ errorKind: "permanent" });
    expect(failed[0]?.lastError).toMatch(/private or internal/);
    expect(await jobsOf(["queued"])).toEqual([]);
  });

  it("is refused too when the detector names a stream that is not http at all", async () => {
    h.detector.streams = [{ url: "file:///etc/passwd", kind: "direct", headers: {} }];
    await addPage(PAGE, "One");
    await h.queue.settle();
    expect(h.downloader.calls).toEqual([]);
    expect((await jobsOf(["failed"]))[0]?.errorKind).toBe("permanent");
  });

  it("opens the page again when a download job is retried by hand, not the stream it froze", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.downloader.once(async () => {
      throw new PermanentError("ffmpeg is not installed");
    });
    await addPage(PAGE, "One");
    await h.queue.settle();
    const [failed] = await jobsOf(["failed"]);
    expect(failed?.resource).toBe("ffmpeg");
    const retried = await h.useCases.retryJob(failed!.id);
    expect(retried.id).not.toBe(failed!.id);
    await h.queue.settle();
    expect(h.detector.calls).toHaveLength(2);
    expect(h.downloader.calls).toHaveLength(2);
  });

  const refused = () => new PermanentError("Stream refused: Server returned 403 Forbidden", {});

  it("finds the stream again, once, when the one it found is refused with a 4xx", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.downloader.once(async () => {
      throw refused();
    });
    const created = await addPage(PAGE, "One");
    await h.queue.settle();
    // The second try opened the page again and got a fresh stream.
    expect(h.detector.calls).toHaveLength(2);
    expect(h.downloader.calls).toHaveLength(2);
    const [episode] = await h.series.listEpisodes(created.id);
    expect(episode?.status).toBe("available");
  });

  it("does not keep finding it again: a second 4xx is the end of it", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.downloader.once(async () => {
      throw refused();
    });
    h.downloader.once(async () => {
      throw refused();
    });
    const created = await addPage(PAGE, "One");
    await h.queue.settle();
    expect(h.detector.calls).toHaveLength(2);
    expect(h.downloader.calls).toHaveLength(2);
    const [episode] = await h.series.listEpisodes(created.id);
    expect(episode?.status).toBe("failed");
    expect(await jobsOf(["queued"])).toEqual([]);
  });

  it("does not look again for a failure that is not the stream's fault", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.downloader.once(async () => {
      throw new PermanentError("ffmpeg is not installed");
    });
    await addPage(PAGE, "One");
    await h.queue.settle();
    expect(h.detector.calls).toHaveLength(1);
  });

  it("starts from the page again when the episode is queued anew", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.downloader.once(async () => {
      throw new PermanentError("the stream expired");
    });
    const created = await addPage(PAGE, "One");
    await h.queue.settle();
    const [episode] = await h.series.listEpisodes(created.id);
    await h.useCases.enqueue([episode!.id]);
    await h.queue.settle();
    expect(h.detector.calls).toHaveLength(2);
  });

  it("does not queue a second download for an episode whose handoff job is waiting", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.deps.queue = { notify: () => {} };
    const created = await addPage(PAGE, "One");
    const [episode] = await h.series.listEpisodes(created.id);
    // Run only the detection: the handoff job (dlr:) is queued, ffmpeg slot not yet taken.
    await h.queue.pump();
    await until(async () =>
      (await jobsOf(["queued"])).some((j) => j.dedupeKey === `dlr:${episode!.id}`),
    );
    const [handoff] = await jobsOf(["queued"]);

    const jobs = await h.useCases.enqueue([episode!.id]);

    expect(jobs.map((job) => job.id)).toEqual([handoff!.id]);
    expect(await jobsOf(["queued"])).toHaveLength(1);
    await h.queue.settle();
  });

  it("leaves the status alone when the handoff job already existed", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.deps.queue = { notify: () => {} };
    const created = await addPage(PAGE, "One", false);
    const [episode] = await h.series.listEpisodes(created.id);
    h.downloader.once(FakeDownloader.hangUntilAborted);
    await h.jobs.enqueue({
      kind: "download_episode",
      payload: { episodeId: episode!.id, resolved: { kind: "hls", url: MASTER } },
      seriesId: created.id,
      episodeId: episode!.id,
      resource: "ffmpeg",
      dedupeKey: `dlr:${episode!.id}`,
    });
    await h.jobs.enqueue({
      kind: "download_episode",
      payload: { episodeId: episode!.id },
      seriesId: created.id,
      episodeId: episode!.id,
      resource: "browser",
    });
    await h.queue.pump();
    await until(async () => (await jobsOf(["done"])).length === 1);
    expect((await h.series.getEpisode(episode!.id))?.status).toBe("downloading");
    await h.queue.stop();
  });
});
