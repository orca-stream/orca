import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { NOTIFICATION_RETENTION_MS } from "../src/application/notifications.ts";
import { Scheduler } from "../src/application/scheduler.ts";
import { ExtractorError } from "@orca/extractor-core";
import { createHarness, type Harness } from "./harness.ts";
import { FakeExtractor, FAKE_URL } from "./fakes/extractor.ts";
import { aSeries, aSource } from "./helpers.ts";

let h: Harness;
beforeEach(async () => {
  h = await createHarness();
  // These tests look at queued jobs: keep the real queue from picking them up.
  h.deps.queue = { notify: () => {} };
});
afterEach(() => h.cleanup());

const HOUR = 3_600_000;

async function seed({
  externalId,
  ...overrides
}: Parameters<typeof aSeries>[0] & { externalId?: string }) {
  const series = aSeries({ createdAt: h.clock.now(), ...overrides });
  await h.series.create(
    series,
    aSource({ id: series.id, seriesId: series.id, externalId: externalId ?? series.id }),
    [],
  );
  return series;
}

const checkJobs = async () =>
  (await h.jobs.list({ status: ["queued", "running"], limit: 50 })).items.filter(
    (job) => job.kind === "check_series",
  );

describe("findDueSeries", () => {
  it("returns followed series never checked, and those whose interval ran out", async () => {
    const now = h.clock.now();
    await seed({ id: "never", folderName: "a", externalId: "a", follow: true });
    await seed({
      id: "due",
      folderName: "b",
      externalId: "b",
      follow: true,
      checkIntervalHours: 12,
      lastCheckedAt: now - 12 * HOUR,
    });
    await seed({
      id: "fresh",
      folderName: "c",
      externalId: "c",
      follow: true,
      checkIntervalHours: 12,
      lastCheckedAt: now - 12 * HOUR + 1,
    });
    const due = await h.series.findDueSeries(now);
    expect(due.map((series) => series.id).sort()).toEqual(["due", "never"]);
  });

  it("never returns a series that is not followed", async () => {
    await seed({ id: "x", follow: false, lastCheckedAt: null });
    expect(await h.series.findDueSeries(h.clock.now())).toEqual([]);
  });
});

describe("Scheduler", () => {
  it("queues one check_series job per due series, with the check:{id} dedupe key", async () => {
    await seed({ id: "s1", follow: true });
    const scheduler = new Scheduler(h.deps);
    expect(await scheduler.tick()).toBe(1);
    const [job] = await checkJobs();
    expect(job).toMatchObject({
      kind: "check_series",
      seriesId: "s1",
      dedupeKey: "check:s1",
      resource: "none",
      payload: { seriesId: "s1" },
    });
  });

  it("queues a single job when two ticks come in a row", async () => {
    await seed({ id: "s1", follow: true });
    const scheduler = new Scheduler(h.deps);
    await scheduler.tick();
    expect(await scheduler.tick()).toBe(0);
    expect(await checkJobs()).toHaveLength(1);
  });

  it("does nothing for series that are not due", async () => {
    await seed({ id: "s1", follow: true, lastCheckedAt: h.clock.now() });
    expect(await new Scheduler(h.deps).tick()).toBe(0);
  });

  it("ticks once when it starts and then on every interval, until stopped", async () => {
    await seed({ id: "s1", follow: true });
    const scheduler = new Scheduler(h.deps);
    const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
    scheduler.start({
      everyMs: 300_000,
      every: (fn, ms) => {
        const timer = { fn, ms, cancelled: false };
        timers.push(timer);
        return () => void (timer.cancelled = true);
      },
    });
    await scheduler.idle();
    expect(timers.map((timer) => timer.ms)).toEqual([300_000]);
    expect(await checkJobs()).toHaveLength(1);

    await h.jobs.cancelQueued((await checkJobs())[0]!.id);
    timers[0]!.fn();
    await scheduler.idle();
    expect(await checkJobs()).toHaveLength(1);

    await scheduler.stop();
    expect(timers[0]!.cancelled).toBe(true);
  });

  it("waits for a tick that is in flight when it is stopped, so the database can close after it", async () => {
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => (finish = resolve));
    const findDue = h.deps.series.findDueSeries.bind(h.deps.series);
    h.deps.series.findDueSeries = async (now) => {
      await slow;
      return findDue(now);
    };
    const scheduler = new Scheduler(h.deps);
    scheduler.start({ everyMs: 300_000, every: () => () => {} });
    let stopped = false;
    const stopping = scheduler.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);
    finish();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("removes notifications older than the retention on each tick, and keeps the recent ones", async () => {
    await h.deps.notifications.newEpisodes({ id: null, title: "Old" }, [{ season: 1, episode: 1 }]);
    h.clock.advance(NOTIFICATION_RETENTION_MS - 1000);
    await h.deps.notifications.newEpisodes({ id: null, title: "Recent" }, [
      { season: 1, episode: 2 },
    ]);
    h.clock.advance(2000);
    await new Scheduler(h.deps).tick();
    expect((await h.notifications.list(10)).map((n) => n.data.seriesTitle)).toEqual(["Recent"]);
  });

  it("wakes the queue when it queued something, and not when it did not", async () => {
    let notified = 0;
    h.deps.queue = { notify: () => void notified++ };
    const scheduler = new Scheduler(h.deps);
    await scheduler.tick();
    expect(notified).toBe(0);
    await seed({ id: "s1", follow: true });
    await scheduler.tick();
    expect(notified).toBe(1);
  });
});

describe("the scheduler and the queue together", () => {
  let site: FakeExtractor;
  beforeEach(async () => {
    await h.cleanup();
    site = new FakeExtractor();
    h = await createHarness({ extractors: [site] });
  });

  async function addFollowed() {
    const preview = await h.useCases.previewSeries(FAKE_URL);
    return h.useCases.addSeries({
      previewId: preview.previewId,
      title: "Fake Show",
      year: 1960,
      episodeKeys: preview.episodes.map((episode) => episode.key),
      follow: true,
      downloadNow: false,
    });
  }

  it("runs a due check as a job: a changed marker stores the new episode and downloads nothing", async () => {
    const created = await addFollowed();
    h.clock.advance(13 * HOUR);
    site.marker = "m2";
    site.episodes = [
      ...site.episodes,
      { ...site.episodes[0]!, episode: 3, sourceRef: "show/e3.mp4" },
    ];
    await new Scheduler(h.deps).tick();
    await h.queue.settle();
    const checks = (await h.jobs.list({ status: ["done"], limit: 50 })).items.filter(
      (job) => job.kind === "check_series",
    );
    expect(checks).toHaveLength(1);
    expect((await h.series.listEpisodes(created.id)).map((e) => e.status)).toEqual([
      "missing",
      "missing",
      "missing",
    ]);
  });

  it("stamps last_checked_at when a check fails for good, so the next tick does not repeat it", async () => {
    const created = await addFollowed();
    h.clock.advance(13 * HOUR);
    site.failMarker = new ExtractorError("not-found", "gone");
    const scheduler = new Scheduler(h.deps);
    await scheduler.tick();
    await h.queue.settle();
    const failed = (await h.jobs.list({ status: ["failed"], limit: 50 })).items;
    expect(failed.map((job) => job.kind)).toEqual(["check_series"]);
    expect((await h.series.get(created.id))?.lastCheckedAt).toBe(h.clock.now());
    expect(await scheduler.tick()).toBe(0);
  });

  it("stamps last_checked_at even when the failure notification itself blows up", async () => {
    const created = await addFollowed();
    h.clock.advance(13 * HOUR);
    site.failMarker = new ExtractorError("not-found", "gone");
    h.deps.notifications.jobFailed = async () => {
      throw new Error("notifications table is locked");
    };
    await new Scheduler(h.deps).tick();
    await h.queue.settle();
    expect((await h.series.get(created.id))?.lastCheckedAt).toBe(h.clock.now());
  });

  it("stamps last_checked_at for a check that was cancelled, so it is not queued again at once", async () => {
    const created = await addFollowed();
    h.clock.advance(13 * HOUR);
    const scheduler = new Scheduler(h.deps);
    h.deps.queue = { notify: () => {} };
    await scheduler.tick();
    const [job] = (await h.jobs.list({ status: ["queued"], limit: 5 })).items;
    await h.queue.cancel(job!.id);
    expect((await h.series.get(created.id))?.lastCheckedAt).toBe(h.clock.now());
    expect(await scheduler.tick()).toBe(0);
  });
});
