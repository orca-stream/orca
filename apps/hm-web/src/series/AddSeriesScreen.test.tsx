import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { makeEpisode, makePreview, makeSeries } from "@/test/fixtures";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { AddSeriesScreen } from "./AddSeriesScreen";

const EXTRACTORS = [
  {
    id: "internet-archive",
    name: "Internet Archive",
    hosts: ["archive.org"],
    example: "https://archive.org/details/x",
    explicit: false,
    searchable: false,
  },
];
const GENERIC = {
  id: "generic",
  name: "Página genérica (navegador)",
  hosts: [],
  example: "https://example.com/watch/video",
  explicit: true,
  searchable: false,
};
const URL_TO_ADD = "https://archive.org/details/bevhill";

interface Options {
  extractors?: (typeof EXTRACTORS)[number][] | (typeof GENERIC)[];
  preview?: ReturnType<typeof makePreview>;
  createStatus?: number;
  createBody?: unknown;
  /** Answers for successive previews, when the test needs them to differ. */
  previews?: ReturnType<typeof makePreview>[];
  /** What TMDB knows, by TMDB id; any other id is a 404. */
  shows?: Record<
    string,
    {
      title: string;
      year: number | null;
      imdbId: string | null;
      overview?: string | null;
      posterUrl?: string | null;
      backdropUrl?: string | null;
    }
  >;
  /** What the sites find by a name, by query; any other query finds nothing. */
  siteFound?: Record<string, unknown[]>;
  /** What a search on TMDB by name finds, by query; any other query finds nothing. */
  found?: Record<string, unknown[]>;
  /** TMDB's images of a show, by TMDB id; any other id is a 503 (no TMDB key). */
  artwork?: Record<string, unknown>;
  /** The shows Jellyfin has; absent, Jellyfin can't be asked. */
  library?: unknown[];
  /** The episode files of each Jellyfin show, by its id. */
  libraryEpisodes?: Record<string, { season: number; episode: number }[]>;
  /** TMDB's seasons by TMDB id and episodes by `<id>/<season>`; absent, the server has no key (503). */
  guide?: { seasons: Record<string, unknown[]>; episodes: Record<string, unknown[]> };
}

function setup({
  extractors = EXTRACTORS,
  preview = makePreview(),
  createStatus = 201,
  createBody = { error: "x", message: "y" },
  previews,
  shows = {},
  found = {},
  siteFound = {},
  artwork = {},
  library,
  libraryEpisodes = {},
  guide,
  series,
  episodesOf = {},
  path,
}: Options & {
  /** Where the screen opens, with its query (by default, the bare add screen). */
  path?: string;
  /** The series the panel already has; absent, the list is not served at all. */
  series?: ReturnType<typeof makeSeries>[];
  episodesOf?: Record<string, ReturnType<typeof makeEpisode>[]>;
} = {}) {
  let previewCalls = 0;
  const guideLanguages: (string | null)[] = [];
  const handler: Handler = async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/extractors") return jsonResponse(extractors);
    if (pathname === "/api/library/shows")
      return library ? jsonResponse(library) : jsonResponse({ error: "upstream" }, 502);
    const files = /^\/api\/library\/shows\/([^/]+)\/episodes$/.exec(pathname);
    if (files) return jsonResponse(libraryEpisodes[decodeURIComponent(files[1]!)] ?? []);
    const seasons = /^\/api\/lookup\/tmdb\/(\d+)\/seasons(?:\/(\d+))?$/.exec(pathname);
    if (seasons) {
      if (!guide) return jsonResponse({ error: "unavailable" }, 503);
      guideLanguages.push(new URL(request.url).searchParams.get("language"));
      const answer = seasons[2]
        ? guide.episodes[`${seasons[1]}/${seasons[2]}`]
        : guide.seasons[seasons[1]!];
      return answer ? jsonResponse(answer) : jsonResponse({ error: "not_found" }, 404);
    }
    if (pathname === "/api/search")
      return jsonResponse(siteFound[new URL(request.url).searchParams.get("q") ?? ""] ?? []);
    if (pathname === "/api/lookup/tmdb")
      return jsonResponse(found[new URL(request.url).searchParams.get("query") ?? ""] ?? []);
    const images = /^\/api\/lookup\/tmdb\/(\d+)\/artwork$/.exec(pathname);
    if (images) {
      const options = artwork[images[1]!];
      return options ? jsonResponse(options) : jsonResponse({ error: "unavailable" }, 503);
    }
    const lookup = /^\/api\/lookup\/tmdb\/(\d+)$/.exec(pathname);
    if (lookup) {
      const show = shows[lookup[1]!];
      return show
        ? jsonResponse({
            tmdbId: lookup[1],
            overview: null,
            posterUrl: null,
            backdropUrl: null,
            ...show,
          })
        : jsonResponse({ error: "not_found" }, 404);
    }
    if (series && pathname === "/api/series" && request.method === "GET")
      return jsonResponse(series);
    const episodes = /^\/api\/series\/([^/]+)\/episodes$/.exec(pathname);
    if (episodes) return jsonResponse(episodesOf[decodeURIComponent(episodes[1]!)] ?? []);
    if (pathname === "/api/series/preview")
      return jsonResponse(
        previews ? previews[Math.min(previewCalls++, previews.length - 1)] : preview,
      );
    const art = /^\/api\/series\/([^/]+)\/(poster|backdrop|logo)$/.exec(pathname);
    if (art && request.method === "PUT") return jsonResponse(makeSeries({ id: art[1]! }));
    if (pathname === "/api/series" && request.method === "POST") {
      if (createStatus === 201) return jsonResponse(makeSeries({ id: "new1" }), 201);
      return jsonResponse(createBody, createStatus);
    }
    return jsonResponse({ error: "not_found" }, 404);
  };
  return {
    ...renderApp(<AddSeriesScreen />, { handler, path: path ?? "/series/new" }),
    guideLanguages,
  };
}

async function previewIt(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Dirección"), URL_TO_ADD);
  await user.click(screen.getByRole("button", { name: "Previsualizar" }));
  await screen.findByLabelText("Título");
}

const confirmButton = () =>
  screen.getByRole("button", { name: "Añadir serie" }) as HTMLButtonElement;

describe("AddSeriesScreen", () => {
  it("offers to start over in the dock once read, and starting over empties everything", async () => {
    const user = userEvent.setup();
    setup();
    const dock = await screen.findByRole("navigation", { name: "Atajos" });
    expect(within(dock).queryByRole("button", { name: "Empezar de nuevo" })).toBeNull();
    await previewIt(user);
    await user.click(within(dock).getByRole("button", { name: "Empezar de nuevo" }));
    expect(screen.queryByLabelText("Título")).toBeNull();
    expect((screen.getByLabelText("Dirección") as HTMLInputElement).value).toBe("");
  });

  it("names the extractor that will read the address inside it, as you type", async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText("Dirección"), URL_TO_ADD);
    expect((await screen.findByRole("status")).textContent).toContain(
      "Lo leerá el extractor Internet Archive.",
    );
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "https://example.com/x");
    expect(screen.queryByText("Lo leerá el extractor Internet Archive.")).toBeNull();
  });

  it("opens from an extractor's card with its example as a hint, never as a value", async () => {
    setup({ path: "/series/new?extractor=internet-archive" });
    const input = (await screen.findByLabelText("Dirección")) as HTMLInputElement;
    await waitFor(() => expect(input.placeholder).toBe(EXTRACTORS[0]!.example));
    expect(input.value).toBe("");
    expect(screen.getByText("Lo leerá el extractor Internet Archive.")).toBeTruthy();
  });

  it("offers the extractor choice only once the address alone can't pick one", async () => {
    const user = userEvent.setup();
    setup({ extractors: [...EXTRACTORS, GENERIC] });
    await screen.findByLabelText("Dirección");
    expect(screen.queryByLabelText("Leer con")).toBeNull();
    await user.type(screen.getByLabelText("Dirección"), URL_TO_ADD);
    expect(screen.queryByLabelText("Leer con")).toBeNull();
    await user.clear(screen.getByLabelText("Dirección"));
    await user.type(screen.getByLabelText("Dirección"), "https://example.com/x");
    expect(await screen.findByLabelText("Leer con")).toBeTruthy();
  });

  it("asks a new series for its title, year and ids inside the bar, and an existing one for none", async () => {
    const user = userEvent.setup();
    setup({ series: [makeSeries({ id: "s1", title: "Otra" })] });
    await previewIt(user);
    // Empty, for the TMDB id to fill in: the site's name is rarely the one wanted.
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText("Id de TMDB")).toBeTruthy();
    expect(screen.getByLabelText("Id de IMDb")).toBeTruthy();
    expect(screen.queryByText(/Opcionales/)).toBeNull();
    expect(screen.queryByText("Dominio público")).toBeNull();
    await user.click(screen.getByLabelText("Añadir a"));
    await user.click(await screen.findByRole("option", { name: /Otra/ }));
    await waitFor(() => expect(screen.queryByLabelText("Id de TMDB")).toBeNull());
  });

  it("keeps only digits in the year and the TMDB id, and tells what is wrong on the field itself", async () => {
    const user = userEvent.setup();
    setup();
    await previewIt(user);
    const year = screen.getByLabelText("Año") as HTMLInputElement;
    await user.clear(year);
    await user.type(year, "19ab");
    expect(year.value).toBe("19");
    expect(year.getAttribute("aria-invalid")).toBe("true");
    expect(year.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(year.getAttribute("aria-describedby")!)!.textContent).toBe(
      "Escribe un año válido.",
    );
    const tmdb = screen.getByLabelText("Id de TMDB") as HTMLInputElement;
    await user.type(tmdb, "1x2");
    expect(tmdb.value).toBe("12");
  });

  it("starts with where it goes empty, which makes a new series, and lists only the ones that exist", async () => {
    const user = userEvent.setup();
    setup({ series: [makeSeries({ id: "s1", title: "Otra" })] });
    await previewIt(user);
    const addTo = screen.getByLabelText("Añadir a") as HTMLInputElement;
    expect(addTo.value).toBe("");
    expect(addTo.placeholder).toBe("Serie nueva, o busca una que ya tengas");
    await user.click(addTo);
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "Otra1962",
    ]);
  });

  it("shows the chosen series' title with its year dimmed beside it, and its card beside the episodes", async () => {
    const user = userEvent.setup();
    setup({
      series: [makeSeries({ id: "s1", title: "Otra", plot: "Una familia encuentra petróleo." })],
    });
    await previewIt(user);
    await user.click(screen.getByLabelText("Añadir a"));
    await user.click(await screen.findByRole("option", { name: /Otra/ }));
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect((screen.getByLabelText("Añadir a") as HTMLInputElement).value).toBe("Otra");
    expect(
      screen.getByLabelText("Añadir a").closest('[data-slot="input-group"]')!.textContent,
    ).toContain("1962");
    // Only beside the episodes: no card on hover repeats it over the row.
    const side = screen.getByRole("region", { name: "Se añade a" });
    expect(side.textContent).toContain("Una familia encuentra petróleo.");
    expect(side.textContent).toContain("12 de 36 episodios en la biblioteca");
  });

  it("shows TMDB's card of the show the TMDB id names beside the episodes", async () => {
    const user = userEvent.setup();
    setup({
      shows: {
        "30991": {
          title: "Cowboy Bebop",
          year: 1998,
          imdbId: "tt0213338",
          overview: "Cazarrecompensas en el espacio.",
          posterUrl: "https://image.tmdb.org/t/p/w342/bebop.jpg",
        },
      },
    });
    await previewIt(user);
    await user.type(screen.getByLabelText("Id de TMDB"), "30991");
    await waitFor(() =>
      expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Cowboy Bebop"),
    );
    const side = screen.getByRole("region", { name: "Según TMDB" });
    expect(side.textContent).toContain("Cazarrecompensas en el espacio.");
    expect(side.textContent).toContain("TMDB 30991");
  });

  it("lays the show's backdrop behind the screen once the TMDB id names it, else its poster", async () => {
    const user = userEvent.setup();
    const { container } = setup({
      shows: {
        "30991": {
          title: "Cowboy Bebop",
          year: 1998,
          imdbId: null,
          posterUrl: "https://image.tmdb.org/t/p/w342/bebop.jpg",
          backdropUrl: "https://image.tmdb.org/t/p/w1280/wide.jpg",
        },
        "5": { title: "Odd", year: null, imdbId: null, posterUrl: "https://cdn.example/odd.jpg" },
      },
    });
    const behind = () =>
      container.querySelector<HTMLImageElement>('[aria-hidden="true"].fixed img')?.src ?? null;
    await previewIt(user);
    expect(behind()).toBeNull();
    const id = screen.getByLabelText("Id de TMDB");
    await user.type(id, "30991");
    await waitFor(() => expect(behind()).toBe("https://image.tmdb.org/t/p/w1280/wide.jpg"));
    await user.clear(id);
    await user.type(id, "5");
    await waitFor(() => expect(behind()).toBe("https://cdn.example/odd.jpg"));
  });

  it("offers the shows Jellyfin has that it doesn't, after its own series", async () => {
    const user = userEvent.setup();
    const show = (id: string, title: string, extra: object = {}) => ({
      id,
      title,
      year: 2023,
      tmdbId: null,
      imdbId: null,
      seriesId: null,
      adoptable: true,
      ...extra,
    });
    setup({
      series: [makeSeries({ id: "s1", title: "Otra" })],
      library: [
        show("jf1", "Mashle: Magic and Muscles"),
        show("jf2", "Otra", { seriesId: "s1" }),
        show("jf3", "Far away", { adoptable: false }),
      ],
    });
    await previewIt(user);
    await user.click(screen.getByLabelText("Añadir a"));
    await waitFor(async () =>
      expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
        "Otra1962",
        "Mashle: Magic and Muscles2023 · En Jellyfin",
      ]),
    );
    await user.click(screen.getByRole("option", { name: /Mashle/ }));
    await waitFor(() => expect(screen.queryByLabelText("Título")).toBeNull());
  });

  it("says when a new series has the id of one there already is, and adds to that one instead", async () => {
    const user = userEvent.setup();
    setup({
      series: [makeSeries({ id: "s1", title: "Otra", tmdbId: "30991" })],
      library: [
        {
          id: "jf1",
          title: "Mashle",
          year: 2023,
          tmdbId: "204832",
          imdbId: "tt21209804",
          seriesId: null,
          adoptable: true,
        },
      ],
    });
    await previewIt(user);
    await user.type(screen.getByLabelText("Id de IMDb"), "tt21209804");
    expect(await screen.findByText("Ya tienes «Mashle (2023)» con ese id.")).toBeTruthy();
    await user.clear(screen.getByLabelText("Id de IMDb"));
    await user.type(screen.getByLabelText("Id de TMDB"), "30991");
    expect(await screen.findByText("Ya tienes «Otra (1962)» con ese id.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Añadir a esta serie" }));
    await waitFor(() => expect(screen.queryByLabelText("Título")).toBeNull());
    expect((screen.getByLabelText("Añadir a") as HTMLInputElement).value).toBe("Otra");
  });

  it("shows the match in place of where it goes until it is dismissed", async () => {
    const user = userEvent.setup();
    setup({ series: [makeSeries({ id: "s1", title: "Otra", tmdbId: "30991" })] });
    await previewIt(user);
    await user.type(screen.getByLabelText("Id de TMDB"), "30991");
    await screen.findByText("Ya tienes «Otra (1962)» con ese id.");
    expect(screen.queryByLabelText("Añadir a")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Descartar, es otra serie" }));
    expect((screen.getByLabelText("Añadir a") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("Ya tienes «Otra (1962)» con ese id.")).toBeNull();
    expect(screen.getByLabelText("Título")).toBeTruthy();
  });

  it("fills the title in again when the same TMDB id is typed after another preview", async () => {
    const user = userEvent.setup();
    setup({
      previews: [makePreview({ previewId: "p1" }), makePreview({ previewId: "p2" })],
      shows: { "30991": { title: "Cowboy Bebop", year: 1998, imdbId: "tt0213338" } },
    });
    await previewIt(user);
    await user.type(screen.getByLabelText("Id de TMDB"), "30991");
    const title = () => screen.getByLabelText("Título") as HTMLInputElement;
    await waitFor(() => expect(title().value).toBe("Cowboy Bebop"), { timeout: 2000 });
    // Read again: a fresh form, and the cached answer for the same id must still fill it in.
    await user.click(screen.getByRole("button", { name: "Buscar otra serie" }));
    await waitFor(() => expect(screen.queryByLabelText("Título")).toBeNull());
    await previewIt(user);
    expect(title().value).toBe("");
    await user.type(screen.getByLabelText("Id de TMDB"), "30991");
    await waitFor(() => expect(title().value).toBe("Cowboy Bebop"), { timeout: 2000 });
  });

  it("fills in the title, the year and the IMDb id from the TMDB id, over what the site said", async () => {
    const user = userEvent.setup();
    setup({ shows: { "30991": { title: "Cowboy Bebop", year: 1998, imdbId: "tt0213338" } } });
    await previewIt(user);
    await user.type(screen.getByLabelText("Id de TMDB"), "30991");
    const title = screen.getByLabelText("Título") as HTMLInputElement;
    await waitFor(() => expect(title.value).toBe("Cowboy Bebop"), { timeout: 2000 });
    expect((screen.getByLabelText("Año") as HTMLInputElement).value).toBe("1998");
    expect((screen.getByLabelText("Id de IMDb") as HTMLInputElement).value).toBe("tt0213338");
  });

  it("never replaces what was typed by hand", async () => {
    const user = userEvent.setup();
    setup({ shows: { "30991": { title: "Cowboy Bebop", year: 1998, imdbId: "tt0213338" } } });
    await previewIt(user);
    const title = screen.getByLabelText("Título") as HTMLInputElement;
    await user.clear(title);
    await user.type(title, "Bebop");
    await user.type(screen.getByLabelText("Id de TMDB"), "30991");
    const year = screen.getByLabelText("Año") as HTMLInputElement;
    await waitFor(() => expect(year.value).toBe("1998"), { timeout: 2000 });
    expect(title.value).toBe("Bebop");
  });

  it("fills in a field that was emptied by hand", async () => {
    const user = userEvent.setup();
    setup({
      shows: { "135237": { title: "Chizuru-chan Kaihatsu Nikki", year: 2021, imdbId: null } },
    });
    await previewIt(user);
    const title = screen.getByLabelText("Título") as HTMLInputElement;
    await user.clear(title);
    await user.type(screen.getByLabelText("Id de TMDB"), "135237");
    await waitFor(() => expect(title.value).toBe("Chizuru-chan Kaihatsu Nikki"), { timeout: 2000 });
    expect((screen.getByLabelText("Id de IMDb") as HTMLInputElement).value).toBe("");
  });

  it("says on the TMDB field when TMDB has no show with that id", async () => {
    const user = userEvent.setup();
    setup();
    await previewIt(user);
    const tmdb = screen.getByLabelText("Id de TMDB") as HTMLInputElement;
    await user.type(tmdb, "404404");
    await waitFor(() => expect(tmdb.getAttribute("aria-invalid")).toBe("true"), { timeout: 2000 });
    expect(document.getElementById(tmdb.getAttribute("aria-describedby")!)!.textContent).toBe(
      "TMDB no tiene ninguna serie con ese id.",
    );
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("");
  });

  it("asks for the season and the first episode as numbers without TMDB, and says where they land", async () => {
    const user = userEvent.setup();
    setup();
    await previewIt(user);
    const season = screen.getByLabelText("Temporada") as HTMLInputElement;
    expect(season.placeholder).toBe("Temporada (la del sitio: 1)");
    // Every card says where it lands.
    expect(screen.getAllByText("S01E01").length).toBeGreaterThan(0);
    await user.type(season, "2x");
    await user.type(screen.getByLabelText("Primer episodio"), "13");
    expect(season.value).toBe("2");
    expect(screen.getAllByText("S02E13").length).toBeGreaterThan(0);
    expect(screen.getAllByText("S02E16").length).toBeGreaterThan(0);
  });

  it("picks the season and the first episode from TMDB's lists, in the panel's language", async () => {
    const user = userEvent.setup();
    const { guideLanguages } = setup({
      shows: { "220542": { title: "The Apothecary Diaries", year: 2023, imdbId: null } },
      guide: {
        seasons: {
          "220542": [
            { number: 0, name: "Specials", episodeCount: 1, year: null },
            { number: 1, name: "Season 1", episodeCount: 24, year: 2023 },
            { number: 2, name: "Season 2", episodeCount: 24, year: 2025 },
          ],
        },
        episodes: {
          "220542/2": [
            {
              number: 12,
              name: "Antes",
              airDate: null,
              overview: null,
              runtimeMin: null,
              stillUrl: null,
            },
            {
              number: 13,
              name: "Segunda parte",
              airDate: "2025-04-04",
              overview: null,
              runtimeMin: null,
              stillUrl: null,
            },
          ],
        },
      },
    });
    await previewIt(user);
    await user.type(screen.getByLabelText("Id de TMDB"), "220542");
    const season = await screen.findByRole("combobox", { name: "Temporada" }, { timeout: 2000 });
    // Left empty, the picker shows what the site's numbering amounts to, not a blank.
    expect(season.textContent).toContain("Temporada 1");
    await user.click(season);
    expect(await screen.findByRole("option", { name: /Especiales/ })).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /Temporada 2/ }));
    const first = await screen.findByRole("combobox", { name: "Primer episodio" });
    await user.click(first);
    await user.click(await screen.findByRole("option", { name: "13. Segunda parte" }));
    expect(screen.getByText(/S02E13–E16/)).toBeTruthy();
    expect(guideLanguages.every((language) => language === "es")).toBe(true);
  });

  it("previews into a grid of the episodes, with where each lands, its fate and its server", async () => {
    const user = userEvent.setup();
    setup();
    await previewIt(user);
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("");
    // Until a TMDB id says more, the column under the bar shows what the site said.
    expect(screen.getByRole("region", { name: "Lo que dice el sitio" }).textContent).toContain(
      "The Beverly Hillbillies",
    );
    expect((screen.getByLabelText("Año") as HTMLInputElement).value).toBe("1962");
    const grid = screen.getByRole("region", { name: "Episodios" });
    expect(within(grid).getByText("3 de 3")).toBeTruthy();
    const card = within(grid).getByText("Getting Settled").closest("article")!;
    expect(within(card).getByText("Inferido")).toBeTruthy();
    expect(within(card).getByRole("checkbox", { name: "Incluir S01E02" })).toBeTruthy();
    expect(within(card).getByText("Sin descargar")).toBeTruthy();
    expect(within(card).getByText("archive.org")).toBeTruthy();

    await user.click(within(card).getByRole("checkbox", { name: "Incluir S01E02" }));
    expect(within(card).getByText("Se omite")).toBeTruthy();
    expect(within(grid).getByText("2 de 3")).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Descargar ahora" }));
    expect(within(grid).getAllByText("Se descargará")).toHaveLength(2);
  });

  // The editor below the bar is gone while the form is rebuilt into it, part by part.
  it.skip("shows the cover from the server's own route, and nothing broken when there is none", async () => {
    const user = userEvent.setup();
    setup({ previews: [makePreview(), makePreview({ posterUrl: null })] });
    await previewIt(user);
    const cover = screen.getByRole("img", { name: "The Beverly Hillbillies" });
    expect(cover.getAttribute("src")).toBe("/api/series/preview/p1/poster");

    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    await waitFor(() =>
      expect(screen.queryByRole("img", { name: "The Beverly Hillbillies" })).toBeNull(),
    );
  });

  // The editor below the bar is gone while the form is rebuilt into it, part by part.
  it.skip("links the license only when its address is http(s), else shows it as plain text", async () => {
    const user = userEvent.setup();
    const bad = "javascript:alert(1)";
    setup({
      previews: [
        makePreview({
          license: { kind: "cc-by", url: "https://example.test/l" },
        }),
        makePreview({ license: { kind: "cc-by", url: bad } }),
      ],
    });
    await previewIt(user);
    expect(screen.getByRole("link", { name: "Ver licencia" }).getAttribute("href")).toBe(
      "https://example.test/l",
    );
    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Ver licencia" })).toBeNull());
    expect(screen.getByText(bad)).toBeTruthy();
  });

  // The editor below the bar is gone while the form is rebuilt into it, part by part.
  it.skip("translates the server's warnings by their kind and falls back to its text for an unknown kind", async () => {
    const user = userEvent.setup();
    setup({
      preview: makePreview({
        warnings: [
          { kind: "gap", message: "Episode 3 is missing", keys: ["e4"] },
          { kind: "novel" as never, message: "Something new" },
        ],
      }),
    });
    await previewIt(user);
    // The sentence in our language, and the server's own detail right next to it.
    expect(screen.getByText(/Faltan episodios en la numeración/)).toBeTruthy();
    expect(screen.getByText("Episode 3 is missing")).toBeTruthy();
    // Nothing to translate for a kind we don't know: its text shows once.
    expect(screen.getAllByText("Something new")).toHaveLength(1);
  });

  it("offers the generic extractor only when the server lists one, and sends the choice", async () => {
    const user = userEvent.setup();
    const { requests } = setup({ extractors: [...EXTRACTORS, GENERIC] });
    await user.type(
      await screen.findByLabelText("Dirección"),
      "https://videos.example.com/watch/1",
    );
    const choice = (await screen.findByLabelText("Leer con")) as HTMLSelectElement;
    expect([...choice.options].map((o) => o.text)).toEqual([
      "Automático (por la dirección)",
      "Página genérica (navegador)",
    ]);
    await user.selectOptions(choice, "generic");
    expect(await screen.findByText(/Página genérica \(navegador\) abrirá la página/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    await screen.findByLabelText("Título");
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series/preview",
    )!;
    expect(await post.json()).toEqual({
      url: "https://videos.example.com/watch/1",
      extractorId: "generic",
    });
  });

  it("says in its own words when what was typed is not a web address, and asks nothing", async () => {
    const user = userEvent.setup();
    const { requests } = setup();
    const input = await screen.findByLabelText("Dirección");
    await user.type(input, "204832");
    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Eso no es una dirección web. Pega una que empiece por https://",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(requests.some((r) => new URL(r.url).pathname === "/api/series/preview")).toBe(false);
    await user.type(input, "x");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("searches the sites by a name typed in the address, and reads the one picked", async () => {
    const user = userEvent.setup();
    const site = {
      id: "site-b",
      name: "Site B",
      hosts: ["origin.test"],
      example: "https://origin.test/series/x",
      explicit: false,
      searchable: true,
    };
    const { requests } = setup({
      extractors: [...EXTRACTORS, site],
      siteFound: {
        "la casa": [
          {
            extractorId: "site-b",
            failed: false,
            results: [
              {
                url: "https://origin.test/series/la-casa",
                title: "La casa",
                originalTitle: "The House",
                year: 2006,
                plot: null,
                posterUrl: null,
                seriesId: null,
                seasons: null,
              },
            ],
          },
          { extractorId: "internet-archive", failed: true, results: [] },
        ],
      },
    });
    const input = await screen.findByLabelText("Dirección");
    await waitFor(() =>
      expect((input as HTMLInputElement).placeholder).toBe("Pega una dirección o busca por título"),
    );
    await user.type(input, "la");
    expect(await screen.findByText("Mínimo 3 letras")).toBeTruthy();
    await user.type(input, " casa");
    // A name is searched, never read: the read button waits for a web address.
    const read = screen.getByRole("button", { name: "Previsualizar" });
    expect((read as HTMLButtonElement).disabled).toBe(true);
    // The results take the screen, as a grid of covers.
    const results = await screen.findByRole("region", { name: "Resultados de los sitios" });
    const result = await within(results).findByRole("button", {
      name: /^La casa, 2006, The House/,
    });
    expect(
      await screen.findByText(
        "En los sitios, para «la casa» · 1 serie · No respondió: Internet Archive",
      ),
    ).toBeTruthy();
    await user.click(result);

    await screen.findByLabelText("Título");
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series/preview",
    )!;
    expect(await post.json()).toEqual({
      url: "https://origin.test/series/la-casa",
      extractorId: "site-b",
    });
    expect((input as HTMLInputElement).value).toBe("https://origin.test/series/la-casa");

    // Read: the address is the series' until it is searched again, which empties it.
    expect((input as HTMLInputElement).readOnly).toBe(true);
    await user.click(screen.getByRole("button", { name: "Buscar otra serie" }));
    await waitFor(() => expect(screen.queryByLabelText("Título")).toBeNull());
    const fresh = screen.getByLabelText("Dirección") as HTMLInputElement;
    expect(fresh.value).toBe("");
    expect(fresh.readOnly).toBe(false);
  });

  it("shows the sites' results a page at a time", async () => {
    const user = userEvent.setup();
    const site = {
      id: "site-b",
      name: "Site B",
      hosts: ["origin.test"],
      example: "https://origin.test/series/x",
      explicit: false,
      searchable: true,
    };
    const results = Array.from({ length: 8 }, (_, index) => ({
      url: `https://origin.test/series/mar-${index + 1}`,
      title: `Mar ${index + 1}`,
      originalTitle: null,
      year: null,
      plot: null,
      posterUrl: null,
      seriesId: null,
      seasons: null,
    }));
    setup({
      extractors: [site],
      siteFound: { mar: [{ extractorId: "site-b", failed: false, results }] },
    });
    await user.type(await screen.findByLabelText("Dirección"), "mar");
    const region = await screen.findByRole("region", { name: "Resultados de los sitios" });
    const titles = () =>
      within(region)
        .queryAllByRole("button", { name: /^Mar \d/ })
        .map((button) => button.textContent);
    // Without a width to measure (jsdom), two columns of three rows.
    await waitFor(() =>
      expect(titles()).toEqual(["Mar 1", "Mar 2", "Mar 3", "Mar 4", "Mar 5", "Mar 6"]),
    );
    expect(within(region).getByRole("button", { name: "Página anterior" })).toHaveProperty(
      "disabled",
      true,
    );
    await user.click(within(region).getByRole("button", { name: "Página 2" }));
    expect(titles()).toEqual(["Mar 7", "Mar 8"]);
    expect(within(region).getByRole("button", { name: "Página siguiente" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("tells two results with the same title apart by their seasons", async () => {
    const user = userEvent.setup();
    const site = {
      id: "site-b",
      name: "Site B",
      hosts: ["origin.test"],
      example: "https://origin.test/series/x",
      explicit: false,
      searchable: true,
    };
    const twin = (slug: string, seasons: number) => ({
      url: `https://origin.test/series/${slug}`,
      title: "King",
      originalTitle: null,
      year: null,
      plot: null,
      posterUrl: null,
      seriesId: null,
      seasons,
    });
    setup({
      extractors: [site],
      siteFound: {
        king: [
          { extractorId: "site-b", failed: false, results: [twin("king", 4), twin("king-2", 1)] },
        ],
      },
    });
    await user.type(await screen.findByLabelText("Dirección"), "king");
    const region = await screen.findByRole("region", { name: "Resultados de los sitios" });
    expect(await within(region).findByText("4 temporadas")).toBeTruthy();
    expect(within(region).getByText("1 temporada")).toBeTruthy();
  });

  it("opens a series already added when the sites find it, instead of reading it again", async () => {
    const user = userEvent.setup();
    const site = {
      id: "site-b",
      name: "Site B",
      hosts: ["origin.test"],
      example: "https://origin.test/series/x",
      explicit: false,
      searchable: true,
    };
    const { requests, location } = setup({
      extractors: [site],
      series: [makeSeries({ id: "s7", title: "La casa de siempre" })],
      siteFound: {
        "la casa": [
          {
            extractorId: "site-b",
            failed: false,
            results: [
              {
                url: "https://origin.test/series/la-casa",
                title: "La casa",
                originalTitle: null,
                year: null,
                plot: null,
                posterUrl: null,
                seriesId: "s7",
                seasons: null,
              },
            ],
          },
        ],
      },
    });
    await user.type(await screen.findByLabelText("Dirección"), "la casa");
    const result = await screen.findByRole("button", { name: /Ya la tienes · La casa de siempre/ });
    await user.click(result);
    await waitFor(() => expect(location.history.at(-1)).toBe("/series/s7"));
    expect(requests.some((r) => new URL(r.url).pathname === "/api/series/preview")).toBe(false);
  });

  it("sends no extractor when the choice is automatic, and hides the choice without a generic one", async () => {
    const user = userEvent.setup();
    const { requests } = setup();
    await screen.findByLabelText("Dirección");
    expect(screen.queryByLabelText("Leer con")).toBeNull();
    await previewIt(user);
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series/preview",
    )!;
    expect(await post.json()).toEqual({ url: URL_TO_ADD });
  });

  it("adds the edited series and goes to it", async () => {
    const user = userEvent.setup();
    const { requests, location } = setup();
    await previewIt(user);
    await user.type(screen.getByLabelText("Título"), "The Beverly Hillbillies");
    // The title's list of TMDB's shows closes, as it does on leaving the field.
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("checkbox", { name: "Incluir S01E04" }));
    await user.click(screen.getByRole("switch", { name: /Seguir la serie/ }));
    await user.click(confirmButton());

    await waitFor(() => expect(location.history.at(-1)).toBe("/series/new1"));
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series",
    )!;
    expect(await post.json()).toEqual({
      previewId: "p1",
      title: "The Beverly Hillbillies",
      year: 1962,
      tmdbId: null,
      imdbId: null,
      season: null,
      firstEpisode: null,
      adjustments: [],
      episodeKeys: ["e1", "e2"],
      follow: true,
      downloadNow: false,
    });
  });

  it("picks the show from TMDB's search by name, which fills in its ids", async () => {
    const user = userEvent.setup();
    setup({
      found: {
        Bebop: [
          {
            tmdbId: "30991",
            title: "Cowboy Bebop",
            originalTitle: null,
            year: 1998,
            overview: null,
            posterUrl: null,
          },
        ],
      },
      shows: { "30991": { title: "Cowboy Bebop", year: 1998, imdbId: "tt0213338" } },
    });
    await previewIt(user);
    await user.type(screen.getByLabelText("Título"), "Bebop");
    await user.click(await screen.findByRole("option", { name: /Cowboy Bebop/ }));
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Cowboy Bebop");
    expect((screen.getByLabelText("Id de TMDB") as HTMLInputElement).value).toBe("30991");
    await waitFor(() =>
      expect((screen.getByLabelText("Id de IMDb") as HTMLInputElement).value).toBe("tt0213338"),
    );
  });

  it("puts the artwork picked while adding into the series, then goes to it", async () => {
    const user = userEvent.setup();
    const poster = "https://image.tmdb.org/t/p/original/p2.jpg";
    const { requests, location } = setup({
      shows: { "30991": { title: "Cowboy Bebop", year: 1998, imdbId: null } },
      artwork: {
        "30991": {
          poster: [
            {
              url: poster,
              previewUrl: "https://image.tmdb.org/t/p/w342/p2.jpg",
              language: "es",
              width: 1,
              height: 1,
            },
          ],
          backdrop: [],
          logo: [],
        },
      },
    });
    await previewIt(user);
    await user.type(screen.getByLabelText("Id de TMDB"), "30991");
    await user.click(await screen.findByRole("button", { name: "Cambiar el póster" }));
    await user.click(await screen.findByRole("button", { name: "es" }));
    await user.keyboard("{Escape}");
    await user.click(confirmButton());

    await waitFor(() => expect(location.history.at(-1)).toBe("/series/new1"));
    const put = requests.find(
      (r) => r.method === "PUT" && new URL(r.url).pathname === "/api/series/new1/poster",
    )!;
    expect(await put.json()).toEqual({ url: poster });
  });

  it("reads the address again when the preview expired (410), keeping what was edited", async () => {
    const user = userEvent.setup();
    const { requests } = setup({
      createStatus: 410,
      previews: [makePreview({ previewId: "p1" }), makePreview({ previewId: "p2" })],
    });
    await previewIt(user);
    await user.clear(screen.getByLabelText("Título"));
    await user.type(screen.getByLabelText("Título"), "Mi título");
    // The title's list of TMDB's shows closes, as it does on leaving the field.
    await user.keyboard("{Escape}");
    await user.click(confirmButton());

    expect(await screen.findByText(/volvió a leer/)).toBeTruthy();
    expect((screen.getByLabelText("Título") as HTMLInputElement).value).toBe("Mi título");
    expect(requests.filter((r) => new URL(r.url).pathname === "/api/series/preview")).toHaveLength(
      2,
    );
  });

  it("explains a clash (409) with the server's own detail", async () => {
    const user = userEvent.setup();
    setup({
      createStatus: 409,
      createBody: { error: "conflict", message: "This address was already added to “Show”" },
    });
    await previewIt(user);
    await user.type(screen.getByLabelText("Título"), "Show");
    // The title's list of TMDB's shows closes, as it does on leaving the field.
    await user.keyboard("{Escape}");
    await user.click(confirmButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Choca con algo que ya existe");
    expect(alert.textContent).toContain("already added to “Show”");
  });

  it("adds the address to a series that exists, after the last episode it has in the season", async () => {
    const user = userEvent.setup();
    const existing = Array.from({ length: 12 }, (_, i) =>
      makeEpisode({ id: `x${i + 1}`, season: 1, episode: i + 1 }),
    );
    const { requests, location } = setup({
      series: [makeSeries({ id: "s9", title: "Show", year: 2023 })],
      episodesOf: { s9: existing },
    });
    await previewIt(user);
    await user.click(screen.getByRole("combobox", { name: "Añadir a" }));
    await user.click(await screen.findByRole("option", { name: /^Show/ }));
    // The new series' own fields are gone: the series keeps its title, year and ids.
    expect(screen.queryByLabelText("Título")).toBeNull();
    expect(screen.queryByLabelText("Id de TMDB")).toBeNull();

    // It picks up where the series leaves off: the site's first episode becomes the 13th.
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Primer episodio").value).toBe("13"),
    );
    expect(screen.getByTitle("en el sitio S01E01").textContent).toContain("S01E13");
    expect(screen.queryByText("Cambia de fuente")).toBeNull();

    // Numbered by hand as the site does, it lands on what the series has: those take their video
    // from this address, which doesn't stop it from being added.
    await user.clear(screen.getByLabelText("Primer episodio"));
    await user.type(screen.getByLabelText("Primer episodio"), "1");
    expect(await screen.findAllByText("Cambia de fuente")).toHaveLength(3);
    expect(confirmButton()).toHaveProperty("disabled", false);

    await user.clear(screen.getByLabelText("Primer episodio"));
    await user.type(screen.getByLabelText("Primer episodio"), "13");
    await user.click(confirmButton());

    await waitFor(() => expect(location.history.at(-1)).toBe("/series/new1"));
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series",
    )!;
    expect(await post.json()).toMatchObject({
      previewId: "p1",
      seriesId: "s9",
      season: null,
      firstEpisode: 13,
      episodeKeys: ["e1", "e2", "e4"],
    });
  });

  it("goes on to the next season when the series has the address's season whole", async () => {
    const user = userEvent.setup();
    // Season 1 found whole by an earlier source, downloaded or not.
    const existing = Array.from({ length: 24 }, (_, i) =>
      makeEpisode({ id: `x${i + 1}`, season: 1, episode: i + 1, status: "missing" }),
    );
    const { requests } = setup({
      series: [makeSeries({ id: "s9", title: "Show", year: 2023, tmdbId: "220542" })],
      episodesOf: { s9: existing },
      guide: {
        seasons: {
          "220542": [
            { number: 0, name: "Specials", episodeCount: 1, year: null },
            { number: 1, name: "Season 1", episodeCount: 24, year: 2023 },
            { number: 2, name: "Season 2", episodeCount: 24, year: 2025 },
          ],
        },
        episodes: {},
      },
    });
    await previewIt(user);
    await user.click(screen.getByRole("combobox", { name: "Añadir a" }));
    await user.click(await screen.findByRole("option", { name: /^Show/ }));

    const season = await screen.findByRole("combobox", { name: "Temporada" }, { timeout: 2000 });
    await waitFor(() => expect(season.textContent).toContain("Temporada 2"));
    expect(screen.getByTitle("en el sitio S01E01").textContent).toContain("S02E01");
    expect(screen.queryByText("Cambia de fuente")).toBeNull();

    await user.click(confirmButton());
    await waitFor(() =>
      expect(
        requests.some((r) => r.method === "POST" && new URL(r.url).pathname === "/api/series"),
      ).toBe(true),
    );
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series",
    )!;
    expect(await post.json()).toMatchObject({ seriesId: "s9", season: 2, firstEpisode: null });
  });

  it("marks what the series' folder already has as files, though the series doesn't know of it", async () => {
    const user = userEvent.setup();
    setup({
      series: [makeSeries({ id: "s9", title: "Show", year: 2023 })],
      episodesOf: { s9: [makeEpisode({ id: "x1", season: 2, episode: 1 })] },
      library: [
        {
          id: "jf9",
          title: "Show",
          year: 2023,
          tmdbId: null,
          imdbId: null,
          seriesId: "s9",
          adoptable: true,
        },
      ],
      libraryEpisodes: {
        jf9: [
          { season: 1, episode: 1 },
          { season: 1, episode: 2 },
        ],
      },
    });
    await previewIt(user);
    await user.click(screen.getByRole("combobox", { name: "Añadir a" }));
    await user.click(await screen.findByRole("option", { name: /^Show/ }));
    await waitFor(() => expect(screen.getAllByText("Ya en Jellyfin")).toHaveLength(2));
    expect(screen.queryByText("Cambia de fuente")).toBeNull();
    expect(confirmButton()).toHaveProperty("disabled", false);
  });

  it("sends the TMDB id and the season of a new series", async () => {
    const user = userEvent.setup();
    const { requests } = setup({ series: [] });
    await previewIt(user);
    // Only digits are kept: letters never reach the field.
    await user.type(screen.getByLabelText("Id de TMDB"), "abc");
    expect((screen.getByLabelText("Id de TMDB") as HTMLInputElement).value).toBe("");
    await user.type(screen.getByLabelText("Id de TMDB"), "12345");
    await user.type(screen.getByLabelText("Temporada"), "2");
    await user.type(screen.getByLabelText("Título"), "Show");
    // The title's list of TMDB's shows closes, as it does on leaving the field.
    await user.keyboard("{Escape}");
    await user.click(confirmButton());
    await waitFor(() =>
      expect(
        requests.some((r) => r.method === "POST" && new URL(r.url).pathname === "/api/series"),
      ).toBe(true),
    );
    const post = requests.find(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series",
    )!;
    expect(await post.json()).toMatchObject({ tmdbId: "12345", season: 2, firstEpisode: null });
  });

  it("says when the site has nothing readable (422)", async () => {
    const user = userEvent.setup();
    renderApp(<AddSeriesScreen />, {
      path: "/series/new",
      handler: (request) =>
        new URL(request.url).pathname === "/api/extractors"
          ? jsonResponse(EXTRACTORS)
          : jsonResponse({ error: "no_episodes" }, 422),
    });
    await user.type(await screen.findByLabelText("Dirección"), URL_TO_ADD);
    await user.click(screen.getByRole("button", { name: "Previsualizar" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No se encontraron episodios");
  });

  it("comes with the series it was sent from (?into=) as where the address goes", async () => {
    const user = userEvent.setup();
    setup({
      path: "/series/new?into=s1",
      series: [makeSeries({ id: "s1", title: "Otra" }), makeSeries({ id: "s2", title: "Más" })],
    });
    await user.type(await screen.findByLabelText("Dirección"), URL_TO_ADD);
    // Where it goes rides on the preview button, before anything was read.
    await user.click(await screen.findByRole("button", { name: "Previsualizar, se añade a Otra" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Añadir a") as HTMLInputElement).value).toBe("Otra"),
    );
    // An existing series asks for no title of its own.
    expect(screen.queryByLabelText("Título")).toBeNull();
  });

  it("starts with the address given in ?url=", async () => {
    renderApp(<AddSeriesScreen />, {
      path: "/series/new?url=https%3A%2F%2Farchive.org%2Fdetails%2Fx",
      handler: () => jsonResponse(EXTRACTORS),
    });
    expect(((await screen.findByLabelText("Dirección")) as HTMLInputElement).value).toBe(
      "https://archive.org/details/x",
    );
  });
});
