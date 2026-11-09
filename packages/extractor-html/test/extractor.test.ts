import { describe, expect, it } from "vite-plus/test";
import { ExtractorError, type HttpClient } from "@orca/extractor-core";
import { createHtmlExtractor } from "../src/extractor.ts";
import { SiteConfig } from "../src/site.ts";

const ORIGIN = "https://origin.test";
const SEASON = `${ORIGIN}/anime/random-anime`;

/** A site shaped like the one this extractor was written for: episodes spread over listing pages. */
const site: SiteConfig = SiteConfig.parse({
  id: "site-a",
  name: "Site A",
  hosts: ["origin.test"],
  example: `${SEASON}`,
  seasonPath: "^/anime/[^/]+$",
  userAgent: "Mozilla/5.0 test",
  title: { selector: "h1.title" },
  listing: {
    pages: {
      selector: "#episode-range-select option",
      attribute: "value",
      path: "{url}/episodes/{value}",
    },
    episodes: { selector: "a.episode-card", title: { selector: ".name" } },
    number: "episodio-(\\d+)",
  },
  mirrors: { selector: "button.watch-server", attribute: "data-server-url" },
});

const card = (n: number, name?: string) =>
  `<a class="episode-card" href="/anime/random-anime/episodio/episodio-${n}">${name ? `<span class="name">${name}</span>` : ""}</a>`;

/** An HttpClient that answers pages from a map and remembers what was asked, with its headers. */
function fakePages(pages: Record<string, string>) {
  const requests: { url: string; headers: Record<string, string> | undefined }[] = [];
  const http: HttpClient = {
    getJson: () => Promise.reject(new Error("no JSON here")),
    getText(url, options) {
      requests.push({ url, headers: options?.headers });
      const page = pages[url];
      return page === undefined
        ? Promise.reject(new ExtractorError("not-found", `No page ${url}`))
        : Promise.resolve(page);
    },
  };
  return { http, requests };
}

const seasonPages = () => ({
  [SEASON]: `<h1 class="title">Random Anime</h1>
    <select id="episode-range-select"><option value="1">1-2</option><option value="2">3-4</option></select>`,
  [`${SEASON}/episodes/1`]: card(1, "The beginning") + card(2),
  // A listing page that repeats an episode of the page before, and skips one.
  [`${SEASON}/episodes/2`]: card(2) + card(4, "The end"),
});

describe("HTML extractor: the season", () => {
  it("claims the season addresses of its hosts, and nothing else", () => {
    const { http } = fakePages({});
    const extractor = createHtmlExtractor({ site, http });
    expect(extractor.canHandle(SEASON)).toBe(true);
    expect(extractor.canHandle(`${SEASON}/`)).toBe(true);
    expect(extractor.canHandle(`https://www.origin.test/anime/random-anime?x=1`)).toBe(true);
    expect(extractor.canHandle(`${SEASON}/episodio/episodio-1`)).toBe(false);
    expect(extractor.canHandle("https://other.test/anime/random-anime")).toBe(false);
    expect(extractor.canHandle("not an address")).toBe(false);
  });

  it("reads every listing page, in order, without repeating an episode", async () => {
    const { http, requests } = fakePages(seasonPages());
    const extraction = await createHtmlExtractor({ site, http }).extract(`${SEASON}/`);

    expect(requests.map((request) => request.url)).toEqual([
      SEASON,
      `${SEASON}/episodes/1`,
      `${SEASON}/episodes/2`,
    ]);
    expect(extraction.series).toEqual({
      externalId: "/anime/random-anime",
      sourceUrl: SEASON,
      title: "Random Anime",
    });
    expect(extraction.episodes.map((e) => [e.season, e.episode, e.title, e.sourceRef])).toEqual([
      [1, 1, "The beginning", "/anime/random-anime/episodio/episodio-1"],
      [1, 2, "Episode 2", "/anime/random-anime/episodio/episodio-2"],
      [1, 4, "The end", "/anime/random-anime/episodio/episodio-4"],
    ]);
    expect(extraction.episodes[0]?.media).toEqual({
      kind: "mirrors",
      url: `${SEASON}/episodio/episodio-1`,
      fileName: "video",
    });
    expect(extraction.warnings).toEqual([{ code: "gap", message: "Missing episode numbers: 3" }]);
  });

  it("sends the site's User-Agent, and the season as the Referer of its listing pages", async () => {
    const { http, requests } = fakePages(seasonPages());
    await createHtmlExtractor({ site, http }).extract(SEASON);
    expect(requests[0]?.headers).toEqual({ "user-agent": "Mozilla/5.0 test" });
    expect(requests[1]?.headers).toEqual({ "user-agent": "Mozilla/5.0 test", referer: SEASON });
  });

  it("leaves out episode links to another host: their pages are read by the server later", async () => {
    const { http } = fakePages({
      [SEASON]: `<main>${card(1)}<a class="episode-card" href="https://elsewhere.test/episodio-2"></a></main>`,
    });
    const extraction = await createHtmlExtractor({ site, http }).extract(SEASON);
    expect(extraction.episodes.map((e) => e.episode)).toEqual([1]);
  });

  it("reads the episodes off the season page itself when it lists no pages", async () => {
    const { http } = fakePages({ [SEASON]: `<main>${card(7)}${card(8)}</main>` });
    const extraction = await createHtmlExtractor({ site, http }).extract(SEASON);
    expect(extraction.episodes.map((e) => e.episode)).toEqual([7, 8]);
    // No title on the page: the address names it.
    expect(extraction.series.title).toBe("random anime");
  });

  it("says so when the page lists no episodes", async () => {
    const { http } = fakePages({ [SEASON]: "<main>nothing here</main>" });
    await expect(createHtmlExtractor({ site, http }).extract(SEASON)).rejects.toMatchObject({
      code: "no-episodes",
    });
  });

  it("refuses an address that is not a season of this site", async () => {
    const { http, requests } = fakePages({});
    await expect(
      createHtmlExtractor({ site, http }).extract(`${SEASON}/episodio/episodio-1`),
    ).rejects.toMatchObject({ code: "unsupported-url" });
    expect(requests).toEqual([]);
  });
});

describe("HTML extractor: the players of an episode", () => {
  it("lists each player once, absolute, with the episode page as its Referer", async () => {
    const episode = `${SEASON}/episodio/episodio-1`;
    const { http } = fakePages({
      [episode]: `
        <button class="watch-server" data-server-url="https://player-one.test/e/abc">One</button>
        <button class="watch-server" data-server-url="//player-two.test/v/xyz">Two</button>
        <button class="watch-server" data-server-url="https://player-one.test/e/abc">Again</button>
        <button class="watch-server" data-server-url="javascript:alert(1)">Bad</button>
        <button class="watch-server">No address</button>`,
    });
    const mirrors = await createHtmlExtractor({ site, http }).resolveMirrors!(episode);
    expect(mirrors).toEqual([
      { url: "https://player-one.test/e/abc", referer: episode },
      { url: "https://player-two.test/v/xyz", referer: episode },
    ]);
  });
});

/** A site that groups the seasons on a show page, numbers episodes `SxE` and hides its players. */
const SHOW = `${ORIGIN}/serie/some-show`;
const seasonsSite: SiteConfig = SiteConfig.parse({
  id: "site-c",
  name: "Site C",
  hosts: ["origin.test"],
  example: `${SHOW}/`,
  seasonPath: "^/temporada/[^/]+-\\d+$",
  listing: {
    episodes: { selector: "div.item-season-episodes > a" },
    number: "\\d+x(\\d+)/?$",
  },
  seasons: {
    showPath: "^/serie/[^/]+$",
    show: { from: "^/temporada/(.+)-\\d+$", to: "/serie/{1}/" },
    links: { selector: "p.item-season-title a" },
    number: "-(\\d+)$",
  },
  mirrors: {
    selector: ".tab-video-item > ul > li[role=presentation]",
    attribute: "data-server",
    decode: "base64",
    unwrap: "url",
  },
});

const seasonLink = (n: number) =>
  `<p class="item-season-title"><a href="${ORIGIN}/temporada/some-show-${n}/">Temporada ${n}</a></p>`;
const episodeLink = (season: number, n: number) =>
  `<a href="${ORIGIN}/episodio/some-show-${season}x${n}/">${season}x${n}</a>`;

const showPages = () => ({
  // Listed out of order, with a repeat and a link elsewhere.
  [SHOW]:
    seasonLink(2) +
    seasonLink(1) +
    seasonLink(10) +
    seasonLink(2) +
    `<p class="item-season-title"><a href="https://elsewhere.test/temporada/x-3/">Other</a></p>`,
  [`${ORIGIN}/temporada/some-show-1`]: `<div class="item-season-episodes">${episodeLink(1, 1)}${episodeLink(1, 2)}</div>`,
  [`${ORIGIN}/temporada/some-show-2`]: `<div class="item-season-episodes">${episodeLink(2, 1)}${episodeLink(2, 74)}</div>
    <div class="related">${episodeLink(9, 9)}</div>`,
});

describe("HTML extractor: a show with its seasons on a page of their own", () => {
  it("claims both the show and its seasons", () => {
    const extractor = createHtmlExtractor({ site: seasonsSite, http: fakePages({}).http });
    expect(extractor.canHandle(`${SHOW}/`)).toBe(true);
    expect(extractor.canHandle(`${ORIGIN}/temporada/some-show-2/`)).toBe(true);
    expect(extractor.canHandle(`${ORIGIN}/episodio/some-show-2x1/`)).toBe(false);
  });

  it("reads a season under its own number, with the episode number from the SxE address", async () => {
    const { http } = fakePages(showPages());
    const extraction = await createHtmlExtractor({ site: seasonsSite, http }).extract(
      `${ORIGIN}/temporada/some-show-2/`,
    );
    expect(extraction.series.sourceUrl).toBe(`${ORIGIN}/temporada/some-show-2`);
    expect(extraction.seasons).toEqual([{ number: 2, episodeCount: 2 }]);
    expect(extraction.episodes.map((e) => [e.season, e.episode, e.media.url])).toEqual([
      [2, 1, `${ORIGIN}/episodio/some-show-2x1`],
      [2, 74, `${ORIGIN}/episodio/some-show-2x74`],
    ]);
  });

  it("takes a pasted show for its first season", async () => {
    const { http } = fakePages(showPages());
    const extraction = await createHtmlExtractor({ site: seasonsSite, http }).extract(`${SHOW}/`);
    expect(extraction.series.sourceUrl).toBe(`${ORIGIN}/temporada/some-show-1`);
    expect(extraction.episodes.map((e) => [e.season, e.episode])).toEqual([
      [1, 1],
      [1, 2],
    ]);
  });

  it("knows the show of a season, and of the show itself", () => {
    const extractor = createHtmlExtractor({ site: seasonsSite, http: fakePages({}).http });
    expect(extractor.showUrl!(`${ORIGIN}/temporada/some-show-2/`)).toBe(SHOW);
    expect(extractor.showUrl!(`${SHOW}/`)).toBe(SHOW);
    expect(extractor.showUrl!("https://elsewhere.test/temporada/x-3/")).toBeNull();
  });

  it("reads the show's name out of the words the page adds to it", async () => {
    const page = `<h1 class="title"><span itemprop="name"> Watch Some Show </span></h1>
      <div class="item-season-episodes">${episodeLink(1, 1)}</div>`;
    const read = (match: string) =>
      createHtmlExtractor({
        site: SiteConfig.parse({
          ...seasonsSite,
          title: { selector: "h1 [itemprop=name]", match },
        }),
        http: fakePages({ [`${ORIGIN}/temporada/some-show-1`]: page }).http,
      }).extract(`${ORIGIN}/temporada/some-show-1/`);
    expect((await read("^Watch (.+)$")).series.title).toBe("Some Show");
    // A page that writes it otherwise: the address names it.
    expect((await read("^Ver (.+)$")).series.title).toBe("some show 1");
  });

  it("lists the show's seasons from any of them, lowest first, once each, only its own", async () => {
    const { http, requests } = fakePages(showPages());
    const sources = await createHtmlExtractor({ site: seasonsSite, http }).seasonSources!(
      `${ORIGIN}/temporada/some-show-2/`,
    );
    expect(requests.map((r) => r.url)).toEqual([SHOW]);
    expect(sources).toEqual([
      { season: 1, url: `${ORIGIN}/temporada/some-show-1` },
      { season: 2, url: `${ORIGIN}/temporada/some-show-2` },
      { season: 10, url: `${ORIGIN}/temporada/some-show-10` },
    ]);
  });

  it("suggests the next season after a season, and nothing after a show", () => {
    const extractor = createHtmlExtractor({ site: seasonsSite, http: fakePages({}).http });
    expect(extractor.nextSourceUrl!(`${ORIGIN}/temporada/some-show-9/`)).toBe(
      `${ORIGIN}/temporada/some-show-10`,
    );
    expect(extractor.nextSourceUrl!(`${SHOW}/`)).toBeNull();
  });

  it("has no seasons to list or suggest when the site doesn't group them", () => {
    const extractor = createHtmlExtractor({ site, http: fakePages({}).http });
    // A followed series asks for seasons only of an extractor that has them.
    expect("seasonSources" in extractor).toBe(false);
    expect("nextSourceUrl" in extractor).toBe(false);
  });

  it("decodes each player and takes the one a wrapper frames, framed by it", async () => {
    const episode = `${ORIGIN}/episodio/some-show-1x1`;
    const wrapper = "https://wrapper.test/iframe/?url=https%3A%2F%2Fplayer-two.test%2Fe%2Fxyz";
    const item = (address: string) =>
      `<li role="presentation" data-server="${btoa(address)}"></li>`;
    const { http } = fakePages({
      [episode]: `<div class="tab-video-item"><ul>
        ${item("https://wrapper.test/watch/abc")}
        ${item(wrapper)}
        ${item(wrapper)}
        <li role="presentation" data-server="%%not base64%%"></li>
        <li role="tab" data-server="${btoa("https://ignored.test/")}"></li>
      </ul></div>`,
    });
    const mirrors = await createHtmlExtractor({ site: seasonsSite, http }).resolveMirrors!(episode);
    expect(mirrors).toEqual([
      { url: "https://wrapper.test/watch/abc", referer: episode },
      { url: "https://player-two.test/e/xyz", referer: wrapper },
    ]);
  });
});

describe("a site's description", () => {
  it("lists every problem by where it is", () => {
    const parsed = SiteConfig.safeParse({
      id: "Site A",
      name: "",
      hosts: ["https://x.test"],
      example: "nope",
      listing: {},
      mirrors: {},
    });
    expect(parsed.success).toBe(false);
    const paths = parsed.error!.issues.map((issue) => issue.path.join("."));
    for (const path of [
      "id",
      "name",
      "hosts.0",
      "example",
      "listing.episodes",
      "mirrors.selector",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("refuses a pattern that does not compile", () => {
    const parsed = SiteConfig.safeParse({ ...site, seasonPath: "([" });
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toEqual(["seasonPath"]);
  });
});

describe("HTML extractor: a movie on a page of its own", () => {
  const movieSite = SiteConfig.parse({
    ...seasonsSite,
    movies: {
      path: "^/pelicula/[^/]+$",
      title: { selector: "h1 [itemprop=name]", match: "^Ver Película (.+)$" },
      year: { selector: "p.meta" },
    },
  });
  const MOVIE = `${ORIGIN}/pelicula/a-film`;

  it("claims a movie's address beside the show's and the seasons', and says it is a movie", () => {
    const extractor = createHtmlExtractor({ site: movieSite, http: fakePages({}).http });
    expect(extractor.canHandle(`${MOVIE}/`)).toBe(true);
    expect(extractor.canHandle(`${SHOW}/`)).toBe(true);
    // Without `movies`, a movie's page is not this extractor's.
    const showsOnly = createHtmlExtractor({ site: seasonsSite, http: fakePages({}).http });
    expect(showsOnly.canHandle(`${MOVIE}/`)).toBe(false);
    // A movie has no show, no next season and no seasons to list.
    expect(extractor.showUrl!(`${MOVIE}/`)).toBeNull();
    expect(extractor.nextSourceUrl!(`${MOVIE}/`)).toBeNull();
  });

  it("reads a movie as one video, its name and year from the page, its players as an episode's", async () => {
    const { http } = fakePages({
      [MOVIE]: `<h1><span itemprop="name"> Ver Película A Film </span></h1>
        <p class="meta"><span>1h 35min</span> · <span>2004</span></p>
        <div class="tab-video-item"><ul><li role="presentation" data-server="${btoa("https://player.test/e/1")}"></li></ul></div>`,
    });
    const extractor = createHtmlExtractor({ site: movieSite, http });
    const extraction = await extractor.extract(`${MOVIE}/`);
    expect(extraction.series).toMatchObject({ title: "A Film", year: 2004, sourceUrl: MOVIE });
    expect(extraction.episodes.map((e) => [e.season, e.episode, e.media.url])).toEqual([
      [1, 1, MOVIE],
    ]);
    expect(await extractor.seasonSources!(`${MOVIE}/`)).toEqual([]);
    expect(await extractor.resolveMirrors!(MOVIE)).toEqual([
      { url: "https://player.test/e/1", referer: MOVIE },
    ]);
  });
});
