import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { StreamDetectionError } from "@orca/stream-detector";
import { ExtractorError } from "@orca/extractor-core";
import { AbortedError, PermanentError, RetryableError } from "../src/domain/errors.ts";
import { GenericPageExtractor } from "../src/infrastructure/generic-page-extractor.ts";
import { PlaywrightDetectorAdapter } from "../src/infrastructure/playwright-detector-adapter.ts";
import { createHarness, type Harness } from "./harness.ts";

const PAGE = "https://videos.example.com/watch/my-first_video.html?autoplay=1";

describe("GenericPageExtractor", () => {
  const extractor = new GenericPageExtractor();

  it("never claims an address by itself: the user has to choose it", () => {
    expect(extractor.canHandle(PAGE)).toBe(false);
    expect(extractor.canHandle("https://archive.org/details/x")).toBe(false);
    expect(extractor).toMatchObject({ id: "generic", explicitOnly: true });
  });

  it("makes one episode of the page, found later by the browser, and always asks for the license ack", async () => {
    const result = await extractor.extract(PAGE);
    expect(result.series).toMatchObject({
      externalId: PAGE,
      sourceUrl: PAGE,
      title: "my first video",
    });
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0]).toMatchObject({
      season: 1,
      episode: 1,
      sourceRef: PAGE,
      media: { kind: "page", url: PAGE },
    });
    expect(result.license).toEqual({ kind: "unknown", requiresAck: true });
    expect(result.warnings.map((w) => w.code)).toContain("license-unknown");
    expect(result.series.remoteMarker).toBeUndefined();
  });

  it("names the series after the host when the path says nothing", async () => {
    expect((await extractor.extract("https://videos.example.com/")).series.title).toBe(
      "videos.example.com",
    );
  });

  it("refuses what is not a web page address", async () => {
    for (const bad of ["ftp://x.example/a", "file:///etc/passwd", "not a url", "javascript:1"]) {
      await expect(extractor.extract(bad)).rejects.toMatchObject({ code: "unsupported-url" });
      await expect(extractor.extract(bad)).rejects.toBeInstanceOf(ExtractorError);
    }
  });
});

describe("PlaywrightDetectorAdapter", () => {
  const abort = { signal: new AbortController().signal };
  const adapter = (detect: () => Promise<unknown>) => {
    let disposed = 0;
    const inner = { detect, dispose: async () => void disposed++ };
    return { adapter: new PlaywrightDetectorAdapter(inner as never), disposed: () => disposed };
  };

  it("hands the streams through", async () => {
    const streams = [{ url: "https://cdn/x.m3u8", kind: "hls", headers: { Referer: "r" } }];
    expect(await adapter(async () => streams).adapter.detect(PAGE, abort)).toEqual(streams);
  });

  it("turns a timeout or a page that would not open into a retryable error", async () => {
    for (const reason of ["timeout", "navigation"] as const) {
      const { adapter: a } = adapter(async () => {
        throw new StreamDetectionError(reason, "nope");
      });
      await expect(a.detect(PAGE, abort)).rejects.toBeInstanceOf(RetryableError);
    }
  });

  it("turns an abort into AbortedError", async () => {
    const { adapter: a } = adapter(async () => {
      throw new StreamDetectionError("aborted", "stop");
    });
    await expect(a.detect(PAGE, abort)).rejects.toBeInstanceOf(AbortedError);
  });

  it("makes anything else permanent, such as a missing Chromium", async () => {
    const { adapter: a } = adapter(async () => {
      throw new Error("Executable doesn't exist at /usr/bin/chromium");
    });
    const error = await a.detect(PAGE, abort).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentError);
    expect((error as Error).message).toContain("Executable doesn't exist");
  });

  it("closes the browser on dispose", async () => {
    const { adapter: a, disposed } = adapter(async () => []);
    await a.dispose();
    expect(disposed()).toBe(1);
  });
});

describe("choosing the generic extractor", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await createHarness({ extractors: [new GenericPageExtractor()] });
    h.deps.queue = { notify: () => {} };
  });
  afterEach(() => h.cleanup());

  const fails = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e: unknown) => e,
    );

  it("does not take an address on its own", async () => {
    expect(await fails(h.useCases.previewSeries(PAGE))).toMatchObject({ code: "bad_request" });
  });

  it("previews an address when the user picks it", async () => {
    const preview = await h.useCases.previewSeries(PAGE, undefined, "generic");
    expect(preview.extractorId).toBe("generic");
    expect(preview.episodes).toHaveLength(1);
    expect(preview.license).toMatchObject({ kind: "unknown", requiresAck: true });
    expect(preview.posterUrl).toBeNull();
  });

  it("rejects an extractor that does not exist", async () => {
    expect(await fails(h.useCases.previewSeries(PAGE, undefined, "nope"))).toMatchObject({
      code: "bad_request",
    });
  });

  it("lists it as explicit-only, and the others as not", () => {
    const list = h.useCases.listExtractors();
    expect(list.find((e) => e.id === "generic")).toMatchObject({ explicit: true, hosts: [] });
    expect(list.find((e) => e.id === "internet-archive")?.explicit).toBe(false);
  });

  it("is refused on the server without the license confirmation, whatever the panel did", async () => {
    const preview = await h.useCases.previewSeries(PAGE, undefined, "generic");
    const body = {
      previewId: preview.previewId,
      title: "Some video",
      year: 1950,
      episodeKeys: [PAGE],
      follow: false,
      downloadNow: false,
    };
    expect(await fails(h.useCases.addSeries({ ...body, licenseAck: false }))).toMatchObject({
      code: "license_ack_required",
    });
    const created = await h.useCases.addSeries({ ...body, licenseAck: true });
    const [episode] = await h.series.listEpisodes(created.id);
    expect(episode?.source).toEqual({ kind: "page", url: PAGE });
  });

  it("downloads through the detector: a page source becomes the stream found on it", async () => {
    h.detector.streams = [
      { url: "https://cdn.example/master.m3u8", kind: "hls", headers: { Referer: PAGE } },
    ];
    const preview = await h.useCases.previewSeries(PAGE, undefined, "generic");
    const created = await h.useCases.addSeries({
      previewId: preview.previewId,
      title: "Some video",
      year: 1950,
      episodeKeys: [PAGE],
      follow: false,
      downloadNow: true,
      licenseAck: true,
    });
    const [job] = (await h.jobs.list({ status: ["queued"], limit: 5 })).items;
    expect(job?.resource).toBe("browser");
    await h.queue.settle();
    expect(h.downloader.calls[0]?.source).toEqual({
      kind: "hls",
      url: "https://cdn.example/master.m3u8",
      headers: { Referer: PAGE },
    });
    expect((await h.series.listEpisodes(created.id))[0]?.status).toBe("available");
  });
});
