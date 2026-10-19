import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createCheckSeries } from "../src/application/check-series.ts";
import { ExtractorError } from "@orca/extractor-core";
import { createApp } from "../src/infrastructure/web/app.ts";
import { LoginRateLimiter } from "../src/infrastructure/web/rate-limit.ts";
import { addBevhill, createHarness, type Harness } from "./harness.ts";
import { FakeExtractor, FAKE_URL, fakeEpisode, networkError } from "./fakes/extractor.ts";

let h: Harness;
let site: FakeExtractor;

beforeEach(async () => {
  site = new FakeExtractor();
  h = await createHarness({ extractors: [site] });
});
afterEach(() => h.cleanup());

async function addFake(follow = true) {
  const preview = await h.useCases.previewSeries(FAKE_URL);
  return h.useCases.addSeries({
    previewId: preview.previewId,
    title: "Fake Show",
    year: 1960,
    episodeKeys: preview.episodes.map((episode) => episode.key),
    follow,
    downloadNow: false,
    licenseAck: true,
  });
}

const stored = () => h.notifications.list(50);
const kinds = async () => (await stored()).map((n) => n.kind);

describe("NotificationService and the panel notifier", () => {
  it("stores the notification, sends one SSE event and hands it to the other channels", async () => {
    const created = await addFake();
    await h.deps.notifications.newEpisodes({ id: created.id, title: "Fake Show" }, [
      { season: 1, episode: 3 },
      { season: 1, episode: 4 },
    ]);
    const [row] = await stored();
    expect(row).toMatchObject({
      kind: "new_episodes",
      seriesId: created.id,
      jobId: null,
      readAt: null,
      createdAt: h.clock.now(),
      data: { seriesTitle: "Fake Show", count: 2, codes: "S01E03, S01E04" },
    });
    expect(row?.title).toBe("New episodes");
    expect(row?.body).toBe("Fake Show: 2 new episodes (S01E03, S01E04)");
    expect(h.extraNotifier.sent).toEqual([row]);
    const published = h.events.filter((event) => event.type === "notification.created");
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ notification: { id: row?.id, kind: "new_episodes" } });
  });

  it("never lets a failing extra channel stop the panel's", async () => {
    h.extraNotifier.fail = true;
    await h.deps.notifications.newEpisodes({ id: null, title: "Show" }, [
      { season: 1, episode: 1 },
    ]);
    expect(await kinds()).toEqual(["new_episodes"]);
  });
});

describe("new_episodes", () => {
  it("is one notification per check, not one per episode", async () => {
    h.deps.queue = { notify: () => {} };
    const created = await addFake();
    site.marker = "m2";
    site.episodes = [...site.episodes, fakeEpisode(3), fakeEpisode(4)];
    await createCheckSeries(h.deps)(created.id);
    expect(await kinds()).toEqual(["new_episodes"]);
    expect((await stored())[0]?.data).toMatchObject({ count: 2 });
  });

  it("is not sent when nothing new was found", async () => {
    h.deps.queue = { notify: () => {} };
    const created = await addFake();
    const check = createCheckSeries(h.deps);
    await check(created.id);
    site.marker = "m2"; // read again, but the same episodes
    await check(created.id);
    expect(await stored()).toEqual([]);
  });
});

describe("job_failed", () => {
  it("is sent when a job fails for good, and not for a try that will be repeated", async () => {
    h.deps.queue = { notify: () => {} };
    const created = await addFake();
    h.clock.advance(13 * 3_600_000);
    site.failMarker = networkError();
    await h.useCases.checkSeriesNow(created.id);
    await h.queue.settle();
    // Requeued with backoff: not a failure yet.
    expect(await stored()).toEqual([]);

    site.failMarker = new ExtractorError("not-found", "The series is gone");
    h.clock.advance(7 * 3_600_000);
    await h.queue.settle();
    const [row] = await stored();
    expect(row).toMatchObject({
      kind: "job_failed",
      seriesId: created.id,
      data: { seriesTitle: "Fake Show", jobKind: "check_series", error: "The series is gone" },
    });
    expect(row?.jobId).toBeTruthy();
  });

  it("is sent once the retries run out", async () => {
    h.deps.queue = { notify: () => {} };
    const created = await addFake();
    site.failMarker = networkError();
    const job = await h.useCases.checkSeriesNow(created.id);
    for (let attempt = 0; attempt < 5; attempt++) {
      h.clock.advance(7 * 3_600_000);
      await h.queue.settle();
    }
    expect((await h.jobs.get(job.id))?.status).toBe("failed");
    expect(await kinds()).toEqual(["job_failed"]);
  });

  it("is not sent for a cancelled job", async () => {
    h.deps.queue = { notify: () => {} };
    const created = await addFake();
    const job = await h.useCases.checkSeriesNow(created.id);
    await h.queue.cancel(job.id);
    expect(await stored()).toEqual([]);
  });
});

describe("series_downloaded", () => {
  it("is one notification when the whole batch is available, not one per episode", async () => {
    const { series } = await addBevhill(h, { downloadNow: true });
    await h.queue.settle();
    const downloaded = (await stored()).filter((n) => n.kind === "series_downloaded");
    expect(downloaded).toHaveLength(1);
    expect(downloaded[0]).toMatchObject({
      seriesId: series.id,
      data: { seriesTitle: "The Beverly Hillbillies", available: 6, total: 6 },
    });
  });

  it("is sent again for a later batch", async () => {
    h.deps.queue = { notify: () => {} };
    const { series } = await addBevhill(h, { downloadNow: false });
    const episodes = await h.series.listEpisodes(series.id);
    await h.useCases.enqueue([episodes[0]!.id]);
    await h.queue.settle();
    h.clock.advance(60_000);
    await h.useCases.enqueue([episodes[1]!.id]);
    await h.queue.settle();
    expect((await kinds()).filter((kind) => kind === "series_downloaded")).toHaveLength(2);
  });
});

describe("the API", () => {
  let app: ReturnType<typeof createApp>;
  let cookie: string;
  beforeEach(async () => {
    app = createApp({
      useCases: h.useCases,
      events: h.bus,
      secureCookies: false,
      sessionTtlMs: 1000 * 3600,
      loginLimiter: new LoginRateLimiter({ now: () => h.clock.now() }),
    });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "sam", password: "secret" }),
    });
    cookie = login.headers.get("set-cookie")!.split(";")[0]!;
  });
  const authed = (init: RequestInit = {}) => ({
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as object), cookie },
  });

  async function seedThree() {
    for (const n of [1, 2, 3]) {
      h.clock.advance(1000);
      await h.deps.notifications.newEpisodes({ id: null, title: `Show ${n}` }, [
        { season: 1, episode: n },
      ]);
    }
  }

  it("lists the newest first with the unread count", async () => {
    await seedThree();
    const res = await app.request("/api/notifications", authed());
    const body = (await res.json()) as {
      items: { data: { seriesTitle: string } }[];
      unreadCount: number;
    };
    expect(res.status).toBe(200);
    expect(body.unreadCount).toBe(3);
    expect(body.items.map((n) => n.data.seriesTitle)).toEqual(["Show 3", "Show 2", "Show 1"]);
  });

  it("marks the given ones read, then all of them", async () => {
    await seedThree();
    const [first] = (await stored()).toReversed();
    const one = await app.request(
      "/api/notifications/read",
      authed({ method: "POST", body: JSON.stringify({ ids: [first!.id] }) }),
    );
    expect(await one.json()).toEqual({ unreadCount: 2 });
    const all = await app.request(
      "/api/notifications/read",
      authed({ method: "POST", body: "{}" }),
    );
    expect(await all.json()).toEqual({ unreadCount: 0 });
    expect((await stored()).every((n) => n.readAt === h.clock.now())).toBe(true);
  });

  it("answers 400 to a body that is not JSON or not the right shape", async () => {
    const send = (body: string) =>
      app.request("/api/notifications/read", authed({ method: "POST", body }));
    for (const bad of ["{not json", "[]", '{"ids":"a"}', '{"ids":[]}', '{"ids":[1]}']) {
      const res = await send(bad);
      expect(res.status, bad).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_request" });
    }
    const tooMany = await send(
      JSON.stringify({ ids: Array.from({ length: 501 }, (_, i) => `n${i}`) }),
    );
    expect(tooMany.status).toBe(400);
    expect((await send("")).status).toBe(200);
  });

  it("needs a session", async () => {
    expect((await app.request("/api/notifications")).status).toBe(401);
    expect((await app.request("/api/notifications/read", { method: "POST" })).status).toBe(401);
  });
});
