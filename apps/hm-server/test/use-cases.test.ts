import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AppError, PermanentError, RetryableError } from "../src/domain/errors.ts";
import { addBevhill, BEVHILL, BEVHILL_URL, createHarness, type Harness } from "./harness.ts";
import { FakeDownloader } from "./fakes/ports.ts";
import { createEnqueueRefresh } from "../src/application/downloads.ts";

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
});
afterEach(() => h.cleanup());

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error as AppError,
  );
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("previewSeries", () => {
  it("runs the extractor, returns the preview and persists nothing", async () => {
    const preview = await h.useCases.previewSeries(BEVHILL_URL);
    expect(preview.extractorId).toBe("internet-archive");
    expect(preview.previewId).toBeTruthy();
    expect(preview.episodes).toHaveLength(6);
    expect(preview.episodes[0]).toMatchObject({
      season: 1,
      episode: 1,
      key: `${BEVHILL}/s01e01-The-Clampetts-Strike-Oil.mp4`,
    });
    expect(preview.warnings.map((w) => w.kind)).toEqual(["gap", "year"]);
    expect(preview.license).toMatchObject({ kind: "public-domain", requiresAck: true });
    expect(await h.series.list()).toEqual([]);
  });

  it("says no extractor handles an address from another site", async () => {
    const error = await fails(h.useCases.previewSeries("https://example.com/show"));
    expect(error).toMatchObject({ code: "bad_request" });
  });
});

describe("addSeries", () => {
  it("stores the series and its episodes, writes the folder and tvshow.nfo, and fetches the poster", async () => {
    const { series } = await addBevhill(h);
    expect(series).toMatchObject({
      title: "The Beverly Hillbillies",
      year: 1962,
      episodeCount: 6,
      availableCount: 0,
      hasPoster: true,
    });
    const folder = join(h.root, "The Beverly Hillbillies (1962)");
    expect(await readFile(join(folder, "tvshow.nfo"), "utf8")).toContain(
      "<title>The Beverly Hillbillies</title>",
    );
    expect([...(await readFile(join(folder, "poster.jpg")))]).toEqual([1, 2, 3]);
    expect(h.images.requested).toEqual([`https://archive.org/services/img/${BEVHILL}`]);
    const episodes = await h.useCases.listEpisodes(series.id);
    expect(episodes.every((e) => e.status === "missing")).toBe(true);
    expect(h.events.some((e) => e.type === "series.updated")).toBe(true);
  });

  it("leaves nothing behind when the library can't be written, so the user can try again", async () => {
    const real = h.library.writeSeries.bind(h.library);
    h.library.writeSeries = async () => {
      throw new Error("EACCES: permission denied");
    };
    await expect(addBevhill(h)).rejects.toThrow(/EACCES/);
    expect(await h.series.list()).toEqual([]);

    h.library.writeSeries = real;
    await expect(addBevhill(h)).resolves.toMatchObject({ series: { episodeCount: 6 } });
  });

  it("removes the folder it made when saving the series fails", async () => {
    h.deps.series.create = async () => {
      throw new Error("SQLITE_FULL");
    };
    await expect(addBevhill(h)).rejects.toThrow(/SQLITE_FULL/);
    expect(await exists(join(h.root, "The Beverly Hillbillies (1962)"))).toBe(false);
  });

  it("keeps the first series' files when the same one is submitted twice at once", async () => {
    const preview = await h.useCases.previewSeries(BEVHILL_URL);
    const body = {
      previewId: preview.previewId,
      title: "The Beverly Hillbillies",
      year: 1962,
      episodeKeys: preview.episodes.map((episode) => episode.key),
      follow: false,
      downloadNow: false,
      licenseAck: true,
    };
    const results = await Promise.allSettled([
      h.useCases.addSeries(body),
      h.useCases.addSeries(body),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const folder = join(h.root, "The Beverly Hillbillies (1962)");
    expect(await exists(join(folder, "tvshow.nfo"))).toBe(true);
    expect(await h.series.list()).toHaveLength(1);
  });

  it("answers a conflict, not a crash, when the same series is submitted at once under two titles", async () => {
    const preview = await h.useCases.previewSeries(BEVHILL_URL);
    const body = (title: string) => ({
      previewId: preview.previewId,
      title,
      year: 1962,
      episodeKeys: preview.episodes.map((episode) => episode.key),
      follow: false,
      downloadNow: false,
      licenseAck: true,
    });
    const results = await Promise.allSettled([
      h.useCases.addSeries(body("Show A")),
      h.useCases.addSeries(body("Show B")),
    ]);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      name: "AppError",
      code: "conflict",
    });
    expect(await h.series.list()).toHaveLength(1);
  });

  it("does not remove files from a folder that was already there when saving fails", async () => {
    const folder = join(h.root, "The Beverly Hillbillies (1962)");
    await mkdir(folder);
    await writeFile(join(folder, "poster.jpg"), "someone else's");
    h.deps.series.create = async () => {
      throw new Error("SQLITE_FULL");
    };
    await expect(addBevhill(h)).rejects.toThrow(/SQLITE_FULL/);
    expect(await readFile(join(folder, "poster.jpg"), "utf8")).toBe("someone else's");
  });

  it("still adds the series when the poster can't be fetched", async () => {
    h.images.fail = true;
    const { series } = await addBevhill(h);
    expect(series.hasPoster).toBe(false);
  });

  it("requires the license confirmation when the license or the year can't vouch for it", async () => {
    const preview = await h.useCases.previewSeries(BEVHILL_URL);
    const body = {
      previewId: preview.previewId,
      title: "T",
      episodeKeys: [preview.episodes[0]!.key],
      follow: false,
      downloadNow: false,
    };
    expect(
      await fails(h.useCases.addSeries({ ...body, year: null, licenseAck: false })),
    ).toMatchObject({ code: "license_ack_required" });
    expect(
      await fails(h.useCases.addSeries({ ...body, year: 1982, licenseAck: false })),
    ).toMatchObject({ code: "license_ack_required" });
    // An old show with a public domain mark goes through unconfirmed.
    await expect(
      h.useCases.addSeries({ ...body, year: 1962, licenseAck: false }),
    ).resolves.toMatchObject({ year: 1962 });
  });

  it("adds only the chosen episodes and refuses keys that aren't in the preview", async () => {
    const preview = await h.useCases.previewSeries(BEVHILL_URL);
    const base = {
      previewId: preview.previewId,
      title: "T",
      year: 1962,
      follow: false,
      downloadNow: false,
      licenseAck: true,
    };
    expect(await fails(h.useCases.addSeries({ ...base, episodeKeys: ["nope"] }))).toMatchObject({
      code: "bad_request",
    });
    const series = await h.useCases.addSeries({
      ...base,
      episodeKeys: preview.episodes.slice(0, 2).map((e) => e.key),
    });
    expect(series.episodeCount).toBe(2);
  });

  it("gone when the preview is unknown, conflict when it was already added or the folder is taken", async () => {
    const base = {
      title: "T",
      year: 1962 as number | null,
      episodeKeys: ["x"],
      follow: false,
      downloadNow: false,
      licenseAck: true,
    };
    expect(await fails(h.useCases.addSeries({ ...base, previewId: "unknown" }))).toMatchObject({
      code: "gone",
    });

    await addBevhill(h);
    expect(await fails(addBevhill(h, { title: "Other" }))).toMatchObject({ code: "conflict" });
  });

  it("patching the title rewrites the nfo and keeps the folder", async () => {
    const { series } = await addBevhill(h);
    const patched = await h.useCases.patchSeries(series.id, {
      title: "Hillbillies",
      year: null,
      follow: true,
    });
    expect(patched).toMatchObject({ title: "Hillbillies", year: null, follow: true });
    const nfo = await readFile(
      join(h.root, "The Beverly Hillbillies (1962)", "tvshow.nfo"),
      "utf8",
    );
    expect(nfo).toContain("<title>Hillbillies</title>");
    expect(nfo).not.toContain("<year>");
  });
});

describe("downloadingCount", () => {
  it("counts a series' queued and running downloads, in the list and in the detail", async () => {
    const { series } = await addBevhill(h);
    expect(series.downloadingCount).toBe(0);
    expect((await h.useCases.getSeries(series.id)).downloadingCount).toBe(0);

    await h.useCases.downloadSeries(series.id);
    expect((await h.useCases.getSeries(series.id)).downloadingCount).toBe(6);
    expect((await h.useCases.listSeries()).map((s) => s.downloadingCount)).toEqual([6]);

    await h.queue.settle();
    expect((await h.useCases.getSeries(series.id)).downloadingCount).toBe(0);
    expect((await h.useCases.listSeries())[0]?.downloadingCount).toBe(0);
  });

  it("is already counted in the answer to adding a series with downloadNow", async () => {
    const { series } = await addBevhill(h, { downloadNow: true });
    expect(series.downloadingCount).toBe(6);
    await h.queue.settle();
  });
});

describe("downloading (the end-to-end pipeline)", () => {
  it("IA URL -> preview -> add -> jobs run -> files written -> one debounced Jellyfin refresh", async () => {
    const { series } = await addBevhill(h, { downloadNow: true });
    let episodes = await h.useCases.listEpisodes(series.id);
    expect(episodes.every((e) => e.status === "queued")).toBe(true);

    await h.queue.settle();

    episodes = await h.useCases.listEpisodes(series.id);
    expect(episodes.map((e) => e.status)).toEqual(Array(6).fill("available"));
    const season1 = await readdir(join(h.root, "The Beverly Hillbillies (1962)", "Season 01"));
    expect(season1.sort()).toEqual(
      [1, 2, 18, 20, 21]
        .flatMap((n) => [
          `The Beverly Hillbillies S01E${String(n).padStart(2, "0")}.mp4`,
          `The Beverly Hillbillies S01E${String(n).padStart(2, "0")}.nfo`,
        ])
        .sort(),
    );
    expect(await readdir(join(h.root, "The Beverly Hillbillies (1962)", "Season 02"))).toHaveLength(
      2,
    );
    expect(
      await readFile(
        join(
          h.root,
          "The Beverly Hillbillies (1962)",
          "Season 01",
          "The Beverly Hillbillies S01E02.nfo",
        ),
        "utf8",
      ),
    ).toContain("<title>Getting Settled</title>");
    expect(await readdir(join(h.root, ".hm-staging"))).toEqual([]);

    // Six episodes, one refresh, and not before the debounce has passed.
    expect(h.mediaServer.updated).toEqual([]);
    const queuedRefresh = (await h.jobs.list({ limit: 50, status: ["queued"] })).items;
    expect(queuedRefresh.map((j) => j.kind)).toEqual(["refresh_library"]);
    h.clock.advance(60_000);
    await h.queue.settle();
    expect(h.mediaServer.updated).toEqual([join(h.root, "The Beverly Hillbillies (1962)")]);

    const done = await h.useCases.listJobs({ limit: 50, status: ["done"] });
    expect(done.items).toHaveLength(7);
    expect(done.items.find((j) => j.kind === "download_episode")).toMatchObject({
      seriesTitle: "The Beverly Hillbillies",
    });
    expect(done.items.find((j) => j.episodeCode === "S01E02")).toBeTruthy();
    expect(h.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["job.updated", "job.progress", "series.updated"]),
    );
  });

  it("downloads from the episode's source URL into staging first", async () => {
    const { series } = await addBevhill(h);
    const [first] = await h.useCases.listEpisodes(series.id);
    await h.useCases.enqueue([first!.id]);
    await h.queue.settle();
    expect(h.downloader.calls[0]?.source).toMatchObject({
      kind: "direct",
      url: `https://archive.org/download/${BEVHILL}/s01e01-The-Clampetts-Strike-Oil.mp4`,
    });
    expect(h.downloader.calls[0]?.destPath).toContain(".hm-staging");
  });

  it("enqueueing twice makes one job, and skips episodes already in the library", async () => {
    const { series } = await addBevhill(h);
    const episodes = await h.useCases.listEpisodes(series.id);
    const ids = episodes.slice(0, 2).map((e) => e.id);
    const first = await h.useCases.enqueue(ids);
    const second = await h.useCases.enqueue(ids);
    expect(second.map((j) => j.id)).toEqual(first.map((j) => j.id));
    await h.queue.settle();
    expect(h.downloader.calls).toHaveLength(2);
    expect(await h.useCases.enqueue(ids)).toEqual([]);
  });

  it("refuses unknown episode ids", async () => {
    expect(await fails(h.useCases.enqueue(["nope"]))).toMatchObject({ code: "not_found" });
  });

  it("retries a retryable failure after the backoff and finishes the episode", async () => {
    const { series } = await addBevhill(h);
    const [first] = await h.useCases.listEpisodes(series.id);
    h.downloader.once(async () => {
      throw new RetryableError("503 from archive.org");
    });
    const [job] = await h.useCases.enqueue([first!.id]);
    await h.queue.settle();

    expect(await h.jobs.get(job!.id)).toMatchObject({
      status: "queued",
      attempts: 1,
      lastError: "503 from archive.org",
    });
    expect((await h.useCases.listEpisodes(series.id))[0]?.status).toBe("queued");

    h.clock.advance(30_000);
    await h.queue.settle();
    expect((await h.useCases.listEpisodes(series.id))[0]?.status).toBe("available");
    expect((await h.jobs.get(job!.id))?.attempts).toBe(2);
  });

  it("marks the episode failed on a permanent error, and retry puts it through again", async () => {
    const { series } = await addBevhill(h);
    const [first] = await h.useCases.listEpisodes(series.id);
    h.downloader.once(async () => {
      throw new PermanentError("404");
    });
    const [job] = await h.useCases.enqueue([first!.id]);
    await h.queue.settle();
    expect((await h.useCases.listEpisodes(series.id))[0]?.status).toBe("failed");
    expect(await h.jobs.get(job!.id)).toMatchObject({ status: "failed", errorKind: "permanent" });

    const retried = await h.useCases.retryJob(job!.id);
    expect(retried).toMatchObject({ status: "queued", attempts: 0 });
    await h.queue.settle();
    expect((await h.useCases.listEpisodes(series.id))[0]?.status).toBe("available");

    expect(await fails(h.useCases.retryJob(job!.id))).toMatchObject({ code: "conflict" });
    expect(await fails(h.useCases.retryJob("nope"))).toMatchObject({ code: "not_found" });
  });

  it("cancels a running download, drops its staged file and leaves the episode missing", async () => {
    const { series } = await addBevhill(h);
    const [first] = await h.useCases.listEpisodes(series.id);
    h.downloader.once(async (source, dest, context) => {
      await FakeDownloader.writeFile(source, dest, context);
      await FakeDownloader.hangUntilAborted(source, dest, context);
    });
    const [job] = await h.useCases.enqueue([first!.id]);
    await h.queue.pump();
    await new Promise((r) => setTimeout(r, 10));
    expect((await h.jobs.get(job!.id))?.status).toBe("running");

    const cancelled = await h.useCases.cancelJob(job!.id);
    expect(cancelled.status).toBe("cancelled");
    expect((await h.useCases.listEpisodes(series.id))[0]?.status).toBe("missing");
    expect(await exists(h.downloader.calls[0]!.destPath)).toBe(false);
  });

  it("cancels a queued job before it runs", async () => {
    const { series } = await addBevhill(h);
    const [first] = await h.useCases.listEpisodes(series.id);
    const { job } = await h.jobs.enqueue({
      kind: "download_episode",
      payload: { episodeId: first!.id },
      seriesId: series.id,
      episodeId: first!.id,
      resource: "download",
      runAfter: h.clock.now() + 3_600_000,
    });
    expect((await h.useCases.cancelJob(job.id)).status).toBe("cancelled");
    await h.queue.settle();
    expect(h.downloader.calls).toHaveLength(0);
    expect(await fails(h.useCases.cancelJob("nope"))).toMatchObject({ code: "not_found" });
  });

  it("never runs more downloads than the download limit", async () => {
    await h.cleanup();
    h = await createHarness({ limits: { download: 2 } });
    const { series } = await addBevhill(h);
    for (let i = 0; i < 6; i++) {
      h.downloader.once(async (source, dest, context) => {
        await new Promise((r) => setTimeout(r, 15));
        await FakeDownloader.writeFile(source, dest, context);
      });
    }
    await h.useCases.downloadSeries(series.id);
    await h.queue.settle();
    expect(h.downloader.peak).toBe(2);
    expect(h.downloader.calls).toHaveLength(6);
  });

  it("keeps postponing the refresh while episodes keep landing", async () => {
    const { series } = await addBevhill(h);
    const [a, b] = await h.useCases.listEpisodes(series.id);
    await h.useCases.enqueue([a!.id]);
    await h.queue.settle();
    h.clock.advance(40_000);
    await h.useCases.enqueue([b!.id]);
    await h.queue.settle();
    h.clock.advance(40_000); // 80 s after the first episode, but only 40 s after the second
    await h.queue.settle();
    expect(h.mediaServer.updated).toEqual([]);
    h.clock.advance(20_000);
    await h.queue.settle();
    expect(h.mediaServer.updated).toHaveLength(1);
  });

  it("asks for one follow-up refresh, however many episodes land while a refresh runs", async () => {
    const { series } = await addBevhill(h);
    const enqueueRefresh = createEnqueueRefresh(h.deps);
    await enqueueRefresh(series.id);
    h.clock.advance(60_000);
    await h.jobs.claim("none", "w", 60_000); // the first refresh is running now
    for (let i = 0; i < 5; i++) await enqueueRefresh(series.id);
    const queued = (await h.jobs.list({ limit: 20, status: ["queued"] })).items;
    expect(queued.map((j) => j.dedupeKey)).toEqual([`refresh-next:${series.id}`]);
  });

  it("retries a failed Jellyfin refresh instead of losing it", async () => {
    const { series } = await addBevhill(h);
    const [a] = await h.useCases.listEpisodes(series.id);
    h.mediaServer.fail = new RetryableError("Jellyfin is down");
    await h.useCases.enqueue([a!.id]);
    await h.queue.settle();
    h.clock.advance(60_000);
    await h.queue.settle();
    expect((await h.jobs.list({ limit: 10, status: ["queued"] })).items[0]).toMatchObject({
      kind: "refresh_library",
      attempts: 1,
    });
    h.mediaServer.fail = null;
    h.clock.advance(30_000);
    await h.queue.settle();
    expect(h.mediaServer.updated).toHaveLength(1);
  });

  it("finds the stream of a page source with the detector", async () => {
    const { series } = await addBevhill(h);
    const [first] = await h.useCases.listEpisodes(series.id);
    h.database.sqlite
      .prepare("update episodes set source = ? where id = ?")
      .run(JSON.stringify({ kind: "page", url: "https://site.example/watch/1" }), first!.id);
    h.detector.streams = [
      {
        url: "https://cdn.example/1.m3u8",
        kind: "hls",
        headers: { Referer: "https://site.example/" },
      },
    ];
    await h.useCases.enqueue([first!.id]);
    await h.queue.settle();
    expect(h.downloader.calls[0]?.source).toEqual({
      kind: "hls",
      url: "https://cdn.example/1.m3u8",
      headers: { Referer: "https://site.example/" },
    });
    expect(h.downloader.calls[0]?.destPath).toMatch(/\.mkv$/);
  });

  it("fails a page source for good when there's no detector yet", async () => {
    h.deps.detector = null;
    const { series } = await addBevhill(h);
    const [first] = await h.useCases.listEpisodes(series.id);
    h.database.sqlite
      .prepare("update episodes set source = ? where id = ?")
      .run(JSON.stringify({ kind: "page", url: "https://site.example/1" }), first!.id);
    const [job] = await h.useCases.enqueue([first!.id]);
    await h.queue.settle();
    expect(await h.jobs.get(job!.id)).toMatchObject({ status: "failed", errorKind: "permanent" });
  });
});

describe("sessions", () => {
  it("logs in with an administrator's Jellyfin account and resolves the session", async () => {
    const { sessionId, me } = await h.useCases.login("sam", "secret");
    expect(me).toEqual({ userId: "id-sam", userName: "sam" });
    expect(sessionId.length).toBeGreaterThanOrEqual(43);
    expect(await h.useCases.resolveSession(sessionId)).toEqual(me);
    await h.useCases.logout(sessionId);
    expect(await h.useCases.resolveSession(sessionId)).toBeNull();
  });

  it("stores only a hash of the session id, so a leaked database can't be replayed", async () => {
    const { sessionId } = await h.useCases.login("sam", "secret");
    const rows = h.database.sqlite.prepare("select id from sessions").all() as { id: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).not.toBe(sessionId);
    expect(rows[0]?.id).toBe(createHash("sha256").update(sessionId).digest("hex"));
    expect(await h.useCases.resolveSession(rows[0]!.id)).toBeNull();
  });

  it("refuses wrong credentials and unknown sessions", async () => {
    expect(await fails(h.useCases.login("sam", "nope"))).toMatchObject({ code: "unauthorized" });
    expect(await h.useCases.resolveSession("garbage")).toBeNull();
  });

  it("expires after the TTL", async () => {
    const { sessionId } = await h.useCases.login("sam", "secret");
    h.clock.advance(7 * 24 * 3600 * 1000 + 1);
    expect(await h.useCases.resolveSession(sessionId)).toBeNull();
  });

  it("re-checks the administrator once an hour and drops a demoted one", async () => {
    const { sessionId } = await h.useCases.login("sam", "secret");
    h.clock.advance(30 * 60 * 1000);
    await h.useCases.resolveSession(sessionId);
    expect(h.authenticator.checks).toBe(0);
    h.clock.advance(31 * 60 * 1000);
    expect(await h.useCases.resolveSession(sessionId)).not.toBeNull();
    expect(h.authenticator.checks).toBe(1);
    h.authenticator.demoted.add("id-sam");
    h.clock.advance(61 * 60 * 1000);
    expect(await h.useCases.resolveSession(sessionId)).toBeNull();
  });

  it("asks Jellyfin once when several requests of one session arrive together", async () => {
    const { sessionId } = await h.useCases.login("sam", "secret");
    h.clock.advance(2 * 3600 * 1000);
    await Promise.all(Array.from({ length: 5 }, () => h.useCases.resolveSession(sessionId)));
    expect(h.authenticator.checks).toBe(1);
  });

  it("keeps the session when Jellyfin can't be asked", async () => {
    const { sessionId } = await h.useCases.login("sam", "secret");
    h.authenticator.down = true;
    h.clock.advance(2 * 3600 * 1000);
    expect(await h.useCases.resolveSession(sessionId)).not.toBeNull();
  });
});
