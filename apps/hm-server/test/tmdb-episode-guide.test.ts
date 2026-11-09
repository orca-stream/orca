import { describe, expect, it } from "vite-plus/test";
import { AppError } from "../src/domain/errors.ts";
import { TmdbEpisodeGuide } from "../src/infrastructure/tmdb/tmdb-episode-guide.ts";

/** A fetch that answers from a table by path, and records what it was asked. */
function fakeTmdb(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ status_code: 34 }), { status: 404 });
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const guide = (apiKey: string, fetchImpl: typeof fetch) =>
  new TmdbEpisodeGuide({ apiKey, userAgent: "OrcaHM/test", timeoutMs: 1000, fetch: fetchImpl });

describe("TmdbEpisodeGuide", () => {
  it("searches shows by name and year in the language asked for, best first", async () => {
    const { fetchImpl, calls } = fakeTmdb({
      "/3/search/tv": {
        body: {
          results: [
            {
              id: 4607,
              name: "Lost",
              original_name: "Lost",
              first_air_date: "2004-09-22",
              overview: "  Survivors of a plane crash.  ",
              poster_path: "/lost.jpg",
            },
            { id: 896, name: "El mundo perdido", original_name: "The Lost World" },
            { id: 7, name: "", original_name: "" },
            { id: 8, name: null, original_name: "Only Original", poster_path: "javascript:x" },
          ],
        },
      },
    });
    expect(await guide("v3key", fetchImpl).search("lost", 2004, "es-MX")).toEqual([
      {
        tmdbId: "4607",
        title: "Lost",
        originalTitle: null,
        year: 2004,
        overview: "Survivors of a plane crash.",
        posterUrl: "https://image.tmdb.org/t/p/w154/lost.jpg",
      },
      {
        tmdbId: "896",
        title: "El mundo perdido",
        originalTitle: "The Lost World",
        year: null,
        overview: null,
        posterUrl: null,
      },
      {
        tmdbId: "8",
        title: "Only Original",
        originalTitle: null,
        year: null,
        overview: null,
        posterUrl: null,
      },
    ]);
    const params = calls[0]?.url.searchParams;
    expect(params?.get("query")).toBe("lost");
    expect(params?.get("first_air_date_year")).toBe("2004");
    expect(params?.get("include_adult")).toBe("false");
    expect(params?.get("language")).toBe("es-MX");
    expect(params?.get("api_key")).toBe("v3key");
  });

  it("searches without a year when none is given, and says upstream when TMDB fails", async () => {
    const { fetchImpl, calls } = fakeTmdb({ "/3/search/tv": { body: { results: [] } } });
    expect(await guide("v3key", fetchImpl).search("nothing", undefined, undefined)).toEqual([]);
    expect(calls[0]?.url.searchParams.has("first_air_date_year")).toBe(false);
    expect(calls[0]?.url.searchParams.has("language")).toBe(false);
    const failing = fakeTmdb({ "/3/search/tv": { status: 500, body: {} } });
    await expect(
      guide("v3key", failing.fetchImpl).search("x", undefined, "es"),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("lists the seasons in order, with their years, sending a v3 key in the query", async () => {
    const { fetchImpl, calls } = fakeTmdb({
      "/3/tv/135237": {
        body: {
          name: "Chizuru-chan Kaihatsu Nikki",
          seasons: [
            { season_number: 1, name: "Season 1", episode_count: 6, air_date: "2021-09-30" },
            { season_number: 0, name: "Specials", episode_count: 2, air_date: null },
          ],
        },
      },
    });
    expect(await guide("v3key", fetchImpl).seasons("135237", "es")).toEqual([
      { number: 0, name: "Specials", episodeCount: 2, year: null },
      { number: 1, name: "Season 1", episodeCount: 6, year: 2021 },
    ]);
    const [call] = calls;
    expect(call?.url.searchParams.get("api_key")).toBe("v3key");
    expect(call?.url.searchParams.get("language")).toBe("es");
    expect(call?.headers["authorization"]).toBeUndefined();
  });

  it("lists a season's episodes, sending a v4 read token as a bearer token", async () => {
    const { fetchImpl, calls } = fakeTmdb({
      "/3/tv/1/season/2": {
        body: {
          episodes: [
            { episode_number: 2, name: "Two", air_date: "", still_path: "javascript:alert(1)" },
            {
              episode_number: 1,
              name: " One ",
              air_date: "2020-01-01",
              overview: " A start. ",
              runtime: 24,
              still_path: "/abc-1.jpg",
            },
          ],
        },
      },
    });
    expect(await guide("eyJtoken", fetchImpl).episodes("1", 2, undefined)).toEqual([
      {
        number: 1,
        name: "One",
        airDate: "2020-01-01",
        overview: "A start.",
        runtimeMin: 24,
        stillUrl: "https://image.tmdb.org/t/p/w400/abc-1.jpg",
      },
      { number: 2, name: "Two", airDate: null, overview: null, runtimeMin: null, stillUrl: null },
    ]);
    const [call] = calls;
    expect(call?.headers["authorization"]).toBe("Bearer eyJtoken");
    expect(call?.url.searchParams.has("api_key")).toBe(false);
    expect(call?.url.searchParams.has("language")).toBe(false);
  });

  it("gives the show's backdrop, asked for in no language, and nothing that isn't TMDB's path", async () => {
    const { fetchImpl, calls } = fakeTmdb({
      "/3/tv/1": { body: { backdrop_path: "/wide.jpg", seasons: [] } },
      "/3/tv/2": { body: { backdrop_path: "https://evil.example/x.jpg" } },
      "/3/tv/3": { body: { backdrop_path: null } },
    });
    const tmdb = guide("v3key", fetchImpl);
    expect((await tmdb.show("1"))?.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/wide.jpg");
    expect(calls[0]?.url.searchParams.has("language")).toBe(false);
    expect((await tmdb.show("2"))?.backdropUrl).toBeNull();
    expect((await tmdb.show("3"))?.backdropUrl).toBeNull();
    expect(await tmdb.show("404")).toBeNull();
  });

  it("ranks the images in the language asked for first, backdrops without text before", async () => {
    const img = (file_path: string, iso_639_1: string | null, vote_average = 0, width = 100) => ({
      file_path,
      iso_639_1,
      vote_average,
      width,
      height: 100,
    });
    const { fetchImpl, calls } = fakeTmdb({
      "/3/tv/7/images": {
        body: {
          posters: [img("/en.jpg", "en", 9), img("/ja.jpg", "ja"), img("/es.jpg", "es", 1)],
          backdrops: [img("/en.jpg", "en", 9), img("/none.jpg", null), img("/es.jpg", "es")],
          logos: [
            img("/ja.png", "ja", 9),
            img("/en-small.png", "en", 5, 100),
            img("/en-big.png", "en", 5, 900),
            img("/odd.svg", "en", 10),
          ],
        },
      },
      "/3/tv/7": {
        body: { images: { logos: [img("/ja.png", "ja", 9), img("/es.png", "es")] } },
      },
    });
    const tmdb = guide("v3key", fetchImpl);
    const options = await tmdb.artwork("7", "es-MX");
    expect(calls[0]?.url.searchParams.has("language")).toBe(false);
    expect(options?.poster.map((o) => o.previewUrl)).toEqual([
      "https://image.tmdb.org/t/p/w342/es.jpg",
      "https://image.tmdb.org/t/p/w342/en.jpg",
      "https://image.tmdb.org/t/p/w342/ja.jpg",
    ]);
    expect(options?.poster[0]).toMatchObject({
      url: "https://image.tmdb.org/t/p/original/es.jpg",
      language: "es",
    });
    expect(options?.backdrop.map((o) => o.language)).toEqual([null, "es", "en"]);
    // Ties go to the widest; an SVG is not a file TMDB's way, and Jellyfin couldn't use it anyway.
    expect(options?.logo.map((o) => o.previewUrl.split("/").at(-1))).toEqual([
      "en-big.png",
      "en-small.png",
      "ja.png",
    ]);
    expect((await tmdb.show("7", undefined, "es"))?.logoUrl).toBe(
      "https://image.tmdb.org/t/p/w500/es.png",
    );
    expect(await tmdb.artwork("404", "es")).toBeNull();
  });

  it("reads whether the show still airs from TMDB's status and its next episode", async () => {
    const next = { season_number: 2, episode_number: 5, air_date: "2026-11-12" };
    const { fetchImpl } = fakeTmdb({
      "/3/tv/1": { body: { status: "Returning Series", next_episode_to_air: next } },
      // Returning, but nothing dated: between seasons, not airing (MASHLE, 2026-10-31).
      "/3/tv/2": { body: { status: "Returning Series", next_episode_to_air: null } },
      "/3/tv/3": { body: { status: "In Production" } },
      "/3/tv/4": { body: { status: "Ended" } },
      "/3/tv/5": { body: { status: "Canceled" } },
      "/3/tv/6": { body: { status: "Something new" } },
      "/3/tv/7": { body: {} },
    });
    const tmdb = guide("v3key", fetchImpl);
    const statuses = await Promise.all(
      ["1", "2", "3", "4", "5", "6", "7"].map(async (id) => (await tmdb.show(id))?.status),
    );
    expect(statuses).toEqual(["airing", "returning", "returning", "ended", "canceled", null, null]);
    expect((await tmdb.show("1"))?.nextEpisode).toEqual({
      season: 2,
      number: 5,
      airDate: "2026-11-12",
    });
    expect((await tmdb.show("2"))?.nextEpisode).toBeNull();
  });

  it("finds the show itself, with its IMDb id, for a server without Jellyfin", async () => {
    const { fetchImpl, calls } = fakeTmdb({
      "/3/tv/4219": {
        body: {
          name: " Los nuevos ricos ",
          first_air_date: "1962-09-26",
          overview: "Una familia.",
          poster_path: "/p-1.jpg",
          external_ids: { imdb_id: "tt0055662" },
        },
      },
      "/3/tv/5": {
        body: { name: "", original_name: "", poster_path: "http://evil.example/x.jpg" },
      },
    });
    expect(await guide("v3key", fetchImpl).match("4219", "es")).toEqual({
      title: "Los nuevos ricos",
      year: 1962,
      imdbId: "tt0055662",
      overview: "Una familia.",
      posterUrl: "https://image.tmdb.org/t/p/w500/p-1.jpg",
    });
    expect(calls[0]?.url.searchParams.get("append_to_response")).toBe("external_ids");
    expect(calls[0]?.url.searchParams.get("language")).toBe("es");
    expect(await guide("v3key", fetchImpl).match("5", undefined)).toBeNull();
    expect(await guide("v3key", fetchImpl).match("6", undefined)).toBeNull();
  });

  it("answers null for TMDB's 404", async () => {
    const { fetchImpl } = fakeTmdb({});
    expect(await guide("k", fetchImpl).seasons("9", undefined)).toBeNull();
    expect(await guide("k", fetchImpl).episodes("9", 1, undefined)).toBeNull();
  });

  it("says upstream for a rejected key, a 5xx, an odd body or no answer", async () => {
    const cases: (typeof fetch)[] = [
      fakeTmdb({ "/3/tv/1": { status: 401, body: {} } }).fetchImpl,
      fakeTmdb({ "/3/tv/1": { status: 503, body: {} } }).fetchImpl,
      fakeTmdb({ "/3/tv/1": { body: { seasons: "many" } } }).fetchImpl,
      (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    ];
    for (const fetchImpl of cases) {
      const error = await guide("k", fetchImpl)
        .seasons("1", undefined)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("upstream");
    }
  });
});
