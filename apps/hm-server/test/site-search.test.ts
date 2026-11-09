import type { SearchResult, SiteExtractor } from "@orca/extractor-core";
import type { SiteSearchDto } from "@orca/hm-contract";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/infrastructure/web/app.ts";
import { LoginRateLimiter } from "../src/infrastructure/web/rate-limit.ts";
import { FakeSettingsRoutes } from "./fakes/ports.ts";
import { FAKE_URL, FakeExtractor } from "./fakes/extractor.ts";
import { createHarness, type Harness } from "./harness.ts";

/** A site that answers a search with what the test gives it, or fails when told to. */
function searchableSite(id: string, results: SearchResult[] | Error): SiteExtractor {
  return {
    id,
    name: id,
    hosts: [`${id}.example`],
    example: `https://${id}.example/series/x`,
    canHandle: (url) => new URL(url).hostname === `${id}.example`,
    extract: () => Promise.reject(new Error("not in this test")),
    search: async () => {
      if (results instanceof Error) throw results;
      return results;
    },
  };
}

const FOUND: SearchResult[] = [
  {
    kind: "series",
    url: "https://site.example/series/the-show",
    title: "The Show",
    originalTitle: "El Show",
    year: 2020,
    posterUrl: "https://site.example/uploads/the-show.webp",
  },
  { kind: "movie", url: "https://site.example/movie/a-film", title: "A Film" },
  {
    kind: "series",
    url: "https://site.example/series/other",
    title: "Other",
    posterUrl: "https://elsewhere.example/other.webp",
  },
];

let h: Harness;
let app: ReturnType<typeof createApp>;
let cookie: string;

beforeEach(async () => {
  h = await createHarness({
    extractors: [searchableSite("site", FOUND), searchableSite("down", new Error("offline"))],
  });
  app = createApp({
    useCases: h.useCases,
    events: h.bus,
    settings: new FakeSettingsRoutes(),
    secureCookies: false,
    sessionTtlMs: 3600 * 1000,
    loginLimiter: new LoginRateLimiter({ now: () => h.clock.now() }),
  });
  const login = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "sam", password: "secret" }),
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});
afterEach(() => h.cleanup());

const get = (path: string) => app.request(path, { headers: { cookie } });

describe("searching the sites", () => {
  it("says which extractors can be searched", async () => {
    const list = (await (await get("/api/extractors")).json()) as {
      id: string;
      searchable: boolean;
    }[];
    expect(list.map(({ id, searchable }) => [id, searchable])).toEqual([
      ["internet-archive", false],
      ["site", true],
      ["down", true],
    ]);
  });

  it("asks every searchable site, keeps the series and serves their posters through itself", async () => {
    const res = await get("/api/search?q=show");
    expect(res.status).toBe(200);
    const poster = `/api/search/poster?${new URLSearchParams({
      extractor: "site",
      url: "https://site.example/uploads/the-show.webp",
    }).toString()}`;
    expect((await res.json()) as SiteSearchDto[]).toEqual([
      {
        extractorId: "site",
        failed: false,
        results: [
          {
            url: "https://site.example/series/the-show",
            title: "The Show",
            originalTitle: "El Show",
            year: 2020,
            plot: null,
            posterUrl: poster,
            seriesId: null,
          },
          // A poster on another host is never fetched for the panel.
          {
            url: "https://site.example/series/other",
            title: "Other",
            originalTitle: null,
            year: null,
            plot: null,
            posterUrl: null,
            seriesId: null,
          },
        ],
      },
      { extractorId: "down", failed: true, results: [] },
    ]);

    const image = await get(poster);
    expect(image.status).toBe(200);
    expect(h.images.hosts.at(-1)).toEqual(["site.example"]);
  });

  it("refuses a query too short to be worth asking, and a poster off the extractor's hosts", async () => {
    expect((await get("/api/search?q=ab")).status).toBe(400);
    const elsewhere = new URLSearchParams({
      extractor: "site",
      url: "https://elsewhere.example/other.webp",
    });
    expect((await get(`/api/search/poster?${elsewhere.toString()}`)).status).toBe(404);
  });
});

describe("a search whose posters live on an images server of its own", () => {
  it("serves posters from the hosts the search names, and still from no other", async () => {
    const site: SiteExtractor = {
      ...searchableSite("site", [
        {
          kind: "series",
          url: "https://site.example/series/the-show",
          title: "The Show",
          posterUrl: "https://images.example/the-show.webp",
        },
      ]),
      posterHosts: ["images.example"],
    };
    const own = await createHarness({ extractors: [site] });
    try {
      const [found] = await own.useCases.searchSites("show");
      expect(found?.results[0]?.posterUrl).toBe(
        `/api/search/poster?${new URLSearchParams({ extractor: "site", url: "https://images.example/the-show.webp" }).toString()}`,
      );
      await own.useCases.searchPoster("site", "https://images.example/the-show.webp");
      expect(own.images.hosts.at(-1)).toEqual(["site.example", "images.example"]);
      await expect(
        own.useCases.searchPoster("site", "https://elsewhere.example/x.webp"),
      ).rejects.toMatchObject({ code: "not_found" });
    } finally {
      await own.cleanup();
    }
  });
});

describe("a search result that is a series already", () => {
  it("names the series any season of that show was added to", async () => {
    const fake = Object.assign(new FakeExtractor(), {
      search: async (): Promise<SearchResult[]> => [
        // The show's address, where the source was added at its first season's.
        { kind: "series", url: `${FAKE_URL}/`, title: "Fake" },
        { kind: "series", url: "https://fake.example/other", title: "Other" },
        // The same show on another of the site's domains.
        {
          kind: "series",
          url: `${FAKE_URL.replace("fake.example", "mirror.example")}/`,
          title: "Mirror",
        },
      ],
    });
    const own = await createHarness({ extractors: [fake] });
    try {
      const preview = await own.useCases.previewSeries(`${FAKE_URL}?season=1`, undefined, "fake");
      const series = await own.useCases.addSeries({
        previewId: preview.previewId,
        title: "Fake",
        year: 2020,
        episodeKeys: [],
        follow: false,
        downloadNow: false,
      });
      const [site] = await own.useCases.searchSites("fake");
      expect(site?.results.map((result) => [result.title, result.seriesId])).toEqual([
        ["Fake", series.id],
        ["Other", null],
        ["Mirror", series.id],
      ]);
    } finally {
      await own.cleanup();
    }
  });

  it("knows a series added by a season's address as the show the site finds", async () => {
    const SHOW_URL = "https://fake.example/show/fake";
    const fake = Object.assign(new FakeExtractor(), {
      // As a site whose seasons each have a page and whose search finds the show's.
      showUrl: (url: string) => (url.startsWith(FAKE_URL) ? SHOW_URL : null),
      search: async (): Promise<SearchResult[]> => [
        { kind: "series", url: `${SHOW_URL}/`, title: "Fake" },
      ],
    });
    const own = await createHarness({ extractors: [fake] });
    try {
      const preview = await own.useCases.previewSeries(`${FAKE_URL}?season=1`, undefined, "fake");
      const series = await own.useCases.addSeries({
        previewId: preview.previewId,
        title: "Fake",
        year: 2020,
        episodeKeys: [],
        follow: false,
        downloadNow: false,
      });
      const [site] = await own.useCases.searchSites("fake");
      expect(site?.results.map((result) => result.seriesId)).toEqual([series.id]);
    } finally {
      await own.cleanup();
    }
  });
});
