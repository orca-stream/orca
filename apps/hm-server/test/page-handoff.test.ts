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

  it("keeps the resolved stream when its download job is retried, without opening the page again", async () => {
    h.detector.streams = [{ url: MASTER, kind: "hls", headers: {} }];
    h.downloader.once(async () => {
      throw new PermanentError("the stream was refused");
    });
    await addPage(PAGE, "One");
    await h.queue.settle();
    const [failed] = await jobsOf(["failed"]);
    expect(failed?.resource).toBe("ffmpeg");
    await h.useCases.retryJob(failed!.id);
    await h.queue.settle();
    expect(h.detector.calls).toHaveLength(1);
    expect(h.downloader.calls).toHaveLength(2);
    expect(h.downloader.calls[1]?.source).toMatchObject({ url: MASTER });
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
});
