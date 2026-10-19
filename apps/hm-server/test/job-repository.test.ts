import { describe, expect, it } from "vite-plus/test";
import { aSeries, anEpisode, testDatabase } from "./helpers.ts";

const job = (extra = {}) => ({
  kind: "download_episode" as const,
  payload: {},
  resource: "download" as const,
  ...extra,
});

describe("DrizzleJobRepository", () => {
  it("counts the queued and running episode downloads of each series", async () => {
    const { jobs, series } = testDatabase();
    await series.create(aSeries({ id: "a" }), []);
    await series.create(aSeries({ id: "b", externalId: "b", folderName: "B" }), []);
    const forSeries = (seriesId: string, extra = {}) => job({ seriesId, ...extra });
    const first = await jobs.enqueue(forSeries("a"));
    await jobs.enqueue(forSeries("a"));
    await jobs.enqueue(forSeries("a"));
    await jobs.enqueue(forSeries("b"));
    // Other kinds of work for the series aren't downloads.
    await jobs.enqueue(forSeries("b", { kind: "check_series", resource: "none" }));
    await jobs.enqueue(job()); // and a job without a series belongs to none

    // Queued and running both count.
    expect(await jobs.claim("download", "w", 1000)).toMatchObject({ id: first.job.id });
    let counts = await jobs.countActiveDownloads();
    expect([...counts.entries()].sort()).toEqual([
      ["a", 3],
      ["b", 1],
    ]);

    // Settled ones don't.
    await jobs.complete(first.job.id, "w");
    counts = await jobs.countActiveDownloads();
    expect(counts.get("a")).toBe(2);
    expect(counts.has("nope")).toBe(false);
  });

  it("claims by priority, then oldest first, only jobs that are due and of the asked resource", async () => {
    const { jobs, clock } = testDatabase();
    const first = await jobs.enqueue(job());
    clock.advance(10);
    const second = await jobs.enqueue(job());
    clock.advance(10);
    const urgent = await jobs.enqueue(job({ priority: 5 }));
    const later = await jobs.enqueue(job({ runAfter: clock.now() + 60_000 }));
    const ffmpeg = await jobs.enqueue(job({ resource: "ffmpeg" }));

    const order = [];
    for (let i = 0; i < 5; i++) order.push((await jobs.claim("download", "w1", 30_000))?.id);
    expect(order).toEqual([urgent.job.id, first.job.id, second.job.id, undefined, undefined]);
    expect((await jobs.claim("ffmpeg", "w1", 30_000))?.id).toBe(ffmpeg.job.id);

    clock.advance(60_000);
    expect((await jobs.claim("download", "w1", 30_000))?.id).toBe(later.job.id);
  });

  it("marks a claimed job running with a lease and counts the attempt", async () => {
    const { jobs, clock } = testDatabase();
    await jobs.enqueue(job({ payload: { episodeId: "e1" } }));
    const claimed = await jobs.claim("download", "worker-a", 30_000);
    expect(claimed).toMatchObject({
      status: "running",
      attempts: 1,
      leaseOwner: "worker-a",
      leaseExpiresAt: clock.now() + 30_000,
      startedAt: clock.now(),
      payload: { episodeId: "e1" },
    });
  });

  it("refuses a second active job with the same dedupe key and hands back the first", async () => {
    const { jobs } = testDatabase();
    const first = await jobs.enqueue(job({ dedupeKey: "dl:e1" }));
    const second = await jobs.enqueue(job({ dedupeKey: "dl:e1" }));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);

    // Still deduped while running.
    await jobs.claim("download", "w", 1000);
    expect((await jobs.enqueue(job({ dedupeKey: "dl:e1" }))).created).toBe(false);

    // Free again once it is over.
    await jobs.complete(first.job.id, "w");
    expect((await jobs.enqueue(job({ dedupeKey: "dl:e1" }))).created).toBe(true);
  });

  it("puts jobs a crash left running back in the queue without charging the attempt", async () => {
    const { jobs } = testDatabase();
    const { job: queued } = await jobs.enqueue(job());
    await jobs.claim("download", "old-process", 30_000);
    expect(await jobs.recoverRunning()).toBe(1);
    const again = await jobs.get(queued.id);
    expect(again).toMatchObject({ status: "queued", attempts: 0, leaseOwner: null });
  });

  it("recovers only leases that expired", async () => {
    const { jobs, clock } = testDatabase();
    await jobs.enqueue(job());
    await jobs.enqueue(job());
    const a = await jobs.claim("download", "w", 10_000);
    const b = await jobs.claim("download", "w", 60_000);
    clock.advance(20_000);
    expect(await jobs.recoverExpired([])).toBe(1);
    expect((await jobs.get(a!.id))?.status).toBe("queued");
    expect((await jobs.get(b!.id))?.status).toBe("running");
  });

  it("heartbeat extends the lease of the owner only", async () => {
    const { jobs, clock } = testDatabase();
    await jobs.enqueue(job());
    const claimed = await jobs.claim("download", "w", 10_000);
    clock.advance(5_000);
    await jobs.heartbeat(claimed!.id, "intruder", 10_000);
    expect((await jobs.get(claimed!.id))?.leaseExpiresAt).toBe(claimed!.leaseExpiresAt);
    await jobs.heartbeat(claimed!.id, "w", 10_000);
    expect((await jobs.get(claimed!.id))?.leaseExpiresAt).toBe(clock.now() + 10_000);
  });

  it("requeues for a later try, keeping the error", async () => {
    const { jobs, clock } = testDatabase();
    await jobs.enqueue(job());
    const claimed = await jobs.claim("download", "w", 1000);
    const requeued = await jobs.requeue(claimed!.id, "w", clock.now() + 30_000, "boom");
    expect(requeued).toMatchObject({
      status: "queued",
      lastError: "boom",
      errorKind: "retryable",
      attempts: 1,
    });
    expect(await jobs.claim("download", "w", 1000)).toBeNull();
    clock.advance(30_000);
    expect((await jobs.claim("download", "w", 1000))?.attempts).toBe(2);
  });

  it("retry resets a failed or cancelled job, and leaves the others alone", async () => {
    const { jobs, clock } = testDatabase();
    const { job: failed } = await jobs.enqueue(job());
    await jobs.claim("download", "w", 1000);
    await jobs.fail(failed.id, "w", "nope", "permanent");
    clock.advance(1000);
    const retried = await jobs.retry(failed.id);
    expect(retried).toMatchObject({
      status: "queued",
      attempts: 0,
      lastError: null,
      runAfter: clock.now(),
    });

    expect(await jobs.retry(failed.id)).toBeNull();
  });

  it("postpones only queued jobs (the refresh debounce)", async () => {
    const { jobs, clock } = testDatabase();
    const { job: queued } = await jobs.enqueue(job({ runAfter: clock.now() + 1000 }));
    await jobs.postpone(queued.id, clock.now() + 9000);
    expect((await jobs.get(queued.id))?.runAfter).toBe(clock.now() + 9000);
  });

  it("only settles a job its worker still owns, and never a job that moved on", async () => {
    const { jobs, clock } = testDatabase();
    const { job: queued } = await jobs.enqueue(job());
    // Not running yet: nothing to complete, fail or requeue.
    expect(await jobs.complete(queued.id, "w")).toBeNull();
    expect(await jobs.fail(queued.id, "w", "x", "permanent")).toBeNull();
    expect(await jobs.requeue(queued.id, "w", clock.now(), "x")).toBeNull();

    await jobs.claim("download", "w", 1000);
    // Another worker's lease, or a job already cancelled, can't be settled by the wrong owner.
    expect(await jobs.complete(queued.id, "intruder")).toBeNull();
    expect((await jobs.get(queued.id))?.status).toBe("running");
    expect(await jobs.cancelRunning(queued.id, "w")).toMatchObject({ status: "cancelled" });
    expect(await jobs.complete(queued.id, "w")).toBeNull();
    expect((await jobs.get(queued.id))?.status).toBe("cancelled");
  });

  it("cancels a queued job only while it is still queued", async () => {
    const { jobs } = testDatabase();
    const { job: first } = await jobs.enqueue(job());
    const { job: second } = await jobs.enqueue(job());
    await jobs.claim("download", "w", 1000); // takes `first`
    expect(await jobs.cancelQueued(first.id)).toBeNull();
    expect((await jobs.get(first.id))?.status).toBe("running");
    expect(await jobs.cancelQueued(second.id)).toMatchObject({ status: "cancelled" });
    expect(await jobs.cancelQueued(second.id)).toBeNull();
  });

  it("recovers an expired lease unless the job is still running in this process", async () => {
    const { jobs, clock } = testDatabase();
    await jobs.enqueue(job());
    await jobs.enqueue(job());
    const a = await jobs.claim("download", "w", 1000);
    const b = await jobs.claim("download", "w", 1000);
    clock.advance(5000);
    expect(await jobs.recoverExpired([a!.id])).toBe(1);
    expect((await jobs.get(a!.id))?.status).toBe("running");
    expect((await jobs.get(b!.id))?.status).toBe("queued");
  });

  it("lists newest first, filtered by status, with a cursor", async () => {
    const { jobs, clock } = testDatabase();
    const ids = [];
    for (let i = 0; i < 5; i++) {
      clock.advance(1);
      ids.push((await jobs.enqueue(job())).job.id);
    }
    await jobs.claim("download", "w", 1000);
    const page1 = await jobs.list({ limit: 2 });
    expect(page1.items.map((j) => j.id)).toEqual([ids[4], ids[3]]);
    const page2 = await jobs.list({ limit: 2, cursor: page1.nextCursor! });
    expect(page2.items.map((j) => j.id)).toEqual([ids[2], ids[1]]);
    const page3 = await jobs.list({ limit: 2, cursor: page2.nextCursor! });
    expect(page3).toMatchObject({ items: [{ id: ids[0] }], nextCursor: null });
    const running = await jobs.list({ limit: 10, status: ["running"] });
    expect(running.items).toHaveLength(1);
  });

  it("keeps a job whose episode is deleted (foreign key set null)", async () => {
    const { jobs, series, database } = testDatabase();
    await series.create(aSeries(), [anEpisode()]);
    const { job: j } = await jobs.enqueue(job({ seriesId: "series-1", episodeId: "episode-1-1" }));
    database.sqlite.prepare("delete from series where id = 'series-1'").run();
    expect(await jobs.get(j.id)).toMatchObject({ seriesId: null, episodeId: null });
  });
});

describe("DrizzleSeriesRepository", () => {
  it("stores a series with its episodes and counts the available ones", async () => {
    const { series } = testDatabase();
    await series.create(aSeries(), [anEpisode({ episode: 1 }), anEpisode({ episode: 2 })]);
    await series.setEpisodeStatus("episode-1-1", "available", "Show/Season 01/Show S01E01.mp4");
    const [listed] = await series.list();
    expect(listed).toMatchObject({ id: "series-1", episodeCount: 2, availableCount: 1 });
    const episodes = await series.listEpisodes("series-1");
    expect(episodes.map((e) => [e.episode, e.status, e.filePath])).toEqual([
      [1, "available", "Show/Season 01/Show S01E01.mp4"],
      [2, "missing", null],
    ]);
    expect(episodes[0]?.source).toMatchObject({ kind: "direct" });
  });

  it("rolls the series back when an episode is rejected", async () => {
    const { series } = testDatabase();
    const dup = anEpisode({ id: "other", sourceRef: "bevhill/x.mp4" });
    await expect(series.create(aSeries(), [anEpisode(), dup])).rejects.toThrow();
    expect(await series.get("series-1")).toBeNull();
  });

  it("finds a series by its external id and its folder, and updates it", async () => {
    const { series } = testDatabase();
    await series.create(aSeries(), []);
    expect((await series.findByExternal("internet-archive", "bevhill"))?.id).toBe("series-1");
    expect((await series.findByFolder("The Beverly Hillbillies (1962)"))?.id).toBe("series-1");
    expect(await series.update("series-1", { year: null, follow: true })).toMatchObject({
      year: null,
      follow: true,
    });
  });
});
