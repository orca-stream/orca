import { describe, expect, it } from "vite-plus/test";
import { ExtractorError, type HttpClient } from "@orca/extractor-core";
import { createShowApiExtractor } from "../src/extractor.ts";
import { ShowApiSite } from "../src/site.ts";

const ORIGIN = "https://origin.test";
const API = `${ORIGIN}/api-prefix/v1`;
const SHOW = `${ORIGIN}/series/the-show-2026`;

const siteJson = {
  id: "site-b",
  name: "Site B",
  hosts: ["origin.test"],
  example: SHOW,
  showPath: "^/series/([^/]+)/?$",
  api: `${API}/`,
  userAgent: "Mozilla/5.0 test",
};
const parseSite = (overrides: Record<string, unknown> = {}): ShowApiSite =>
  ShowApiSite.parse({ ...siteJson, ...overrides });
const site = parseSite();

const ok = (data: unknown) => ({ error: false, message: "", data });
const post = (id: number, season: number, episode: number) => ({
  _id: id,
  title: `The Show: Temporada ${season} Episodio ${episode}`,
  slug: `the-show-temporada-${season}-episodio-${episode}`,
  overview: "",
  season_number: season,
  episode_number: episode,
});
const list = (posts: unknown[], seasons: string[], total: number) =>
  ok({ posts, seasons, pagination: { current_page: 1, total } });

const show = ok({
  _id: 500,
  title: "The Show (2026)",
  original_title: "The Show",
  overview: "Overview",
  slug: "the-show-2026",
  release_date: "2026-03-14",
  images: { poster: "/thumbs/poster_hd.webp" },
});

/** A show of two seasons whose numbers sort wrong as text (2 and 10): season 10 needs a second page. */
const answers = (): Record<string, unknown> => ({
  [`${API}/single/tvshow?slug=the-show-2026&postType=tvshow`]: show,
  [`${API}/single/episodes/list?_id=500`]: list([post(1, 2, 1)], ["10", "2"], 2),
  [`${API}/single/episodes/list?_id=500&season=2`]: list(
    [post(1, 2, 1), post(2, 2, 2)],
    ["10", "2"],
    2,
  ),
  [`${API}/single/episodes/list?_id=500&season=10`]: list([post(3, 10, 1)], ["10", "2"], 3),
  [`${API}/single/episodes/list?_id=500&season=10&postsPerPage=3`]: list(
    [post(3, 10, 1), post(4, 10, 2), post(5, 10, 4)],
    ["10", "2"],
    3,
  ),
  [`${API}/single/episodes/list?_id=500&season=2&postsPerPage=1`]: list([post(1, 2, 1)], [], 2),
  [`${API}/single/episodes/list?_id=500&season=10&postsPerPage=1`]: list([post(3, 10, 1)], [], 3),
  [`${API}/player?postId=4`]: ok({
    embeds: [
      { url: `${ORIGIN}/player.php?t=a&server=one`, server: "Online", lang: "Subtitulado" },
      { url: `${ORIGIN}/player.php?t=b&server=two`, server: "Online", lang: "Latino" },
      { url: `${ORIGIN}/player.php?t=b&server=two`, server: "Online", lang: "Latino" },
      { url: "not an address", server: "Online", lang: "Latino" },
      { url: `${ORIGIN}/player.php?t=c&server=dual`, server: "Online", lang: "Latino - Inglés" },
    ],
  }),
});

/** An HttpClient that answers JSON from a map and remembers what was asked, with its headers. */
function fakeApi(map: Record<string, unknown>) {
  const requests: { url: string; headers: Record<string, string> | undefined }[] = [];
  const http: HttpClient = {
    getJson(url, options) {
      requests.push({ url, headers: options?.headers });
      return url in map
        ? Promise.resolve(map[url])
        : Promise.reject(new ExtractorError("not-found", `No answer for ${url}`));
    },
  };
  return { http, requests };
}

describe("show API extractor: one season per address", () => {
  it("claims the show addresses of its hosts, with or without a season, and nothing else", () => {
    const extractor = createShowApiExtractor({ site, http: fakeApi({}).http });
    expect(extractor.canHandle(SHOW)).toBe(true);
    expect(extractor.canHandle(`${SHOW}/?season=10#top`)).toBe(true);
    expect(extractor.canHandle("https://www.origin.test/series/the-show-2026")).toBe(true);
    expect(extractor.canHandle(`${SHOW}?season=two`)).toBe(false);
    expect(extractor.canHandle(`${SHOW}/temporada/1`)).toBe(false);
    expect(extractor.canHandle("https://other.test/series/the-show-2026")).toBe(false);
    expect(extractor.canHandle("not an address")).toBe(false);
  });

  it("says the next season's address comes after a season's, and nothing without one", () => {
    const extractor = createShowApiExtractor({ site, http: fakeApi({}).http });
    expect(extractor.nextSourceUrl!(`${SHOW}/?season=2#top`)).toBe(`${SHOW}?season=3`);
    expect(extractor.nextSourceUrl!(SHOW)).toBeNull();
    expect(extractor.nextSourceUrl!("https://other.test/series/the-show-2026?season=1")).toBeNull();
  });

  it("reads the season the address names, as its own source", async () => {
    const { http, requests } = fakeApi(answers());
    const extraction = await createShowApiExtractor({ site, http }).extract(`${SHOW}/?season=10`);

    expect(extraction.series).toEqual({
      externalId: "500:10",
      sourceUrl: `${SHOW}?season=10`,
      title: "The Show",
      year: 2026,
      plot: "Overview",
      posterUrl: `${ORIGIN}/thumbs/poster_hd.webp`,
      remoteMarker: "10:3",
    });
    expect(extraction.seasons).toEqual([{ number: 10, episodeCount: 3 }]);
    expect(extraction.episodes.map((e) => [e.season, e.episode, e.sourceRef])).toEqual([
      [10, 1, "3"],
      [10, 2, "4"],
      [10, 4, "5"],
    ]);
    expect(extraction.episodes[0]).toMatchObject({
      title: "The Show: Temporada 10 Episodio 1",
      inferred: false,
      media: { kind: "mirrors", url: `${API}/player?postId=3` },
    });
    expect(extraction.warnings).toEqual([{ code: "gap", message: "Missing episode numbers: 3" }]);
    // The first page did not hold the whole season, so it was asked for again whole.
    expect(requests.map((request) => request.url)).toEqual([
      `${API}/single/tvshow?slug=the-show-2026&postType=tvshow`,
      `${API}/single/episodes/list?_id=500`,
      `${API}/single/episodes/list?_id=500&season=10`,
      `${API}/single/episodes/list?_id=500&season=10&postsPerPage=3`,
    ]);
    expect(
      requests.every((request) => request.headers?.["user-agent"] === "Mozilla/5.0 test"),
    ).toBe(true);
  });

  it("reads the first season (in numeric order) when the address names none, and says so", async () => {
    const { http, requests } = fakeApi(answers());
    const extraction = await createShowApiExtractor({ site, http }).extract(SHOW);

    expect(extraction.series).toMatchObject({ externalId: "500:2", sourceUrl: `${SHOW}?season=2` });
    expect(extraction.episodes.map((e) => e.sourceRef)).toEqual(["1", "2"]);
    expect(extraction.warnings).toEqual([
      expect.objectContaining({
        code: "season-inferred",
        message: expect.stringContaining("2, 10"),
      }),
    ]);
    // The season fit in its first page: no second request.
    expect(requests).toHaveLength(3);
  });

  it("refuses a season the show does not have", async () => {
    const { http } = fakeApi(answers());
    await expect(
      createShowApiExtractor({ site, http }).extract(`${SHOW}?season=3`),
    ).rejects.toMatchObject({ code: "not-found", message: expect.stringContaining("2, 10") });
  });

  it("gives a cheap marker equal to the extraction's, that changes with an episode", async () => {
    const map = answers();
    const extractor = createShowApiExtractor({ site, http: fakeApi(map).http });
    expect(await extractor.remoteMarker!(`${SHOW}?season=10`)).toBe("10:3");
    expect(await extractor.remoteMarker!(SHOW)).toBe("2:2");

    map[`${API}/single/episodes/list?_id=500&season=10&postsPerPage=1`] = list([], [], 4);
    expect(await extractor.remoteMarker!(`${SHOW}?season=10`)).toBe("10:4");
  });

  it("says why when the site has no such show or answers in another shape", async () => {
    const { http } = fakeApi({
      [`${API}/single/tvshow?slug=gone&postType=tvshow`]: {
        error: true,
        message: "Not found",
        data: null,
      },
      [`${API}/single/tvshow?slug=odd&postType=tvshow`]: ok({ id: "nope" }),
    });
    const extractor = createShowApiExtractor({ site, http });
    await expect(extractor.extract(`${ORIGIN}/series/gone`)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(extractor.extract(`${ORIGIN}/series/odd`)).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(extractor.extract("https://other.test/series/x")).rejects.toMatchObject({
      code: "unsupported-url",
    });
  });

  it("refuses a show without seasons", async () => {
    const { http } = fakeApi({
      [`${API}/single/tvshow?slug=the-show-2026&postType=tvshow`]: show,
      [`${API}/single/episodes/list?_id=500`]: list([], [], 0),
    });
    await expect(createShowApiExtractor({ site, http }).extract(SHOW)).rejects.toMatchObject({
      code: "no-episodes",
    });
  });
});

describe("show API extractor: the players", () => {
  it("lists an episode's players once each, in the site's order, with the site as referer", async () => {
    const { http } = fakeApi(answers());
    const mirrors = await createShowApiExtractor({ site, http }).resolveMirrors!(
      `${API}/player?postId=4`,
    );
    expect(mirrors).toEqual([
      { url: `${ORIGIN}/player.php?t=a&server=one`, referer: `${ORIGIN}/` },
      { url: `${ORIGIN}/player.php?t=b&server=two`, referer: `${ORIGIN}/` },
      { url: `${ORIGIN}/player.php?t=c&server=dual`, referer: `${ORIGIN}/` },
    ]);
  });

  it("keeps only the languages asked for, best first", async () => {
    const { http } = fakeApi(answers());
    const extractor = createShowApiExtractor({
      site: parseSite({ languages: ["Latino", "Subtitulado"] }),
      http,
    });
    expect((await extractor.resolveMirrors!(`${API}/player?postId=4`)).map((m) => m.url)).toEqual([
      `${ORIGIN}/player.php?t=b&server=two`,
      `${ORIGIN}/player.php?t=c&server=dual`,
      `${ORIGIN}/player.php?t=a&server=one`,
    ]);
    const latino = createShowApiExtractor({ site: parseSite({ languages: ["Latino"] }), http });
    expect(await latino.resolveMirrors!(`${API}/player?postId=4`)).toHaveLength(2);
  });

  it("reads players only from its own API", async () => {
    const extractor = createShowApiExtractor({ site, http: fakeApi({}).http });
    await expect(
      extractor.resolveMirrors!("https://other.test/api-prefix/v1/player?postId=4"),
    ).rejects.toMatchObject({ code: "unsupported-url" });
  });
});

describe("a show API site's description", () => {
  it("refuses a show path without a group for the slug", () => {
    expect(() => parseSite({ showPath: "^/series/[^/]+$" })).toThrow(/slug/);
  });

  it("drops the API's trailing slash", () => {
    expect(site.api).toBe(API);
  });
});
