import { describe, expect, it } from "vite-plus/test";
import { createSearch, ExtractorError, rankByTitle, type HttpClient } from "../src/index.ts";
import { JsonSearch, SiteSearch } from "../src/site.ts";

const ORIGIN = "https://origin.test";

/** Shaped like the site the search was written for: the posts of every kind, latest updated first. */
const answer = {
  error: false,
  data: {
    posts: [
      {
        title: "Mar de fondo",
        original_title: "Mar de fondo",
        slug: "mar-de-fondo",
        type: "movies",
        release_date: "2026-09-09",
        images: { poster: "/thumbs/a.webp" },
      },
      {
        title: "La casa del mar",
        original_title: "The Sea House",
        slug: "la-casa-del-mar",
        type: "tvshows",
        release_date: "2006-09-04",
        overview: "A house.",
        images: { poster: "/thumbs/b.webp" },
      },
      {
        title: "Marea",
        original_title: "",
        slug: "marea",
        type: "animes",
        release_date: "",
        images: { poster: null },
      },
      { title: "Sin tipo", slug: "sin-tipo", type: "shorts" },
      { title: "Sin dirección", slug: "", type: "tvshows" },
      { title: "Marea", slug: "marea", type: "animes" },
    ],
  },
};

const search = JsonSearch.parse({
  reads: "json",
  url: `${ORIGIN}/wp-api/v1/search?postType=any&postsPerPage=30&q={query}`,
  items: "data.posts",
  type: { from: "{type}", series: ["tvshows", "animes"], movie: ["movies"] },
  result: {
    url: { series: "/series/{slug}" },
    title: "{title}",
    originalTitle: "{original_title}",
    year: "{release_date}",
    plot: "{overview}",
    poster: `${ORIGIN}/wp-content/uploads{images.poster}`,
  },
});

function setup(body: unknown = answer) {
  const asked: { url: string; headers: Record<string, string> | undefined }[] = [];
  const http: HttpClient = {
    getJson: async (url, options) => {
      asked.push({ url, headers: options?.headers });
      return body;
    },
  };
  const run = createSearch({
    site: { name: "Site B", example: `${ORIGIN}/series/x`, userAgent: "UA test", search },
    http,
    canHandle: (url) => new URL(url).pathname.startsWith("/series/"),
  });
  return { run, asked };
}

describe("createSearch", () => {
  it("asks the site with the query in its slot and the site's User-Agent", async () => {
    const { run, asked } = setup();
    await run("  la casa ");
    expect(asked).toEqual([
      {
        url: `${ORIGIN}/wp-api/v1/search?postType=any&postsPerPage=30&q=la%20casa`,
        headers: { "user-agent": "UA test" },
      },
    ]);
  });

  it("keeps the series, at the address the extractor reads, best match first", async () => {
    const { run } = setup();
    expect(await run("marea")).toEqual([
      { kind: "series", url: `${ORIGIN}/series/marea`, title: "Marea", label: "animes" },
      {
        kind: "series",
        url: `${ORIGIN}/series/la-casa-del-mar`,
        title: "La casa del mar",
        originalTitle: "The Sea House",
        year: 2006,
        plot: "A house.",
        posterUrl: `${ORIGIN}/wp-content/uploads/thumbs/b.webp`,
        label: "tvshows",
      },
    ]);
  });

  it("leaves out a kind with no address, a word it doesn't know and an empty slot", async () => {
    const { run } = setup();
    const titles = (await run("mar")).map((result) => result.title);
    expect(titles).not.toContain("Mar de fondo");
    expect(titles).not.toContain("Sin tipo");
    expect(titles).not.toContain("Sin dirección");
  });

  it("takes what the address says over the site's word, when the extractor knows its movies' path", async () => {
    const http: HttpClient = { getJson: async () => answer };
    const run = createSearch({
      site: { name: "Site B", example: `${ORIGIN}/series/x`, search },
      http,
      canHandle: () => true,
      // Marea's address is a movie's, whatever the site calls it.
      kindOf: (url) => (url.endsWith("/marea") ? "movie" : null),
    });
    const found = await run("marea");
    expect(found.find((result) => result.title === "Marea")?.kind).toBe("movie");
    expect(found.find((result) => result.title === "La casa del mar")?.kind).toBe("series");
  });

  it("never offers what the extractor would not read", async () => {
    const http: HttpClient = { getJson: async () => answer };
    const run = createSearch({
      site: { name: "Site B", example: `${ORIGIN}/series/x`, search },
      http,
      canHandle: () => false,
    });
    expect(await run("mar")).toEqual([]);
  });

  it("asks nothing for an empty query", async () => {
    const { run, asked } = setup();
    expect(await run("   ")).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("says so when the answer has no list where the file says", async () => {
    const { run } = setup({ error: true, data: null });
    await expect(run("mar")).rejects.toBeInstanceOf(ExtractorError);
  });
});

describe("createSearch, paged", () => {
  const post = (slug: string) => ({ title: slug, slug, type: "tvshows" });
  const paged = (extra: Partial<JsonSearch>) =>
    JsonSearch.parse({ ...search, url: `${ORIGIN}/search?q={query}&page={page}`, ...extra });

  function pagedSetup(config: JsonSearch, pages: unknown[][], lastPage?: number) {
    const asked: string[] = [];
    const http: HttpClient = {
      getJson: async (url) => {
        asked.push(url);
        const page = Number(new URL(url).searchParams.get("page") ?? 1);
        return {
          data: {
            posts: pages[page - 1] ?? [],
            ...(lastPage === undefined ? {} : { pagination: { last_page: lastPage } }),
          },
        };
      },
    };
    const run = createSearch({
      site: { name: "Site B", example: `${ORIGIN}/series/x`, search: config },
      http,
      canHandle: () => true,
    });
    return { run, asked };
  }

  it("reads page after page until one comes empty", async () => {
    const { run, asked } = pagedSetup(paged({}), [[post("a1")], [post("a2")]]);
    expect((await run("a")).map((result) => result.title)).toEqual(["a1", "a2"]);
    expect(asked).toEqual([1, 2, 3].map((page) => `${ORIGIN}/search?q=a&page=${page}`));
  });

  it("stops at the last page the answer names", async () => {
    const { run, asked } = pagedSetup(
      paged({ lastPage: "data.pagination.last_page" }),
      [[post("a1")], [post("a2")], [post("a3")]],
      2,
    );
    expect(await run("a")).toHaveLength(2);
    expect(asked).toHaveLength(2);
  });

  it("reads five pages at most", async () => {
    const pages = Array.from({ length: 8 }, (_, index) => [post(`a${index}`)]);
    const { run, asked } = pagedSetup(paged({}), pages);
    expect(await run("a")).toHaveLength(5);
    expect(asked).toHaveLength(5);
  });

  it("asks once when the address has no page slot", async () => {
    const { run, asked } = pagedSetup(search, [[post("a1")], [post("a2")]]);
    expect(await run("a")).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });
});

describe("createSearch, by POST", () => {
  const GRAPHQL = "https://graphql.origin.test/";
  const IMAGES = "https://images.origin.test";
  const query =
    "query($search:String,$page:Int){ Page(page:$page){ media(search:$search){ id } } }";
  const graph = JsonSearch.parse({
    reads: "json",
    url: GRAPHQL,
    body: { query, variables: { search: "{query}", page: "{page}", perPage: 20 } },
    items: "data.Page.media",
    nextPage: "data.Page.pageInfo.hasNextPage",
    type: { from: "{format}", series: ["TV", "ONA"], movie: ["MOVIE"] },
    result: {
      url: { series: "/anime/{title.english|title.romaji|title.native|'anime':slug(60)}-{id}" },
      title: "{title.english|title.romaji|title.native}",
      originalTitle: "{title.romaji}",
      year: "{seasonYear}",
      plot: "{description}",
      poster: "{coverImage.extraLarge|coverImage.large}",
    },
    posterHosts: ["images.origin.test"],
  });
  const media = (id: number, title: Record<string, string | null>, extra: object = {}) => ({
    id,
    title: { romaji: null, english: null, native: null, ...title },
    format: "TV",
    coverImage: { extraLarge: null, large: `${IMAGES}/${id}.jpg` },
    ...extra,
  });

  function graphSetup(pages: { media: unknown[]; hasNextPage: boolean }[]) {
    const asked: { url: string; body: unknown; headers: Record<string, string> | undefined }[] = [];
    const http: HttpClient = {
      getJson: async () => {
        throw new Error("a POST search never GETs");
      },
      postJson: async (url, body, options) => {
        asked.push({ url, body, headers: options?.headers });
        const page = (body as { variables: { page: number } }).variables.page;
        const answer = pages[page - 1] ?? { media: [], hasNextPage: false };
        return {
          data: { Page: { pageInfo: { hasNextPage: answer.hasNextPage }, media: answer.media } },
        };
      },
    };
    const run = createSearch({
      site: {
        name: "Site D",
        example: "https://another.test/anime/x-1",
        userAgent: "UA",
        search: graph,
      },
      http,
      canHandle: (url) => /^\/anime\/[^/]*-(\d+)\/?$/.test(new URL(url).pathname),
    });
    return { run, asked };
  }

  it("posts the body with what was typed as text and the page as a number", async () => {
    const { run, asked } = graphSetup([{ media: [], hasNextPage: false }]);
    await run(' spy "x" ');
    expect(asked).toEqual([
      {
        url: GRAPHQL,
        body: { query, variables: { search: 'spy "x"', page: 1, perPage: 20 } },
        headers: { "user-agent": "UA" },
      },
    ]);
  });

  it("reads the next page only while the answer says there is one", async () => {
    const { run, asked } = graphSetup([
      { media: [media(1, { romaji: "Spy A" })], hasNextPage: true },
      { media: [media(2, { romaji: "Spy B" })], hasNextPage: false },
      { media: [media(3, { romaji: "Spy C" })], hasNextPage: false },
    ]);
    expect((await run("spy")).map((result) => result.title)).toEqual(["Spy A", "Spy B"]);
    expect(asked).toHaveLength(2);
  });

  it("builds the address from the first title there is, as the site writes it", async () => {
    const { run } = graphSetup([
      {
        media: [
          media(140960, { english: "SPY x FAMILY", romaji: "SPY×FAMILY" }),
          media(15111, { romaji: "Spy Pengüin" }),
          media(7, { native: "スパイ教室" }),
          media(8, { english: "A".repeat(59) + " long tail" }),
        ],
        hasNextPage: false,
      },
    ]);
    expect((await run("spy")).map((result) => result.url)).toEqual([
      "https://another.test/anime/spy-x-family-140960",
      "https://another.test/anime/spy-penguin-15111",
      "https://another.test/anime/anime-7",
      `https://another.test/anime/${"a".repeat(59)}-8`,
    ]);
  });

  it("reads titles and plots written in HTML as text", async () => {
    const { run } = graphSetup([
      {
        media: [
          media(
            1,
            { english: "Love, Death &amp; Robots", romaji: "Ai &#x26; Shi" },
            { description: "A family.<br>\n<br>(Source: <i>Somewhere</i>) &quot;ok&quot;" },
          ),
        ],
        hasNextPage: false,
      },
    ]);
    expect(await run("love")).toEqual([
      {
        kind: "series",
        url: "https://another.test/anime/love-death-amp-robots-1",
        title: "Love, Death & Robots",
        originalTitle: "Ai & Shi",
        plot: 'A family. (Source: Somewhere) "ok"',
        posterUrl: `${IMAGES}/1.jpg`,
        label: "TV",
      },
    ]);
  });

  it("can't search by POST through a client that only GETs", async () => {
    const run = createSearch({
      site: { name: "Site D", example: "https://another.test/anime/x-1", search: graph },
      http: { getJson: async () => ({}) },
      canHandle: () => true,
    });
    await expect(run("spy")).rejects.toBeInstanceOf(ExtractorError);
  });
});

describe("rankByTitle", () => {
  const titled = (title: string, originalTitle?: string) => ({
    title,
    ...(originalTitle ? { originalTitle } : {}),
  });

  it("puts the same title first, then the ones it starts, then a word, then anywhere", () => {
    const ranked = rankByTitle(
      [
        titled("Submarino"),
        titled("El mar"),
        titled("Marea alta"),
        titled("Otra cosa"),
        titled("Mar"),
      ],
      "mar",
    );
    expect(ranked.map((result) => result.title)).toEqual([
      "Mar",
      "Marea alta",
      "El mar",
      "Submarino",
      "Otra cosa",
    ]);
  });

  it("ignores accents and case, and counts the original title", () => {
    const ranked = rankByTitle([titled("Otra"), titled("La isla", "Ísla Négra")], "isla negra");
    expect(ranked[0]?.title).toBe("La isla");
  });
});

describe("JsonSearch", () => {
  it("refuses a search address without the query's slot", () => {
    const result = JsonSearch.safeParse({
      reads: "json",
      url: `${ORIGIN}/search`,
      result: { url: { series: "/series/{slug}" }, title: "{title}" },
    });
    expect(result.success).toBe(false);
  });

  it("takes the query's slot in the body of a POST search", () => {
    const result = JsonSearch.safeParse({
      reads: "json",
      url: `${ORIGIN}/graphql`,
      body: { variables: { search: "{query}" } },
      result: { url: { series: "/series/{slug}" }, title: "{title}" },
    });
    expect(result.success).toBe(true);
  });
});

describe("createSearch, on the site's search page", () => {
  const page = `<html><body><h2>Resultados de búsqueda para: spy</h2>
    <div class="movie-item"><a href="/pelicula/spy-una-espia/"><img src="//s.origin.test/p/a.webp" class="poster" alt="Spy"><span class="year"></span></a><div class="item-detail"><p>Spy</p></div></div>
    <div class="movie-item"><a href="/serie/london-spy/"><img src="//s.origin.test/p/b.webp" class="poster" alt="London Spy"><span class="year">2015</span></a><div class="item-detail"><p>London Spy</p></div></div>
    <div class="movie-item"><a href="/serie/spy-x-family/"><img class="poster" alt="Spy &amp; Family"><span class="year"></span></a><div class="item-detail"><p>Spy &amp; Family</p></div></div>
    <div class="movie-item"><a href="/serie/sin-titulo/"></a><div class="item-detail"><p> </p></div></div>
    <div class="movie-item"><a href="/serie/london-spy/"></a><div class="item-detail"><p>London Spy</p></div></div>
  </body></html>`;

  const htmlSearch = SiteSearch.parse({
    reads: "html",
    url: `${ORIGIN}/?s={query}`,
    items: "div.movie-item",
    result: {
      url: { selector: "a" },
      title: { selector: ".item-detail p" },
      year: { selector: "span.year" },
      poster: { selector: "img.poster", attribute: "src" },
    },
  });

  function htmlSetup(http: Partial<HttpClient> = {}) {
    const asked: { url: string; headers: Record<string, string> | undefined }[] = [];
    const run = createSearch({
      site: {
        name: "Site C",
        example: `${ORIGIN}/serie/x/`,
        userAgent: "UA test",
        search: htmlSearch,
      },
      http: {
        getJson: async () => {
          throw new Error("not asked");
        },
        getText: async (url, options) => {
          asked.push({ url, headers: options?.headers });
          return page;
        },
        ...http,
      },
      canHandle: (url) => new URL(url).pathname.startsWith("/serie/"),
    });
    return { run, asked };
  }

  it("reads the page with the query in its slot and the site's User-Agent", async () => {
    const { run, asked } = htmlSetup();
    await run("london spy");
    expect(asked).toEqual([
      { url: `${ORIGIN}/?s=london%20spy`, headers: { "user-agent": "UA test" } },
    ]);
  });

  it("keeps each series it can read once, with what its card says, best match first", async () => {
    const { run } = htmlSetup();
    expect(await run("spy")).toEqual([
      { kind: "series", url: `${ORIGIN}/serie/spy-x-family/`, title: "Spy & Family" },
      {
        kind: "series",
        url: `${ORIGIN}/serie/london-spy/`,
        title: "London Spy",
        year: 2015,
        posterUrl: "https://s.origin.test/p/b.webp",
      },
    ]);
  });

  it("says so when the server can't read pages", async () => {
    const { run } = htmlSetup({ getText: undefined });
    await expect(run("spy")).rejects.toBeInstanceOf(ExtractorError);
  });

  it("refuses a search page without the query's slot", () => {
    expect(SiteSearch.safeParse({ ...htmlSearch, url: `${ORIGIN}/?s=` }).success).toBe(false);
  });

  describe("in pages, saying what each result is", () => {
    const card = (slug: string, type: string) =>
      `<article class="anime-card"><span class="anime-card-type">
        ${type}
      </span><h2 class="anime-card-title"><a href="/anime/${slug}">${slug}</a></h2></article>`;
    const pages: Record<number, string> = {
      1: card("black-1", "TV Anime") + card("black-2", "Película"),
      2: card("black-3", "OVA") + card("black-4", "TV Anime"),
      3: card("black-5", "TV Anime"),
    };
    const pagedSearch = SiteSearch.parse({
      reads: "html",
      url: `${ORIGIN}/directorio?q={query}&page={page}`,
      items: "article.anime-card",
      type: { selector: ".anime-card-type", series: ["TV Anime", "OVA"] },
      result: { url: { selector: "h2 a" }, title: { selector: "h2 a" } },
    });

    function pagedRun(last: number) {
      const asked: string[] = [];
      const run = createSearch({
        site: { name: "Site A", example: `${ORIGIN}/anime/x`, search: pagedSearch },
        http: {
          getJson: async () => {
            throw new Error("not asked");
          },
          getText: async (url) => {
            asked.push(url);
            const page = Number(new URL(url).searchParams.get("page"));
            return `<main>${page <= last ? (pages[page] ?? "") : ""}</main>`;
          },
        },
        canHandle: (url) => new URL(url).pathname.startsWith("/anime/"),
      });
      return { run, asked };
    }

    it("keeps the movies too when the page names their word, as movies", async () => {
      const withMovies = SiteSearch.parse({
        ...pagedSearch,
        type: { selector: ".anime-card-type", series: ["TV Anime", "OVA"], movie: ["Película"] },
      });
      const run = createSearch({
        site: { name: "Site A", example: `${ORIGIN}/anime/x`, search: withMovies },
        http: {
          getJson: async () => {
            throw new Error("not asked");
          },
          getText: async (url) =>
            `<main>${new URL(url).searchParams.get("page") === "1" ? pages[1] : ""}</main>`,
        },
        canHandle: (url) => new URL(url).pathname.startsWith("/anime/"),
      });
      expect((await run("black")).map((result) => [result.title, result.kind])).toEqual([
        ["black-1", "series"],
        ["black-2", "movie"],
      ]);
    });

    it("reads the pages one after another until one comes short, and keeps only series", async () => {
      const { run, asked } = pagedRun(3);
      const results = await run("black");
      expect(asked).toEqual([1, 2, 3].map((n) => `${ORIGIN}/directorio?q=black&page=${n}`));
      expect(results.map((result) => result.title)).toEqual([
        "black-1",
        "black-3",
        "black-4",
        "black-5",
      ]);
      // The site's own word for each, as one line.
      expect(results.map((result) => result.label)).toEqual([
        "TV Anime",
        "OVA",
        "TV Anime",
        "TV Anime",
      ]);
    });

    it("stops at a page that comes empty", async () => {
      const { run, asked } = pagedRun(2);
      await run("black");
      expect(asked).toHaveLength(3);
    });
  });
});
