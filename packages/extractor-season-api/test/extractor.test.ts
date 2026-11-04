import { describe, expect, it } from "vite-plus/test";
import { ExtractorError, type HttpClient } from "@orca/extractor-core";
import { createSeasonApiExtractor } from "../src/extractor.ts";
import { SeasonApiSite } from "../src/site.ts";

const ORIGIN = "https://origin.test";
const API = `${ORIGIN}/api/partner/v1`;
/** The pages people browse live on another domain than the API, and name the season inside a slug. */
const PAGES = "https://another.test";
const SEASON = `${PAGES}/anime/some-show-11111`;
const SEASON_API = `${API}/series/11111`;

const siteJson = {
  id: "site-d",
  name: "Site D",
  hosts: ["another.test"],
  example: SEASON,
  seasonPath: "^/anime/[^/]*-(\\d+)/?$",
  api: `${API}/`,
  userAgent: "Mozilla/5.0 test",
};
const parseSite = (overrides: Record<string, unknown> = {}): SeasonApiSite =>
  SeasonApiSite.parse({ ...siteJson, ...overrides });
const site = parseSite();

const episode = (
  number: number,
  available: { sub: boolean; dub: boolean } = { sub: true, dub: true },
  extra: Record<string, unknown> = {},
) => ({
  number,
  title: null,
  runtimeSeconds: 1464,
  aired: null,
  thumbnail: null,
  available: { ...available, subHard: true, dubHard: false },
  embed: {
    sub: `${ORIGIN}/embed/ani/11111/${number}/sub`,
    dub: `${ORIGIN}/embed/ani/11111/${number}/dub`,
  },
  ...extra,
});

/** The season as the site describes it, trimmed to the parts that vary. */
const season = (episodeList: unknown[]) => ({
  anilistId: 11111,
  malId: 22222,
  title: "Some Show",
  nativeTitle: "あるショー",
  format: "TV",
  status: "Finished",
  year: 2016,
  season: "Spring",
  episodes: { total: 13, sub: 13, dub: 13 },
  synopsis: "Synopsis...",
  poster: "/api/anime/cover?anilistId=11111&malId=22222",
  banner: null,
  url: SEASON,
  embed: `${ORIGIN}/embed/ani/11111/1/sub`,
  episodeList,
});
/** The site's answer as recorded: the season wrapped in `data`. */
const answer = (episodeList: unknown[]) => ({ data: season(episodeList) });

const full = answer([
  episode(2, undefined, { title: "Second", aired: "2016-04-10T00:00:00Z" }),
  episode(1),
  episode(3, { sub: true, dub: false }, { runtimeSeconds: 0 }),
  episode(5, undefined, { number: "5" }),
  episode(6, { sub: false, dub: false }),
]);

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

describe("season API extractor: one season per address", () => {
  it("claims the season addresses of its hosts, and nothing else", () => {
    const extractor = createSeasonApiExtractor({ site, http: fakeApi({}).http });
    expect(extractor.canHandle(SEASON)).toBe(true);
    expect(extractor.canHandle(`${SEASON}/?ref=home#top`)).toBe(true);
    expect(extractor.canHandle("https://www.another.test/anime/some-show-2-11111")).toBe(true);
    expect(extractor.canHandle(`${PAGES}/anime/some-show`)).toBe(false);
    expect(extractor.canHandle(`${ORIGIN}/ani/11111`)).toBe(false);
    expect(extractor.canHandle(`${ORIGIN}/embed/ani/11111/1/sub`)).toBe(false);
    expect(extractor.canHandle("https://other.test/anime/some-show-11111")).toBe(false);
    expect(extractor.canHandle("not an address")).toBe(false);
  });

  it("reads the whole season from one answer, in episode order, as season 1", async () => {
    const { http, requests } = fakeApi({ [SEASON_API]: full });
    const extraction = await createSeasonApiExtractor({ site, http }).extract(`${SEASON}/?x=1`);

    expect(requests).toEqual([{ url: SEASON_API, headers: { "user-agent": "Mozilla/5.0 test" } }]);
    expect(extraction.series).toEqual({
      externalId: "11111",
      sourceUrl: SEASON,
      title: "Some Show",
      year: 2016,
      plot: "Synopsis...",
      posterUrl: `${ORIGIN}/api/anime/cover?anilistId=11111&malId=22222`,
      remoteMarker: "1,2,3,5",
    });
    expect(extraction.seasons).toEqual([{ number: 1, episodeCount: 4 }]);
    expect(extraction.episodes.map((e) => [e.season, e.episode, e.title])).toEqual([
      [1, 1, "Episode 1"],
      [1, 2, "Second"],
      [1, 3, "Episode 3"],
      [1, 5, "Episode 5"],
    ]);
    expect(extraction.episodes[1]).toMatchObject({
      airDate: "2016-04-10",
      inferred: false,
      sourceRef: "11111:2",
      media: { kind: "mirrors", url: `${SEASON_API}?episode=2`, durationSec: 1464 },
    });
    expect(extraction.episodes[2]!.media).not.toHaveProperty("durationSec");
    expect(extraction.warnings.map((w) => w.code)).toEqual(["no-video", "gap"]);
    expect(extraction.warnings[1]!.message).toContain("4");
  });

  it("offers each episode's players in the wanted tracks, best first, only where the site has them", async () => {
    const { http } = fakeApi({ [SEASON_API]: full });
    const subFirst = createSeasonApiExtractor({ site, http });
    expect(await subFirst.resolveMirrors!(`${SEASON_API}?episode=1`)).toEqual([
      { url: `${ORIGIN}/embed/ani/11111/1/sub`, referer: `${PAGES}/` },
      { url: `${ORIGIN}/embed/ani/11111/1/dub`, referer: `${PAGES}/` },
    ]);
    expect(await subFirst.resolveMirrors!(`${SEASON_API}?episode=3`)).toEqual([
      { url: `${ORIGIN}/embed/ani/11111/3/sub`, referer: `${PAGES}/` },
    ]);

    const dubOnly = createSeasonApiExtractor({ site: parseSite({ tracks: ["dub"] }), http });
    expect(await dubOnly.resolveMirrors!(`${SEASON_API}?episode=1`)).toEqual([
      { url: `${ORIGIN}/embed/ani/11111/1/dub`, referer: `${PAGES}/` },
    ]);
    const dubbed = await dubOnly.extract(SEASON);
    expect(dubbed.episodes.map((e) => e.episode)).toEqual([1, 2, 5]);
  });

  it("refuses an episode address that is not its own, and one the site stopped listing", async () => {
    const extractor = createSeasonApiExtractor({
      site,
      http: fakeApi({ [SEASON_API]: full }).http,
    });
    await expect(extractor.resolveMirrors!(`${SEASON_API}`)).rejects.toMatchObject({
      code: "unsupported-url",
    });
    await expect(
      extractor.resolveMirrors!("https://other.test/api/partner/v1/series/11111?episode=1"),
    ).rejects.toMatchObject({ code: "unsupported-url" });
    await expect(extractor.resolveMirrors!(`${SEASON_API}?episode=9`)).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("gives the same marker as the extraction, and another once an episode gains a player", async () => {
    const { http } = fakeApi({ [SEASON_API]: full });
    const extractor = createSeasonApiExtractor({ site, http });
    expect(await extractor.remoteMarker!(SEASON)).toBe(
      (await extractor.extract(SEASON)).series.remoteMarker,
    );

    const later = fakeApi({ [SEASON_API]: answer([episode(1), episode(2), episode(3)]) });
    expect(await createSeasonApiExtractor({ site, http: later.http }).remoteMarker!(SEASON)).toBe(
      "1,2,3",
    );
  });

  it("reads a bare season like a wrapped one, and says when the site has none", async () => {
    const bare = fakeApi({ [SEASON_API]: season([episode(1), episode(2)]) });
    const read = await createSeasonApiExtractor({ site, http: bare.http }).extract(SEASON);
    expect(read.episodes.map((e) => e.episode)).toEqual([1, 2]);

    const none = fakeApi({ [SEASON_API]: { data: null, message: "Series not found" } });
    await expect(
      createSeasonApiExtractor({ site, http: none.http }).extract(SEASON),
    ).rejects.toMatchObject({
      code: "not-found",
      message: expect.stringContaining("Series not found"),
    });
  });

  it("says what is wrong when the season has no playable episode or an unknown shape", async () => {
    const empty = fakeApi({ [SEASON_API]: answer([episode(1, { sub: false, dub: false })]) });
    await expect(
      createSeasonApiExtractor({ site, http: empty.http }).extract(SEASON),
    ).rejects.toMatchObject({ code: "no-episodes" });

    const odd = fakeApi({ [SEASON_API]: { data: { title: "Some Show" } } });
    await expect(
      createSeasonApiExtractor({ site, http: odd.http }).extract(SEASON),
    ).rejects.toMatchObject({
      code: "invalid-response",
      message: expect.stringContaining("episodeList: "),
    });
  });

  it("refuses a site whose season path captures no id", () => {
    expect(() => parseSite({ seasonPath: "^/ani/\\d+$" })).toThrow();
    expect(() => parseSite({ tracks: ["latino"] })).toThrow();
  });
});
