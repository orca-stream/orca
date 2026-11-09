import { describe, expect, it } from "vite-plus/test";
import { createSearch, ExtractorError, rankByTitle, type HttpClient } from "../src/index.ts";
import { JsonSearch } from "../src/site.ts";

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
      { kind: "series", url: `${ORIGIN}/series/marea`, title: "Marea" },
      {
        kind: "series",
        url: `${ORIGIN}/series/la-casa-del-mar`,
        title: "La casa del mar",
        originalTitle: "The Sea House",
        year: 2006,
        plot: "A house.",
        posterUrl: `${ORIGIN}/wp-content/uploads/thumbs/b.webp`,
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
});
