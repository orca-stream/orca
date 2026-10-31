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
