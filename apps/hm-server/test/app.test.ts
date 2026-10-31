import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AppError } from "../src/domain/errors.ts";
import { createApp } from "../src/infrastructure/web/app.ts";
import { LoginRateLimiter } from "../src/infrastructure/web/rate-limit.ts";
import { addBevhill, BEVHILL_URL, createHarness, type Harness } from "./harness.ts";
import { FakeSettingsRoutes } from "./fakes/ports.ts";
import type { SettingsView } from "@orca/hm-contract";

let h: Harness;
let settings: FakeSettingsRoutes;
let app: ReturnType<typeof createApp>;
let cookie: string;

function build(webRoot?: string) {
  return createApp({
    useCases: h.useCases,
    events: h.bus,
    settings,
    secureCookies: false,
    sessionTtlMs: 7 * 24 * 3600 * 1000,
    loginLimiter: new LoginRateLimiter({ now: () => h.clock.now() }),
    ...(webRoot ? { webRoot } : {}),
  });
}

beforeEach(async () => {
  h = await createHarness();
  settings = new FakeSettingsRoutes();
  app = build();
  const login = await app.request(
    "/api/auth/login",
    json({ username: "sam", password: "secret" }),
  );
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});
afterEach(() => h.cleanup());

const json = (body: unknown, extra: RequestInit = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(extra.headers as Record<string, string>) },
  body: JSON.stringify(body),
});
const authed = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), cookie },
});
const post = (path: string, body: unknown) => app.request(path, authed(json(body)));
const get = (path: string) => app.request(path, authed());

describe("health and the /api prefix", () => {
  it("answers /health without a session", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("only mounts the API under /api, with JSON 404s", async () => {
    expect((await app.request("/auth/me")).status).toBe(404);
    const res = await app.request("/api/nope", authed());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
    expect((await app.request("/api/nope", { method: "POST" })).status).toBe(404);
  });
});

describe("auth", () => {
  it("sets an HttpOnly, SameSite=Strict cookie on login", async () => {
    const res = await app.request(
      "/api/auth/login",
      json({ username: "sam", password: "secret" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "id-sam", userName: "sam" });
    const header = res.headers.get("set-cookie")!;
    expect(header).toMatch(/^hm_session=/);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Strict/i);
    expect(header).toMatch(/Path=\//);
    expect(header).not.toMatch(/Secure/i);
  });

  it("marks the cookie Secure behind HTTPS", async () => {
    const secure = createApp({
      useCases: h.useCases,
      events: h.bus,
      settings: new FakeSettingsRoutes(),
      secureCookies: true,
      sessionTtlMs: 1000,
    });
    const res = await secure.request(
      "/api/auth/login",
      json({ username: "sam", password: "secret" }),
    );
    expect(res.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("401 for wrong credentials, 403 for a user who is not an administrator", async () => {
    expect(
      (await app.request("/api/auth/login", json({ username: "sam", password: "no" }))).status,
    ).toBe(401);
    h.authenticator.admins.set("kid", "pw");
    h.authenticator.demoted.add("id-kid");
    // The fake authenticates anyone it knows; the real one refuses non-admins with a 403.
    h.deps.authenticator.authenticate = async () => {
      const { AppError } = await import("../src/domain/errors.ts");
      throw new AppError("forbidden", "Only Jellyfin administrators can use Orca'H&M");
    };
    const res = await app.request("/api/auth/login", json({ username: "kid", password: "pw" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("400 for a malformed login", async () => {
    const res = await app.request("/api/auth/login", json({ username: "" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("bad_request");
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("tells who is signed in, and signs out", async () => {
    const me = await get("/api/auth/me");
    expect(await me.json()).toEqual({ userId: "id-sam", userName: "sam" });
    const out = await app.request("/api/auth/logout", authed({ method: "POST" }));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/hm_session=;/);
    expect((await get("/api/auth/me")).status).toBe(401);
  });

  it("401 on every protected route without a session", async () => {
    for (const [method, path] of [
      ["GET", "/api/extractors"],
      ["GET", "/api/lookup/tmdb/1"],
      ["GET", "/api/lookup/tmdb/1/seasons"],
      ["GET", "/api/lookup/tmdb/1/seasons/1"],
      ["GET", "/api/library/shows"],
      ["GET", "/api/library/shows/x/episodes"],
      ["POST", "/api/series/preview"],
      ["POST", "/api/series"],
      ["GET", "/api/series"],
      ["GET", "/api/series/x"],
      ["GET", "/api/jobs"],
      ["POST", "/api/jobs"],
      ["POST", "/api/jobs/x/retry"],
      ["POST", "/api/jobs/x/cancel"],
      ["GET", "/api/events"],
      ["GET", "/api/auth/me"],
      ["GET", "/api/settings"],
      ["PUT", "/api/settings"],
      ["POST", "/api/settings/jellyfin"],
      ["GET", "/api/settings/extractors"],
      ["PUT", "/api/settings/extractors"],
    ] as const) {
      const res = await app.request(path, {
        method,
        ...(method === "POST" || method === "PUT"
          ? { headers: { "content-type": "application/json" }, body: "{}" }
          : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it("401 for a forged or expired cookie", async () => {
    expect(
      (await app.request("/api/auth/me", { headers: { cookie: "hm_session=forged" } })).status,
    ).toBe(401);
    h.clock.advance(8 * 24 * 3600 * 1000);
    expect((await get("/api/auth/me")).status).toBe(401);
  });
});

describe("login rate limit", () => {
  const login = (username: string, password: string) =>
    app.request("/api/auth/login", json({ username, password }));

  it("answers 429 with Retry-After after two wrong passwords, even for the right one", async () => {
    for (let i = 0; i < 2; i++) expect((await login("sam", "wrong")).status).toBe(401);
    const blocked = await login("sam", "secret");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ error: "too_many_attempts" });
    // Another account is still served.
    h.authenticator.admins.set("ana", "pw");
    expect((await login("ana", "pw")).status).toBe(200);
  });

  it("lets at most two of five parallel wrong logins reach Jellyfin", async () => {
    const real = h.authenticator.authenticate.bind(h.authenticator);
    let reached = 0;
    h.authenticator.authenticate = async (username, password) => {
      reached++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return real(username, password);
    };
    const statuses = (
      await Promise.all(Array.from({ length: 5 }, async () => login("sam", "wrong")))
    ).map((response) => response.status);
    expect(reached).toBe(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(3);
  });

  it("lets the user in again after the window", async () => {
    for (let i = 0; i < 2; i++) await login("sam", "wrong");
    h.clock.advance(15 * 60 * 1000 + 1000);
    expect((await login("sam", "secret")).status).toBe(200);
  });
});

describe("request hygiene", () => {
  it("rejects a cross-origin form post (CSRF)", async () => {
    const res = await app.request(
      "/api/series/preview",
      authed({
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://evil.example",
          host: "hm.local",
        },
        body: "url=x",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("413 for a body over the limit", async () => {
    const res = await post("/api/series/preview", { url: "x".repeat(2 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "payload_too_large" });
  });

  it("400 for a body that isn't JSON", async () => {
    const res = await app.request(
      "/api/series/preview",
      authed({ method: "POST", headers: { "content-type": "application/json" }, body: "{nope" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("settings routes", () => {
  const put = (path: string, body: unknown) =>
    app.request(path, authed({ ...json(body), method: "PUT" }));

  it("shows the settings without their keys, and checks a change before passing it on", async () => {
    const view = (await (await get("/api/settings")).json()) as SettingsView;
    expect(view).toMatchObject({ jellyfin: { url: "http://jellyfin.test" }, hasTmdbApiKey: false });
    expect(view.jellyfin).not.toHaveProperty("apiKey");

    const bad = await put("/api/settings", {
      ...view,
      downloads: { ...view.downloads, connections: 0 },
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ issues: [{ path: "downloads.connections" }] });
    expect(settings.updates).toEqual([]);

    const { hasTmdbApiKey: _, ...input } = view;
    expect((await put("/api/settings", { ...input, tmdbApiKey: null })).status).toBe(200);
    expect(settings.updates).toMatchObject([
      { tmdbApiKey: null, jellyfin: { url: "http://jellyfin.test" } },
    ]);
  });

  it("downloads the extractors file and saves a new one", async () => {
    const download = await get("/api/settings/extractors");
    expect(download.headers.get("content-disposition")).toMatch(/extractors\.json/);
    expect(await download.text()).toBe("{}\n");
    expect((await put("/api/settings/extractors", { text: '{"a":1}' })).status).toBe(204);
    expect(settings.extractorsText).toBe('{"a":1}');
  });

  it("connects to a Jellyfin server for a new key", async () => {
    const res = await post("/api/settings/jellyfin", {
      url: "http://other.test:8096",
      username: "admin",
      password: "pw",
    });
    expect(await res.json()).toMatchObject({ apiKey: "made-key", url: "http://other.test:8096" });
  });
});

describe("series routes", () => {
  it("lists the extractors", async () => {
    expect(await (await get("/api/extractors")).json()).toEqual([
      {
        id: "internet-archive",
        name: "Internet Archive",
        hosts: ["archive.org"],
        example: "https://archive.org/details/bevhill-s01e01-36",
        explicit: false,
      },
    ]);
  });

  it("previews, adds and lists a series", async () => {
    const previewRes = await post("/api/series/preview", { url: BEVHILL_URL });
    expect(previewRes.status).toBe(200);
    const preview = (await previewRes.json()) as { previewId: string; episodes: { key: string }[] };
    expect((await get("/api/series")).status).toBe(200);
    expect(await (await get("/api/series")).json()).toEqual([]);

    const created = await post("/api/series", {
      previewId: preview.previewId,
      title: "The Beverly Hillbillies",
      year: 1962,
      episodeKeys: preview.episodes.map((e) => e.key),
      follow: false,
      downloadNow: false,
    });
    expect(created.status).toBe(201);
    const series = (await created.json()) as { id: string; episodeCount: number };
    expect(series.episodeCount).toBe(6);

    expect(((await (await get("/api/series")).json()) as unknown[]).length).toBe(1);
    expect((await get(`/api/series/${series.id}`)).status).toBe(200);
    const episodes = (await (await get(`/api/series/${series.id}/episodes`)).json()) as {
      status: string;
    }[];
    expect(episodes).toHaveLength(6);
    expect(episodes[0]?.status).toBe("missing");
  });

  it("410 for an expired preview, 409 for a repeat", async () => {
    const preview = (await (await post("/api/series/preview", { url: BEVHILL_URL })).json()) as {
      previewId: string;
      episodes: { key: string }[];
    };
    const body = {
      previewId: preview.previewId,
      title: "T",
      year: 1982,
      episodeKeys: [preview.episodes[0]!.key],
      follow: false,
      downloadNow: false,
    };
    expect((await post("/api/series", body)).status).toBe(201);
    expect((await post("/api/series", body)).status).toBe(409);
    expect((await post("/api/series", { ...body, previewId: "unknown" })).status).toBe(410);
  });

  it("maps extractor failures to statuses", async () => {
    expect((await post("/api/series/preview", { url: "https://example.com/x" })).status).toBe(400);
    expect(
      (await post("/api/series/preview", { url: "https://archive.org/search?query=x" })).status,
    ).toBe(400);
    expect(
      (await post("/api/series/preview", { url: "https://archive.org/details/not-in-fixtures" }))
        .status,
    ).toBe(404);
    expect((await post("/api/series/preview", {})).status).toBe(400);
  });

  it("patches a series and 404s an unknown one", async () => {
    const { series } = await addBevhill(h);
    const res = await app.request(
      `/api/series/${series.id}`,
      authed({ ...json({ follow: true, checkIntervalHours: 6 }), method: "PATCH" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ follow: true, checkIntervalHours: 6 });
    expect(
      (
        await app.request(
          "/api/series/nope",
          authed({ ...json({ follow: true }), method: "PATCH" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/series/${series.id}`,
          authed({ ...json({ checkIntervalHours: 0 }), method: "PATCH" }),
        )
      ).status,
    ).toBe(400);
    expect((await get("/api/series/nope")).status).toBe(404);
  });

  it("closes and reopens a source of a series, and checks what it is sent", async () => {
    const { series } = await addBevhill(h);
    const sourceId = series.sources[0]!.id;
    const patch = (path: string, body: unknown) =>
      app.request(path, authed({ ...json(body), method: "PATCH" }));
    const res = await patch(`/api/series/${series.id}/sources/${sourceId}`, { closed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sources: [{ id: sourceId, closed: true }] });
    expect((await patch(`/api/series/${series.id}/sources/nope`, { closed: true })).status).toBe(
      404,
    );
    expect((await patch(`/api/series/${series.id}/sources/${sourceId}`, {})).status).toBe(400);
    expect(
      (await patch(`/api/series/${series.id}/sources/${sourceId}`, { closed: true, season: 2 }))
        .status,
    ).toBe(400);
  });

  it("serves a preview's poster from our own route, behind the session", async () => {
    const preview = (await (await post("/api/series/preview", { url: BEVHILL_URL })).json()) as {
      previewId: string;
      posterUrl: string;
    };
    expect(preview.posterUrl).toBe(`/api/series/preview/${preview.previewId}/poster`);

    expect((await app.request(preview.posterUrl)).status).toBe(401);
    const res = await get(preview.posterUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);

    expect((await get("/api/series/preview/unknown/poster")).status).toBe(410);
    h.images.fail = true;
    expect((await get(preview.posterUrl)).status).toBe(502);
  });

  it("serves the poster, or 404s when there is none", async () => {
    const { series } = await addBevhill(h);
    const res = await get(`/api/series/${series.id}/poster`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);

    await rm(join(h.root, "The Beverly Hillbillies (1962)", "poster.jpg"));
    expect((await get(`/api/series/${series.id}/poster`)).status).toBe(404);
    expect((await get("/api/series/nope/poster")).status).toBe(404);
  });
});

describe("Jellyfin's shows", () => {
  it("lists them with the series this server has for each, 502 when Jellyfin can't be asked", async () => {
    h.mediaServer.library = [
      { id: "jf", title: "Mashle", year: 2023, tmdbId: "1", imdbId: null, folderName: "M" },
    ];
    const res = await get("/api/library/shows");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: "jf",
        title: "Mashle",
        year: 2023,
        tmdbId: "1",
        imdbId: null,
        seriesId: null,
        adoptable: true,
      },
    ]);
    h.mediaServer.fail = new AppError("upstream", "Could not reach Jellyfin");
    expect((await get("/api/library/shows")).status).toBe(502);
  });

  it("lists the episodes a show has as files, in order", async () => {
    h.mediaServer.episodeFiles.set("jf", [
      { season: 2, episode: 1, path: "/media/M/Season 2/S02E01.mp4" },
      { season: 1, episode: 2, path: "/media/M/Season 1/S01E02.mp4" },
    ]);
    const res = await get("/api/library/shows/jf/episodes");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { season: 1, episode: 2 },
      { season: 2, episode: 1 },
    ]);
  });
});

describe("TMDB lookup", () => {
  it("names a show by its TMDB id, through Jellyfin", async () => {
    h.mediaServer.shows.set("30991", {
      title: "Cowboy Bebop",
      year: 1998,
      imdbId: "tt0213338",
      overview: "Bounty hunters in space.",
      posterUrl: "https://image.tmdb.org/t/p/w342/bebop.jpg",
    });
    const res = await get("/api/lookup/tmdb/30991");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tmdbId: "30991",
      title: "Cowboy Bebop",
      year: 1998,
      imdbId: "tt0213338",
      overview: "Bounty hunters in space.",
      posterUrl: "https://image.tmdb.org/t/p/w342/bebop.jpg",
      backdropUrl: null,
      status: null,
      nextEpisode: null,
    });
  });

  it("adds TMDB's backdrop and airing status, and leaves them out when TMDB can't be asked", async () => {
    h.mediaServer.shows.set("30991", {
      title: "Cowboy Bebop",
      year: 1998,
      imdbId: null,
      overview: null,
      posterUrl: null,
    });
    h.episodeGuide.showFacts.set("30991", {
      backdropUrl: "https://image.tmdb.org/t/p/w1280/wide.jpg",
      status: "ended",
      nextEpisode: null,
    });
    expect(await (await get("/api/lookup/tmdb/30991")).json()).toMatchObject({
      backdropUrl: "https://image.tmdb.org/t/p/w1280/wide.jpg",
      status: "ended",
    });
    h.episodeGuide.fail = new AppError("upstream", "TMDB answered 500");
    const res = await get("/api/lookup/tmdb/30991");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      title: "Cowboy Bebop",
      backdropUrl: null,
      status: null,
    });
  });

  it("drops an IMDb id that isn't one", async () => {
    h.mediaServer.shows.set("5", {
      title: "Odd",
      year: null,
      imdbId: "nm123",
      overview: null,
      posterUrl: null,
    });
    expect(await (await get("/api/lookup/tmdb/5")).json()).toMatchObject({ imdbId: null });
  });

  it("400 for an id that isn't a number, 404 for one TMDB doesn't have", async () => {
    expect((await get("/api/lookup/tmdb/abc")).status).toBe(400);
    const res = await get("/api/lookup/tmdb/404404");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });

  it("502 when Jellyfin can't be asked", async () => {
    h.mediaServer.fail = new AppError("upstream", "Could not reach Jellyfin");
    expect((await get("/api/lookup/tmdb/1")).status).toBe(502);
  });
});

describe("TMDB episode guide", () => {
  it("lists a show's seasons and a season's episodes, in the language asked for", async () => {
    h.episodeGuide.shows.set("135237", [
      { number: 0, name: "Specials", episodeCount: 1, year: null },
      { number: 1, name: "Season 1", episodeCount: 6, year: 2021 },
    ]);
    h.episodeGuide.seasonEpisodes.set("135237/1", [
      {
        number: 1,
        name: "Episodio 1",
        airDate: "2021-09-30",
        overview: null,
        runtimeMin: 24,
        stillUrl: "https://image.tmdb.org/t/p/w400/still.jpg",
      },
    ]);
    const seasons = await get("/api/lookup/tmdb/135237/seasons?language=es");
    expect(seasons.status).toBe(200);
    expect(await seasons.json()).toEqual([
      { number: 0, name: "Specials", episodeCount: 1, year: null },
      { number: 1, name: "Season 1", episodeCount: 6, year: 2021 },
    ]);
    const episodes = await get("/api/lookup/tmdb/135237/seasons/1?language=es");
    expect(await episodes.json()).toEqual([
      {
        number: 1,
        name: "Episodio 1",
        airDate: "2021-09-30",
        overview: null,
        runtimeMin: 24,
        stillUrl: "https://image.tmdb.org/t/p/w400/still.jpg",
      },
    ]);
    expect(h.episodeGuide.languages).toEqual(["es", "es"]);
  });

  it("400 for a bad id, season or language; 404 for what TMDB doesn't have", async () => {
    expect((await get("/api/lookup/tmdb/abc/seasons")).status).toBe(400);
    expect((await get("/api/lookup/tmdb/1/seasons/x")).status).toBe(400);
    expect((await get("/api/lookup/tmdb/1/seasons?language=spanish")).status).toBe(400);
    expect((await get("/api/lookup/tmdb/404/seasons")).status).toBe(404);
    expect((await get("/api/lookup/tmdb/404/seasons/2")).status).toBe(404);
  });

  it("503 without a TMDB key, 502 when TMDB can't be asked", async () => {
    h.episodeGuide.fail = new AppError("upstream", "Could not reach TMDB");
    expect((await get("/api/lookup/tmdb/1/seasons")).status).toBe(502);
    h.deps.episodeGuide = null;
    const res = await get("/api/lookup/tmdb/1/seasons/1");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "unavailable" });
  });
});

describe("job routes", () => {
  it("enqueues downloads, lists jobs with filters and pages, retries and cancels", async () => {
    const { series } = await addBevhill(h);
    const episodes = (await (await get(`/api/series/${series.id}/episodes`)).json()) as {
      id: string;
    }[];
    const enqueued = await post("/api/jobs", { episodeIds: episodes.slice(0, 2).map((e) => e.id) });
    expect(enqueued.status).toBe(201);
    await h.queue.settle();

    const all = (await (await get("/api/jobs?limit=1")).json()) as {
      items: { status: string; seriesTitle: string }[];
      nextCursor: string | null;
    };
    expect(all.items).toHaveLength(1);
    expect(all.nextCursor).toBeTruthy();
    const page2 = (await (await get(`/api/jobs?limit=50&cursor=${all.nextCursor}`)).json()) as {
      items: unknown[];
    };
    expect(page2.items.length).toBeGreaterThan(0);

    const done = (await (await get("/api/jobs?status=done,failed")).json()) as {
      items: { status: string }[];
    };
    expect(done.items.every((j) => j.status === "done")).toBe(true);
    expect((await get("/api/jobs?status=bogus")).status).toBe(400);
    expect((await get("/api/jobs?limit=0")).status).toBe(400);

    const jobId = (done.items[0] as unknown as { id: string }).id;
    expect((await app.request(`/api/jobs/${jobId}/retry`, authed({ method: "POST" }))).status).toBe(
      409,
    );
    expect((await app.request("/api/jobs/nope/retry", authed({ method: "POST" }))).status).toBe(
      404,
    );
    expect((await app.request("/api/jobs/nope/cancel", authed({ method: "POST" }))).status).toBe(
      404,
    );
    expect((await post("/api/jobs", { episodeIds: [] })).status).toBe(400);
  });

  it("downloads a whole series from /series/:id/download", async () => {
    const { series } = await addBevhill(h);
    const res = await app.request(`/api/series/${series.id}/download`, authed({ method: "POST" }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as unknown[]).length).toBe(6);
    await h.queue.settle();
    expect(h.downloader.calls).toHaveLength(6);
  });
});

describe("GET /api/events (SSE)", () => {
  it("streams a ping first, then the events as they happen", async () => {
    const res = await get("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    const first = decoder.decode((await reader.read()).value);
    expect(first).toContain("event: ping");

    h.bus.publish({ type: "series.updated", seriesId: "s1" });
    let received = "";
    while (!received.includes("series.updated"))
      received += decoder.decode((await reader.read()).value);
    expect(received).toContain("event: series.updated");
    expect(received).toMatch(/id: \d+/);
    expect(received).toContain('"seriesId":"s1"');
    await reader.cancel();
  });
});

describe("serving the panel (webRoot)", () => {
  let web: string;
  beforeEach(async () => {
    web = await mkdtemp(join(tmpdir(), "hm-web-"));
    await mkdir(join(web, "assets"));
    await writeFile(join(web, "index.html"), "<!doctype html><title>panel</title>");
    await writeFile(join(web, "assets", "app.js"), "console.log(1)");
    app = build(web);
  });
  afterEach(() => rm(web, { recursive: true, force: true }));

  it("serves files and falls back to index.html for history routes", async () => {
    const js = await app.request("/assets/app.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toMatch(/javascript/);
    expect(await (await app.request("/series/123")).text()).toContain("<title>panel</title>");
    expect(await (await app.request("/")).text()).toContain("<title>panel</title>");
  });

  it("keeps the API and health out of the fallback, and refuses path traversal", async () => {
    expect((await app.request("/api/nope")).status).toBe(404);
    expect(((await (await app.request("/api/nope")).json()) as { error: string }).error).toBe(
      "not_found",
    );
    expect((await app.request("/health")).status).toBe(200);
    const escaped = await app.request("/..%2f..%2fetc%2fpasswd");
    expect(await escaped.text()).toContain("<title>panel</title>");
  });

  it("answers 404, not the panel, for a missing asset or any path that names a file", async () => {
    for (const path of ["/assets/nope.js", "/assets/nope", "/favicon.ico", "/deep/missing.css"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain("<title>panel</title>");
    }
    expect((await app.request("/assets/nope.js", { method: "HEAD" })).status).toBe(404);
    // A history route may contain a dot in the middle; only the last segment's extension counts.
    expect((await app.request("/series/v1.2/episodes")).status).toBe(200);
    // Real files are still served.
    expect((await app.request("/assets/app.js")).status).toBe(200);
  });

  it("doesn't serve a panel when none is configured", async () => {
    app = build();
    expect((await app.request("/")).status).toBe(404);
  });
});

describe("POST /api/series/:id/check", () => {
  it("queues the series' check job, once, and answers with it", async () => {
    h.deps.queue = { notify: () => {} };
    const { series } = await addBevhill(h);
    const first = await app.request(`/api/series/${series.id}/check`, authed({ method: "POST" }));
    expect(first.status).toBe(202);
    const job = (await first.json()) as { id: string; kind: string; seriesId: string };
    expect(job).toMatchObject({ kind: "check_series", seriesId: series.id });
    const second = await app.request(`/api/series/${series.id}/check`, authed({ method: "POST" }));
    expect(((await second.json()) as { id: string }).id).toBe(job.id);
  });

  it("is a 404 for an unknown series and needs a session", async () => {
    expect((await app.request("/api/series/nope/check", authed({ method: "POST" }))).status).toBe(
      404,
    );
    expect((await app.request("/api/series/nope/check", { method: "POST" })).status).toBe(401);
  });
});
