import { ExtractorError, type HttpClient } from "@orca/extractor-core";
import { createHtmlExtractor, parseSitesFile } from "@orca/extractor-html";

export const ORIGIN = "https://origin.test";

/** A season (or a part of one) of the site, by its slug. */
export const seasonUrl = (slug: string) => `${ORIGIN}/anime/${slug}`;
export const episodeUrl = (slug: string, n: number) => `${seasonUrl(slug)}/episodio/episodio-${n}`;

/** The site as a sites file describes it: listing pages, then the players of each episode. */
const { sites } = parseSitesFile(
  JSON.stringify({
    sites: [
      {
        id: "site-a",
        name: "Site A",
        hosts: ["origin.test"],
        example: seasonUrl("some-show"),
        seasonPath: "^/anime/[^/]+$",
        title: { selector: "h1" },
        listing: {
          pages: {
            selector: "#episode-range-select option",
            attribute: "value",
            path: "{url}/episodes/{value}",
          },
          episodes: { selector: "a.episode-card" },
          number: "episodio-(\\d+)",
        },
        mirrors: { selector: "button.watch-server", attribute: "data-server-url" },
      },
    ],
  }),
);
export const SITE = sites[0]!;

/**
 * The site's pages, which a test changes as it goes: `season(slug, title, numbers)` lists episodes on
 * one listing page, `players(slug, n, urls)` sets the players of an episode.
 */
export class FakeSite {
  readonly pages = new Map<string, string>();
  readonly requests: string[] = [];

  readonly http: HttpClient = {
    getJson: () => Promise.reject(new Error("the site serves no JSON")),
    getText: (url) => {
      this.requests.push(url);
      const page = this.pages.get(url);
      return page === undefined
        ? Promise.reject(new ExtractorError("not-found", `No page ${url}`))
        : Promise.resolve(page);
    },
  };

  readonly extractor = createHtmlExtractor({ site: SITE, http: this.http });

  season(slug: string, title: string, numbers: number[]): this {
    const base = seasonUrl(slug);
    this.pages.set(
      base,
      `<h1>${title}</h1><select id="episode-range-select"><option value="1">all</option></select>`,
    );
    this.pages.set(
      `${base}/episodes/1`,
      numbers
        .map((n) => `<a class="episode-card" href="/anime/${slug}/episodio/episodio-${n}">${n}</a>`)
        .join(""),
    );
    return this;
  }

  players(slug: string, n: number, urls: string[]): this {
    this.pages.set(
      episodeUrl(slug, n),
      urls.map((url) => `<button class="watch-server" data-server-url="${url}"></button>`).join(""),
    );
    return this;
  }
}
