import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { PermanentError } from "../src/domain/errors.ts";
import type { Source } from "../src/domain/series.ts";
import { FakeDownloader } from "./fakes/ports.ts";
import { FakeSite, episodeUrl, seasonUrl } from "./fakes/site.ts";
import { createHarness, type Harness } from "./harness.ts";

const SLUG = "show";
const P1 = "player-one.test";
const P2 = "player-two.test";
const player = (host: string, n: number) => `https://${host}/e/${n}`;
/** Streams sit on a CDN the test guard resolves; the path says which player's host gave it. */
const streamOf = (host: string, n: number) => `https://cdn.example.com/${host}/${n}/master.m3u8`;

let h: Harness;
let site: FakeSite;

beforeEach(async () => {
  site = new FakeSite();
  h = await createHarness({ extractors: [site.extractor] });
});
afterEach(() => h.cleanup());

/** `count` episodes, each with a player on every host given, every player playing its own stream. */
function episodesOn(count: number, hosts: string[]) {
  site.season(
    SLUG,
    "Show",
    Array.from({ length: count }, (_, i) => i + 1),
  );
  for (let n = 1; n <= count; n++) {
    site.players(
      SLUG,
      n,
      hosts.map((host) => player(host, n)),
    );
    for (const host of hosts) {
      h.detector.byPage.set(player(host, n), [
        { url: streamOf(host, n), kind: "hls", headers: {} },
      ]);
    }
  }
}

async function addShow(downloadNow = true) {
  const preview = await h.useCases.previewSeries(seasonUrl(SLUG));
  return h.useCases.addSeries({
    previewId: preview.previewId,
    title: "Show",
    year: 2020,
    episodeKeys: preview.episodes.map((episode) => episode.key),
    downloadNow,
  });
}

const until = async (condition: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 400; i++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition never became true");
};

/** The player host a downloaded stream came from. */
const hostOf = (source: Source) => new URL((source as { url: string }).url).pathname.split("/")[1];

/** Downloads that wait until `release` is called, so a test can see what runs at the same time. */
function holdDownloads(count: number) {
  const releases: (() => void)[] = [];
  for (let i = 0; i < count; i++) {
    h.downloader.once(async (source, destPath, context) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      await FakeDownloader.writeFile(source, destPath, context);
    });
  }
  return () => {
    for (const release of releases.splice(0)) release();
  };
}

describe("an episode with several players", () => {
  it("reads its players only when it is downloaded, and opens one with the episode page as Referer", async () => {
    episodesOn(1, [P1]);
    await addShow(false);
    expect(site.requests).not.toContain(episodeUrl(SLUG, 1));

    const [episode] = await h.series.listEpisodes((await h.useCases.listSeries())[0]!.id);
    expect(episode?.source).toEqual({ kind: "mirrors", url: episodeUrl(SLUG, 1) });
    await h.useCases.enqueue([episode!.id]);
    await h.queue.settle();

    expect(h.detector.calls).toEqual([player(P1, 1)]);
    expect(h.detector.referers).toEqual([episodeUrl(SLUG, 1)]);
    expect(h.downloader.calls.map((call) => call.source)).toEqual([
      { kind: "hls", url: streamOf(P1, 1), headers: {} },
    ]);
    expect(await h.series.getEpisode(episode!.id)).toMatchObject({ status: "available" });
  });

  it("opens in an iframe the players the extractor says only play framed", async () => {
    await h.cleanup();
    const framing = {
      ...site.extractor,
      resolveMirrors: async (url: string, options?: { signal?: AbortSignal }) =>
        (await site.extractor.resolveMirrors!(url, options)).map((mirror) => ({
          ...mirror,
          framed: true,
        })),
    };
    h = await createHarness({ extractors: [framing] });
    episodesOn(1, [P1]);
    await addShow();
    await h.queue.settle();

    expect(h.detector.calls).toEqual([player(P1, 1)]);
    expect(h.detector.referers).toEqual([episodeUrl(SLUG, 1)]);
    expect(h.detector.framed).toEqual([true]);
  });

  it("downloads one at a time per player host, as many at once as there are hosts, taking turns", async () => {
    episodesOn(4, [P1, P2]);
    const release = holdDownloads(4);
    await addShow();

    await until(() => h.downloader.calls.length === 2);
    // Two hosts: two downloads at once, one on each, and the next two wait in their hosts' lanes.
    expect(h.downloader.peak).toBe(2);
    expect(h.downloader.calls.map((call) => hostOf(call.source)).sort()).toEqual([P1, P2]);
    const queued = (await h.jobs.list({ status: ["queued"], limit: 10 })).items;
    expect(queued.map((job) => job.resource).sort()).toEqual([`host:${P1}`, `host:${P2}`]);
    // Every one of them says which player it is on, or will try, to the panel.
    const shown = await h.useCases.listEpisodes((await h.useCases.listSeries())[0]!.id);
    expect(shown.map((episode) => String(episode.player)).toSorted()).toEqual([P1, P1, P2, P2]);

    release();
    await until(() => h.downloader.calls.length === 4);
    release();
    await h.queue.settle();
    expect(h.downloader.peak).toBe(2);
    // Turns: each host got two of the four episodes.
    const perHost = h.downloader.calls.map((call) => hostOf(call.source));
    expect(perHost.filter((host) => host === P1)).toHaveLength(2);
    expect(perHost.filter((host) => host === P2)).toHaveLength(2);
    const episodes = await h.series.listEpisodes((await h.useCases.listSeries())[0]!.id);
    expect(episodes.map((episode) => episode.status)).toEqual(Array(4).fill("available"));
  });

  it("never runs two downloads on one host, even with a single host for every episode", async () => {
    episodesOn(3, [P1]);
    const release = holdDownloads(3);
    await addShow();
    await until(() => h.downloader.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(h.downloader.calls).toHaveLength(1);
    for (let i = 1; i <= 3; i++) {
      release();
      if (i < 3) await until(() => h.downloader.calls.length === i + 1);
    }
    release();
    await h.queue.settle();
    expect(h.downloader.peak).toBe(1);
  });

  it("moves on to the next player when one fails, without counting it as a try", async () => {
    episodesOn(1, [P1, P2]);
    h.detector.byPage.set(player(P1, 1), new PermanentError("No video stream found"));
    await addShow();
    await h.queue.settle();

    expect(h.detector.calls).toEqual([player(P1, 1), player(P2, 1)]);
    expect(h.downloader.calls.map((call) => hostOf(call.source))).toEqual([P2]);
    const [job] = (await h.jobs.list({ status: ["done"], limit: 10 })).items.filter(
      (j) => j.kind === "download_episode",
    );
    expect(job).toMatchObject({ resource: `host:${P2}`, attempts: 1 });
  });

  it("moves on when the download itself fails, not only the detection", async () => {
    episodesOn(1, [P1, P2]);
    h.downloader.once(async () => {
      throw new PermanentError("ffmpeg: server returned 403 Forbidden");
    });
    await addShow();
    await h.queue.settle();
    expect(h.downloader.calls.map((call) => hostOf(call.source))).toEqual([P1, P2]);
  });

  it("starts over from the episode page later once every player failed, and gives up in the end", async () => {
    episodesOn(1, [P1, P2]);
    for (const host of [P1, P2])
      h.detector.byPage.set(player(host, 1), new Error(`${host} is down`));
    await addShow();
    await h.queue.settle();

    const [waiting] = (await h.jobs.list({ status: ["queued"], limit: 10 })).items;
    expect(waiting).toMatchObject({ resource: "none", attempts: 1 });
    expect(waiting?.runAfter).toBeGreaterThan(h.clock.now());
    expect(waiting?.lastError).toBe(
      `Every player failed: ${P1}: ${P1} is down; ${P2}: ${P2} is down`,
    );
    expect(waiting?.payload).toEqual({ episodeId: waiting?.episodeId });

    // Each later try reads the players again, and the job fails for good after its last attempt.
    for (let attempt = 2; attempt <= 5; attempt++) {
      h.clock.advance(7 * 60 * 60 * 1000);
      await h.queue.settle();
    }
    const [failed] = (await h.jobs.list({ status: ["failed"], limit: 10 })).items;
    expect(failed).toMatchObject({ attempts: 5 });
    expect(failed?.lastError).toContain("Every player failed");
    expect(site.requests.filter((url) => url === episodeUrl(SLUG, 1))).toHaveLength(5);
    const [episode] = await h.series.listEpisodes((await h.useCases.listSeries())[0]!.id);
    expect(episode?.status).toBe("failed");

    // Retrying it by hand reads the players afresh.
    for (const host of [P1, P2]) {
      h.detector.byPage.set(player(host, 1), [
        { url: streamOf(host, 1), kind: "hls", headers: {} },
      ]);
    }
    await h.useCases.retryJob(failed!.id);
    await h.queue.settle();
    expect((await h.series.getEpisode(episode!.id))?.status).toBe("available");
  });

  it("fails for good when the episode page lists no players", async () => {
    episodesOn(1, [P1]);
    site.players(SLUG, 1, []);
    await addShow();
    await h.queue.settle();
    const [failed] = (await h.jobs.list({ status: ["failed"], limit: 10 })).items;
    expect(failed).toMatchObject({
      lastError: "The episode page lists no players",
      resource: "none",
    });
  });
});

describe("players on skipped hosts (SKIP_PLAYERS)", () => {
  beforeEach(async () => {
    await h.cleanup();
    h = await createHarness({ extractors: [site.extractor], skipPlayers: [P1] });
  });

  it("never opens a player on a skipped host, nor on a subdomain of one", async () => {
    episodesOn(1, [P1, `www.${P1}`, P2]);
    await addShow();
    await h.queue.settle();
    expect(h.detector.calls).toEqual([player(P2, 1)]);
    expect(h.downloader.calls.map((call) => hostOf(call.source))).toEqual([P2]);
  });

  it("fails for good, naming the hosts, when every player is on a skipped host", async () => {
    episodesOn(1, [P1]);
    await addShow();
    await h.queue.settle();
    expect(h.detector.calls).toEqual([]);
    const [failed] = (await h.jobs.list({ status: ["failed"], limit: 10 })).items;
    expect(failed?.lastError).toBe(
      `Every player of the episode is on a skipped host (SKIP_PLAYERS): ${P1}`,
    );
  });
});

describe("one episode at a time (SEQUENTIAL_DOWNLOADS)", () => {
  beforeEach(async () => {
    await h.cleanup();
    h = await createHarness({ extractors: [site.extractor], sequentialDownloads: true });
  });

  /** Which episode, and from which player's host, each download was. */
  const downloads = () =>
    h.downloader.calls.map((call) => {
      const [, host, n] = new URL((call.source as { url: string }).url).pathname.split("/");
      return `${n}@${host}`;
    });

  it("downloads one episode after the other, even when the next one's host is free", async () => {
    episodesOn(3, [P1, P2]);
    // Episode 2 plays only on P2: its host is idle while episode 1 downloads from P1.
    site.players(SLUG, 2, [player(P2, 2)]);
    const release = holdDownloads(3);
    await addShow();

    await until(() => h.downloader.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(downloads()).toEqual([`1@${P1}`]);
    for (let n = 2; n <= 3; n++) {
      release();
      await until(() => h.downloader.calls.length === n);
    }
    release();
    await h.queue.settle();

    expect(h.downloader.peak).toBe(1);
    expect(downloads()).toEqual([`1@${P1}`, `2@${P2}`, `3@${P1}`]);
  });

  it("tries the same episode's players in the page's order before moving on", async () => {
    episodesOn(2, [P1, P2]);
    h.detector.byPage.set(player(P1, 1), new PermanentError("No video stream found"));
    await addShow();
    await h.queue.settle();

    expect(h.detector.calls).toEqual([player(P1, 1), player(P2, 1), player(P1, 2)]);
    expect(downloads()).toEqual([`1@${P2}`, `2@${P1}`]);
  });

  it("fails an episode once every player failed, and goes on with the next one", async () => {
    episodesOn(2, [P1, P2]);
    for (const host of [P1, P2])
      h.detector.byPage.set(player(host, 1), new Error(`${host} is down`));
    await addShow();
    await h.queue.settle();

    expect(h.detector.calls).toEqual([player(P1, 1), player(P2, 1), player(P1, 2)]);
    expect(downloads()).toEqual([`2@${P1}`]);
    // Nothing waits to try the failed episode again (only the library refresh is queued).
    const queued = (await h.jobs.list({ status: ["queued"], limit: 10 })).items;
    expect(queued.map((job) => job.kind)).toEqual(["refresh_library"]);
    const [failed] = (await h.jobs.list({ status: ["failed"], limit: 10 })).items;
    expect(failed).toMatchObject({
      attempts: 1,
      lastError: `Every player failed: ${P1}: ${P1} is down; ${P2}: ${P2} is down`,
    });
    const episodes = await h.series.listEpisodes((await h.useCases.listSeries())[0]!.id);
    expect(episodes.map((episode) => episode.status)).toEqual(["failed", "available"]);
  });
});
