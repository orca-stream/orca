import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "wouter";
import { describe, expect, it } from "vite-plus/test";
import { makeEpisode, makeJob, makeSeries } from "@/test/fixtures";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { SeriesDetailScreen } from "./SeriesDetailScreen";
import { SeriesListScreen } from "./SeriesListScreen";

describe("SeriesListScreen", () => {
  it("shows a card per series with its cover, availability, the following and downloading chips", async () => {
    const handler: Handler = (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/series")
        return jsonResponse([
          makeSeries({
            id: "s1",
            follow: true,
            downloadingCount: 2,
            running: [{ episodeId: "e1", progress: 0.45 }],
          }),
          makeSeries({
            id: "s2",
            title: "Other",
            hasPoster: false,
            availableCount: 0,
            episodeCount: 5,
          }),
        ]);
      return jsonResponse({}, 404);
    };
    const { requests } = renderApp(<SeriesListScreen />, { handler, path: "/series" });

    const link = await screen.findByRole("link", { name: "Beverly Hillbillies" });
    expect(link.getAttribute("href")).toBe("/series/s1");
    const card = link.closest("li")!;
    expect(within(card).getByText(/12\/36/)).toBeTruthy();
    expect(within(card).getByText("Siguiendo")).toBeTruthy();
    expect(within(card).getByRole("img", { name: "2 por descargar · 45 %" })).toBeTruthy();
    // The count comes with the series: the list doesn't go and fetch the queue to work it out.
    expect(requests.some((r) => new URL(r.url).pathname === "/api/jobs")).toBe(false);
    expect(card.querySelector("img")?.getAttribute("src")).toBe("/api/series/s1/poster?v=0");

    const other = screen.getByRole("link", { name: "Other" }).closest("li")!;
    expect(other.querySelector("img")).toBeNull();
    expect(within(other).queryByText("Siguiendo")).toBeNull();
  });

  it("flags a followed show that ended and a show airing that isn't followed, as TMDB says", async () => {
    renderApp(<SeriesListScreen />, {
      handler: (request) => {
        const { pathname } = new URL(request.url);
        if (pathname === "/api/series")
          return jsonResponse([
            makeSeries({ id: "s1", title: "Done", follow: true, tmdbId: "1" }),
            makeSeries({ id: "s2", title: "Live", follow: false, tmdbId: "2" }),
            makeSeries({ id: "s3", title: "Fine", follow: true, tmdbId: "3" }),
            makeSeries({ id: "s4", title: "Between", follow: false, tmdbId: "4" }),
          ]);
        const status = { "1": "ended", "2": "airing", "3": "airing", "4": "returning" }[
          pathname.split("/").pop()!
        ];
        if (status) return jsonResponse({ tmdbId: pathname.split("/").pop(), status });
        return jsonResponse({}, 404);
      },
      path: "/series",
    });
    const card = async (name: string) => (await screen.findByRole("link", { name })).closest("li")!;
    const done = await card("Done");
    expect(await within(done).findByText("Siguiendo · Finalizada")).toBeTruthy();
    expect(within(done).queryByText("Siguiendo")).toBeNull();
    expect(await within(await card("Live")).findByText("En emisión")).toBeTruthy();
    const fine = await card("Fine");
    await waitFor(() => expect(within(fine).getByText("Siguiendo")).toBeTruthy());
    expect(within(fine).queryByText("En emisión")).toBeNull();
    // More is expected but nothing is dated: between seasons, so not airing.
    expect(within(await card("Between")).queryByText("En emisión")).toBeNull();
  });

  it("borrows the TMDB cover for a series the server has none of", async () => {
    renderApp(<SeriesListScreen />, {
      handler: (request) => {
        const { pathname } = new URL(request.url);
        if (pathname === "/api/series")
          return jsonResponse([makeSeries({ hasPoster: false, tmdbId: "105009" })]);
        if (pathname === "/api/lookup/tmdb/105009")
          return jsonResponse({ tmdbId: "105009", posterUrl: "https://img/p.jpg" });
        return jsonResponse({}, 404);
      },
      path: "/series",
    });
    const card = (await screen.findByRole("link", { name: "Beverly Hillbillies" })).closest("li")!;
    await waitFor(() =>
      expect(card.querySelector("img")?.getAttribute("src")).toBe("https://img/p.jpg"),
    );
  });

  it("invites to add the first series when there are none", async () => {
    renderApp(<SeriesListScreen />, {
      handler: (request) =>
        ["/api/series", "/api/extractors"].includes(new URL(request.url).pathname)
          ? jsonResponse([])
          : jsonResponse({ items: [], nextCursor: null }),
    });
    expect(await screen.findByText(/Todavía no hay nada\./)).toBeTruthy();
    expect(
      within(screen.getByRole("list")).getByRole("link", { name: "Añadir" }).getAttribute("href"),
    ).toBe("/series/new");
  });

  it('opens the search on "/" with the field ready to type into', async () => {
    const user = userEvent.setup();
    renderApp(<SeriesListScreen />, {
      handler: (request) =>
        new URL(request.url).pathname === "/api/series"
          ? jsonResponse([
              makeSeries({ id: "s1", title: "Pokémon" }),
              makeSeries({ id: "s2", title: "Bonanza" }),
            ])
          : new URL(request.url).pathname === "/api/extractors"
            ? jsonResponse([
                {
                  id: "tv-anime",
                  name: "TV Anime",
                  hosts: ["tv.test"],
                  example: "https://tv.test/x",
                  explicit: true,
                  searchable: false,
                },
              ])
            : jsonResponse([]),
      path: "/series",
    });
    await screen.findByRole("link", { name: "Bonanza" });

    await user.keyboard("/");
    const field = screen.getByRole("searchbox", { name: "Buscar por título" });
    expect(document.activeElement).toBe(field);
    // The slash opened it; it isn't the start of the query.
    await user.keyboard("poke/");
    expect((field as HTMLInputElement).value).toBe("poke/");
    expect(screen.queryByRole("link", { name: "Bonanza" })).toBeNull();
  });

  it("turns the dock into a search that narrows the series, clears it and closes", async () => {
    const user = userEvent.setup();
    renderApp(<SeriesListScreen />, {
      handler: (request) =>
        new URL(request.url).pathname === "/api/series"
          ? jsonResponse([
              makeSeries({ id: "s1", title: "Pokémon" }),
              makeSeries({ id: "s2", title: "Bonanza" }),
            ])
          : new URL(request.url).pathname === "/api/extractors"
            ? jsonResponse([
                {
                  id: "tv-anime",
                  name: "TV Anime",
                  hosts: ["tv.test"],
                  example: "https://tv.test/x",
                  explicit: true,
                  searchable: false,
                },
              ])
            : jsonResponse([]),
      path: "/series",
    });
    await screen.findByRole("link", { name: "Bonanza" });
    const dock = screen.getByRole("navigation", { name: "Atajos" });
    expect(within(dock).getByRole("link", { name: "Inicio" }).getAttribute("href")).toBe("/");
    // The same three places on every screen, the one you are on lit rather than gone.
    expect(within(dock).getByRole("link", { name: "Series" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(dock).getByRole("link", { name: "Ajustes" }).getAttribute("href")).toBe(
      "/settings",
    );
    // One "+" opens the extractors to add a series with.
    await user.click(await within(dock).findByRole("button", { name: "Añadir" }));
    expect((await screen.findByRole("link", { name: "TV Anime" })).getAttribute("href")).toBe(
      "/series/new?extractor=tv-anime",
    );
    await user.keyboard("{Escape}");

    await user.click(within(dock).getByRole("button", { name: "Buscar por título" }));
    const field = screen.getByRole("searchbox", { name: "Buscar por título" });
    await user.type(field, "pokemon");
    expect(screen.getByRole("link", { name: "Pokémon" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Bonanza" })).toBeNull();

    await user.type(field, "x");
    expect(screen.getByText("Nada coincide con «pokemonx».")).toBeTruthy();

    await user.click(within(dock).getByRole("button", { name: "Limpiar la búsqueda" }));
    expect((field as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("link", { name: "Bonanza" })).toBeTruthy();

    await user.click(within(dock).getByRole("button", { name: "Cerrar la búsqueda" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(within(dock).getByRole("button", { name: "Buscar por título" })).toBeTruthy();
    // The field that held focus is gone: once the pointer leaves, nothing keeps the dock up.
    await user.hover(within(dock).getByRole("button", { name: "Buscar por título" }));
    await user.hover(screen.getByRole("link", { name: "Bonanza" }));
    await waitFor(() => expect(dock.parentElement!.hasAttribute("data-open")).toBe(false));
  });
});

/** The page itself, without the dock (portalled after it), which repeats some of its actions. */
const page = () => within(document.body.firstElementChild as HTMLElement);

const EPISODES = [
  makeEpisode({ id: "e1", season: 1, episode: 1, title: "Uno", status: "available" }),
  makeEpisode({ id: "e2", season: 1, episode: 2, title: "Dos", status: "missing" }),
  makeEpisode({ id: "e3", season: 1, episode: 3, title: "Tres", status: "failed" }),
  makeEpisode({
    id: "e4",
    season: 2,
    episode: 1,
    title: "Cuatro",
    status: "downloading",
    progress: 0.5,
  }),
  makeEpisode({ id: "e5", season: 2, episode: 2, title: "Cinco", status: "missing" }),
];

const detailHandler: Handler = (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/api/series/s1" && request.method === "GET")
    return jsonResponse(makeSeries());
  if (url.pathname === "/api/series/s1" && request.method === "PATCH")
    return jsonResponse(makeSeries({ follow: true }));
  if (url.pathname === "/api/series/s1/episodes") return jsonResponse(EPISODES);
  if (url.pathname === "/api/jobs" && request.method === "POST") return jsonResponse([], 201);
  if (url.pathname === "/api/series/s1/episodes/e1/file" && request.method === "DELETE")
    return jsonResponse({ ...EPISODES[0], status: "missing", filePath: null });
  if (url.pathname === "/api/series/s1" && request.method === "DELETE")
    return new Response(null, { status: 204 });
  if (url.pathname === "/api/series/s1/check" && request.method === "POST")
    return jsonResponse(makeJob({ kind: "check_series", episodeId: null, episodeCode: null }), 202);
  return jsonResponse({}, 404);
};

function detailSetup() {
  const handler = detailHandler;
  const view = renderApp(
    <Route path="/series/:id">
      <SeriesDetailScreen />
    </Route>,
    { handler, path: "/series/s1" },
  );
  const posted = async () => {
    const post = view.requests.filter(
      (r) => r.method === "POST" && new URL(r.url).pathname === "/api/jobs",
    );
    return Promise.all(post.map((r) => r.clone().json()));
  };
  return { ...view, posted };
}

describe("SeriesDetailScreen", () => {
  it("lists the episodes a season at a time with their status and the progress of what downloads", async () => {
    const user = userEvent.setup();
    detailSetup();
    expect(await screen.findByRole("heading", { name: "Beverly Hillbillies" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Temporada 1" })).toBeTruthy();
    expect(within(screen.getByText("Tres").closest("article")!).getByText("Fallido")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Temporada 2" })).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Temporada que se muestra" }));
    await user.click(await screen.findByRole("option", { name: /^Temporada 2/ }));
    const season2 = screen.getByRole("region", { name: "Temporada 2" });
    expect(within(season2).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(
      screen.getByRole("checkbox", { name: "Seleccionar S02E01" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("lists a season TMDB has and no source brings, with its episodes as gaps", async () => {
    const user = userEvent.setup();
    const guideEpisode = (number: number, airDate: string | null) => ({
      number,
      name: `Ep ${number}`,
      airDate,
      overview: null,
      runtimeMin: null,
      stillUrl: null,
    });
    renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      {
        path: "/series/s1",
        handler: (request) => {
          const { pathname } = new URL(request.url);
          if (pathname === "/api/series/s1") return jsonResponse(makeSeries({ tmdbId: "9" }));
          if (pathname === "/api/lookup/tmdb/9/seasons")
            return jsonResponse(
              [1, 2, 3].map((number) => ({
                number,
                name: `S${number}`,
                episodeCount: 2,
                year: 2020,
              })),
            );
          if (pathname === "/api/lookup/tmdb/9/seasons/3")
            return jsonResponse([guideEpisode(1, "2020-01-01"), guideEpisode(2, null)]);
          if (pathname.startsWith("/api/lookup/tmdb/9/seasons/")) return jsonResponse([]);
          return detailHandler(request);
        },
      },
    );
    await user.click(await screen.findByRole("combobox", { name: "Temporada que se muestra" }));
    await user.click(await screen.findByRole("option", { name: /^Temporada 3\s*0\/2/ }));
    const season3 = screen.getByRole("region", { name: "Temporada 3" });
    expect(await within(season3).findByText("Ep 1")).toBeTruthy();
    expect(within(season3).getByText("Ep 2")).toBeTruthy();
    expect(within(season3).getByText("En ninguna fuente")).toBeTruthy();
  });

  it("downloads the missing ones, which includes the failed", async () => {
    const user = userEvent.setup();
    const { posted } = detailSetup();
    await user.click(await page().findByRole("button", { name: "Descargar los que faltan" }));
    await waitFor(async () => expect(await posted()).toEqual([{ episodeIds: ["e2", "e3", "e5"] }]));
  });

  it("downloads exactly the selected episodes, one by one across seasons or a whole season", async () => {
    const user = userEvent.setup();
    const { posted } = detailSetup();
    await screen.findByRole("heading", { name: "Beverly Hillbillies" });
    // Nothing picked, nothing to do with it: the bar only comes with a pick.
    expect(screen.queryByRole("toolbar")).toBeNull();
    await user.click(screen.getByRole("combobox", { name: "Temporada que se muestra" }));
    await user.click(await screen.findByRole("option", { name: /^Temporada 2/ }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar S02E02" }));
    await user.click(screen.getByRole("combobox", { name: "Temporada que se muestra" }));
    await user.click(await screen.findByRole("option", { name: /^Temporada 1/ }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar S01E02" }));
    expect(screen.getByRole("toolbar", { name: "2 seleccionados" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Descargar (2)" }));
    await waitFor(async () => expect(await posted()).toEqual([{ episodeIds: ["e2", "e5"] }]));
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar S01E03" }));
    await user.click(screen.getByRole("button", { name: "Seleccionar la temporada 1" }));
    await user.click(screen.getByRole("button", { name: "Descargar (3)" }));
    await waitFor(async () =>
      expect((await posted()).at(-1)).toEqual({ episodeIds: ["e1", "e2", "e3"] }),
    );
  });

  it("clears the selection without downloading anything", async () => {
    const user = userEvent.setup();
    const { posted } = detailSetup();
    await user.click(await screen.findByRole("checkbox", { name: "Seleccionar S01E02" }));
    await user.click(screen.getByRole("button", { name: "Quitar selección" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(await posted()).toEqual([]);
  });

  it("shows only the button that was pressed as busy while its request is in flight", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    let gate = Promise.resolve();
    const hold = () => {
      gate = new Promise<void>((resolve) => (release = resolve));
    };
    hold();
    const ok = detailHandler;
    renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      {
        handler: async (request) => {
          if (request.method === "POST" && new URL(request.url).pathname === "/api/jobs")
            await gate;
          return ok(request);
        },
        path: "/series/s1",
      },
    );
    await screen.findByRole("heading", { name: "Beverly Hillbillies" });
    const missing = page().getByRole("button", { name: "Descargar los que faltan" });
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar S01E02" }));
    const selected = screen.getByRole("button", { name: "Descargar (1)" });
    await user.click(selected);
    await waitFor(() => expect(selected.getAttribute("aria-busy")).toBe("true"));
    expect(missing.getAttribute("aria-busy")).toBeNull();
    expect((missing as HTMLButtonElement).disabled).toBe(true);
    release();
    // Once queued, the pick is done with: its bar goes.
    await waitFor(() => expect(screen.queryByRole("toolbar")).toBeNull());

    hold();
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar S01E01" }));
    await user.click(missing);
    await waitFor(() => expect(missing.getAttribute("aria-busy")).toBe("true"));
    const waiting = screen.getByRole("button", { name: "Descargar (1)" }) as HTMLButtonElement;
    expect(waiting.getAttribute("aria-busy")).toBeNull();
    expect(waiting.disabled).toBe(true);
    release();
  });

  it("retries a failed episode on its own", async () => {
    const user = userEvent.setup();
    const { posted } = detailSetup();
    await user.click(
      await within((await screen.findByText("Tres")).closest("article")!).findByRole("button", {
        name: "Reintentar",
      }),
    );
    await waitFor(async () => expect(await posted()).toEqual([{ episodeIds: ["e3"] }]));
  });

  it("deletes a downloaded episode's file only once asked twice, and only on that one", async () => {
    const user = userEvent.setup();
    const view = detailSetup();
    const card = (await screen.findByText("Uno")).closest("article")!;
    // Only a downloaded episode has a file to delete.
    expect(
      within(screen.getByText("Dos").closest("article")!).queryByRole("button", {
        name: "Borrar el archivo de S01E02",
      }),
    ).toBeNull();
    await user.click(within(card).getByRole("button", { name: "Borrar el archivo de S01E01" }));
    const deletes = () => view.requests.filter((r) => r.method === "DELETE");
    expect(deletes()).toHaveLength(0);
    // Keeping it closes the question, and the click never picks the episode.
    await user.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("toolbar")).toBeNull();
    await user.click(within(card).getByRole("button", { name: "Borrar el archivo de S01E01" }));
    await user.click(await screen.findByRole("button", { name: "Borrar" }));
    await waitFor(() =>
      expect(deletes().map((r) => new URL(r.url).pathname)).toEqual([
        "/api/series/s1/episodes/e1/file",
      ]),
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("deletes the whole series once asked, its files only with the switch on, and goes back to the list", async () => {
    const user = userEvent.setup();
    const view = detailSetup();
    await screen.findByText("Uno");
    const deletes = () => view.requests.filter((r) => r.method === "DELETE");
    await user.click(screen.getByRole("button", { name: "Borrar la serie" }));
    expect(await screen.findByText(/Jellyfin la sigue mostrando/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(deletes()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Borrar la serie" }));
    await user.click(await screen.findByRole("switch", { name: "Borrar también sus archivos" }));
    expect(screen.getByText(/No se puede deshacer/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Borrar" }));
    await waitFor(() => expect(view.location.history.at(-1)).toBe("/series"));
    expect(deletes().map((r) => new URL(r.url).pathname + new URL(r.url).search)).toEqual([
      "/api/series/s1?files=true",
    ]);
  });

  it("moves the picked episodes to another source without downloading them, and sets a season's preferred one", async () => {
    const user = userEvent.setup();
    const other = {
      id: "b",
      extractorId: "site-b",
      externalId: "b",
      sourceUrl: "https://origin.example/show/b",
      season: 1,
      episodeOffset: 0,
      adjustments: [],
      listedSeasons: null,
      closed: false,
      nextUrl: null,
    };
    const series = makeSeries();
    const withTwo = { ...series, sources: [...series.sources, other] };
    // The preference is held until the test lets it through, to see it on its way.
    let letPatch = () => {};
    const patchHeld = new Promise<void>((resolve) => (letPatch = resolve));
    const view = renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      {
        path: "/series/s1",
        handler: (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/api/series/s1" && request.method === "PATCH")
            return patchHeld.then(() => jsonResponse(withTwo));
          if (url.pathname === "/api/series/s1") return jsonResponse(withTwo);
          if (url.pathname === "/api/series/s1/episodes")
            return jsonResponse([
              makeEpisode({ id: "e1", episode: 1, title: "Uno", status: "available" }),
              makeEpisode({
                id: "e2",
                episode: 2,
                title: "Dos",
                sourceId: "b",
                fileOutdated: true,
                fileSourceId: "s1",
                status: "available",
              }),
            ]);
          if (url.pathname === "/api/series/s1/episodes/source")
            return jsonResponse({ switched: 1, notListed: ["S01E01"], busy: [] });
          return detailHandler(request);
        },
      },
    );
    // Its file is the old source's until it is downloaded again, and it says which.
    const two = (await screen.findByText("Dos")).closest("article")!;
    expect(within(two).getByLabelText(/^Descargado de /)).toBeTruthy();
    expect(
      within(screen.getByText("Uno").closest("article")!).queryByLabelText(/^Descargado de /),
    ).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Seleccionar S01E01" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar S01E02" }));
    await user.click(screen.getByRole("button", { name: "Cambiar fuente" }));
    await user.click(await screen.findByRole("button", { name: /origin\.example\/show\/b/ }));

    const sent = () =>
      view.requests.filter((r) => new URL(r.url).pathname === "/api/series/s1/episodes/source");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(await sent()[0]!.json()).toEqual({ sourceId: "b", episodeIds: ["e1", "e2"] });
    expect(
      await screen.findByText(
        "1 episodio toma su vídeo de la otra fuente. Esa fuente no tiene S01E01.",
      ),
    ).toBeTruthy();
    // Nothing was queued: downloading is asked for apart.
    expect(view.requests.some((r) => new URL(r.url).pathname === "/api/jobs")).toBe(false);

    await user.click(screen.getByRole("combobox", { name: "Fuente preferida de la temporada 1" }));
    await user.click(await screen.findByRole("option", { name: /origin\.example\/show\/b/ }));
    // It says at once that it is on it, until the season has moved.
    const preferred = screen.getByRole("combobox", { name: "Fuente preferida de la temporada 1" });
    expect(preferred.getAttribute("aria-busy")).toBe("true");
    expect(within(preferred).queryByText("Cualquier fuente")).toBeNull();
    letPatch();
    await waitFor(() => expect(preferred.getAttribute("aria-busy")).toBeNull());
    const patch = () => view.requests.find((r) => r.method === "PATCH");
    await waitFor(() => expect(patch()).toBeTruthy());
    expect(await patch()!.json()).toEqual({ preferredSources: { "1": "b" } });
    // Preferring it moves the season's episodes to it: those not on it yet.
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(await sent()[1]!.json()).toEqual({ sourceId: "b", episodeIds: ["e1"] });
  });

  it("pauses the series' downloads at once, and shows a paused series as such", async () => {
    const user = userEvent.setup();
    let paused = false;
    const view = renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      {
        path: "/series/s1",
        handler: (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/api/series/s1" && request.method === "PATCH") {
            paused = true;
            return jsonResponse(makeSeries({ paused: true, downloadingCount: 1 }));
          }
          if (url.pathname === "/api/series/s1")
            return jsonResponse(makeSeries({ paused, downloadingCount: 1 }));
          if (url.pathname === "/api/series/s1/episodes")
            return jsonResponse([
              makeEpisode({ id: "e1", season: 1, episode: 1, title: "Uno", status: "queued" }),
            ]);
          return detailHandler(request);
        },
      },
    );
    expect(await screen.findByText("1 por descargar")).toBeTruthy();
    // Not a setting: it goes out alone, without waiting for Save.
    await user.click(screen.getByRole("button", { name: "Pausar" }));
    await waitFor(() => expect(view.requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(await view.requests.find((r) => r.method === "PATCH")!.json()).toEqual({ paused: true });
    expect(await screen.findByText("En pausa · 1 en cola")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reanudar" })).toBeTruthy();
    expect(within(screen.getByText("Uno").closest("article")!).getByText("En pausa")).toBeTruthy();
  });

  it("saves a switch at once and a typed setting once the typing stops, with no Save", async () => {
    const user = userEvent.setup();
    const { requests } = detailSetup();
    const patches = () => requests.filter((r) => r.method === "PATCH");
    await user.click(await screen.findByRole("switch", { name: "Seguir la serie" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(await patches()[0]!.json()).toEqual({ follow: true });
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).toBeNull();

    const interval = screen.getByLabelText("Buscar episodios nuevos cada (horas)");
    await user.clear(interval);
    await user.type(interval, "6");
    // Not a request per key: one, once the typing stops.
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(await patches()[1]!.json()).toMatchObject({ checkIntervalHours: 6 });
  });

  it("says when a change could not be saved and tries it again", async () => {
    const user = userEvent.setup();
    let fail = true;
    const handler: Handler = (request) =>
      request.method === "PATCH" && fail
        ? jsonResponse({ error: "boom" }, 500)
        : detailHandler(request);
    const { requests } = renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      { handler, path: "/series/s1" },
    );
    await user.click(await screen.findByRole("switch", { name: "Seguir la serie" }));
    expect(await screen.findByText("No se pudieron guardar los cambios.")).toBeTruthy();
    fail = false;
    const form = screen.getByRole("form", { name: "Ajustes de la serie" });
    await user.click(within(form).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(2));
  });

  it("shows the last and the next check of a followed series, and checks now on demand", async () => {
    const user = userEvent.setup();
    let lastCheckedAt = Date.now() - 3_600_000;
    const handler: Handler = (request) =>
      new URL(request.url).pathname === "/api/series/s1" && request.method === "GET"
        ? jsonResponse(makeSeries({ follow: true, checkIntervalHours: 24, lastCheckedAt }))
        : detailHandler(request);
    const { requests, queryClient } = renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      { handler, path: "/series/s1" },
    );
    expect(await screen.findByText(/Última búsqueda de episodios nuevos hace 1 hora/)).toBeTruthy();
    expect(screen.getByText(/Próxima búsqueda dentro de 23 horas/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Buscar ahora" }));
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series/s1/check",
        ),
      ).toBe(true),
    );
    expect((await screen.findAllByText("Búsqueda en cola.")).length).toBeGreaterThan(0);
    // Once the check has run, the series is refetched with its new time and the row shows it.
    lastCheckedAt = Date.now();
    await queryClient.invalidateQueries();
    expect(
      (await screen.findAllByText(/Última búsqueda de episodios nuevos/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText("Búsqueda en cola.")).toHaveLength(0);
  });

  it("looks for new episodes from the dock too, beside the ways home and to the series", async () => {
    const user = userEvent.setup();
    const { requests } = detailSetup();
    await screen.findByRole("heading", { name: "Beverly Hillbillies" });
    const dock = screen.getByRole("navigation", { name: "Atajos" });
    expect(within(dock).getByRole("link", { name: "Series" }).getAttribute("href")).toBe("/series");
    await user.click(within(dock).getByRole("button", { name: "Buscar episodios nuevos ahora" }));
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "POST" && new URL(r.url).pathname === "/api/series/s1/check",
        ),
      ).toBe(true),
    );
    // The button beside the interval shares its state.
    expect((await screen.findAllByText("Búsqueda en cola.")).length).toBeGreaterThan(0);
  });

  it("offers one more source and the missing episodes from the dock", async () => {
    const user = userEvent.setup();
    const { requests } = detailSetup();
    await screen.findByRole("heading", { name: "Beverly Hillbillies" });
    const dock = screen.getByRole("navigation", { name: "Atajos" });
    expect(
      within(dock).getByRole("link", { name: "Añadir otra fuente" }).getAttribute("href"),
    ).toBe(page().getByRole("link", { name: "Añadir otra fuente" }).getAttribute("href"));
    await user.click(within(dock).getByRole("button", { name: "Descargar los que faltan" }));
    await waitFor(() =>
      expect(
        requests.some((r) => r.method === "POST" && new URL(r.url).pathname === "/api/jobs"),
      ).toBe(true),
    );
  });

  it("does not promise a next check for a series that is not followed", async () => {
    detailSetup();
    await screen.findByRole("heading", { name: "Beverly Hillbillies" });
    expect(screen.queryByText(/Próxima búsqueda/)).toBeNull();
    expect(screen.getByRole("button", { name: "Buscar ahora" })).toBeTruthy();
  });

  it("saves the series' own quality and tracks as they are picked, sending only what changed", async () => {
    const user = userEvent.setup();
    const { requests } = detailSetup();
    const form = await screen.findByRole("form", { name: "Ajustes de la serie" });
    const lastPatch = async () => {
      const patches = requests.filter((r) => r.method === "PATCH");
      return patches[patches.length - 1]!.clone().json();
    };

    await user.click(within(form).getByRole("combobox", { name: "Altura máxima del vídeo" }));
    await user.click(await screen.findByRole("option", { name: "Hasta 720p" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(await lastPatch()).toEqual({ maxHeight: 720 });
    const audio = within(form).getByRole("combobox", { name: "Idiomas de audio" });
    expect(audio.textContent).toBe("Audio: todos los idiomas");
    await user.click(audio);
    await user.click(await screen.findByRole("option", { name: /Español/ }));
    await user.click(screen.getByRole("option", { name: /Inglés/ }));
    await user.keyboard("{Escape}");
    // The first picked is the original: the order is the one they were picked in.
    expect(audio.textContent).toBe("Audio: Español, Inglés");
    const subtitles = within(form).getByRole("combobox", { name: "Idiomas de subtítulos" });
    await user.click(subtitles);
    await user.click(await screen.findByRole("option", { name: /Sin subtítulos/ }));
    await user.keyboard("{Escape}");
    expect(subtitles.textContent).toBe("Sin subtítulos");
    await waitFor(async () => expect(await lastPatch()).toMatchObject({ subtitleLangs: [] }));
  });

  it("saves the TMDB and IMDb ids, refusing one that is not an id", async () => {
    const user = userEvent.setup();
    const { requests } = detailSetup();
    const form = await screen.findByRole("form", { name: "Ajustes de la serie" });
    await user.type(within(form).getByLabelText("Id de IMDb"), "nope");
    await user.tab();
    // Not an id: nothing is sent, however long it waits.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    await user.clear(within(form).getByLabelText("Id de IMDb"));
    await user.type(within(form).getByLabelText("Id de TMDB"), "12345");
    await user.tab();
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(await requests.find((r) => r.method === "PATCH")!.json()).toEqual({ tmdbId: "12345" });
  });

  it("folds two or more addresses under a header that counts them, and closes one once unfolded", async () => {
    const user = userEvent.setup();
    const base = makeSeries().sources[0]!;
    const { requests } = renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      {
        path: "/series/s1",
        handler: (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/api/series/s1") {
            return jsonResponse(
              makeSeries({
                sources: [
                  { ...base, id: "a", sourceUrl: "https://site.test/part-1" },
                  {
                    ...base,
                    id: "b",
                    sourceUrl: "https://site.test/part-2",
                    season: 1,
                    episodeOffset: 12,
                  },
                  // Closed: the newest open one is still part 2.
                  { ...base, id: "c", sourceUrl: "https://site.test/extras", closed: true },
                ],
              }),
            );
          }
          if (url.pathname === "/api/series/s1/sources/a") return jsonResponse(makeSeries());
          if (url.pathname === "/api/series/s1/episodes") return jsonResponse(EPISODES);
          return jsonResponse({}, 404);
        },
      },
    );
    // Folded: a header that counts them, and none of the addresses.
    expect(await screen.findByText("3 fuentes")).toBeTruthy();
    expect(screen.getByText("2 se leen al buscar episodios nuevos · 1 cerrada")).toBeTruthy();
    expect(screen.queryByText("site.test/part-2")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cerrar/ })).toBeNull();
    // One more address goes through adding a series, with this one already chosen.
    expect(page().getByRole("link", { name: "Añadir otra fuente" }).getAttribute("href")).toBe(
      "/series/new?into=s1",
    );

    await user.click(screen.getByRole("button", { name: "Ver todas las fuentes" }));
    expect(await screen.findByText("site.test/part-1")).toBeTruthy();
    expect(
      screen.getByText("Sus episodios van a la temporada 1, el 1 del sitio es el episodio 13"),
    ).toBeTruthy();
    expect(screen.getAllByText("Episodios con el número que les da el sitio")).toHaveLength(2);
    expect(screen.getByText("Cerrada")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reabrir: https://site.test/extras" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cerrar: https://site.test/part-2" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Cerrar: https://site.test/part-1" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(new URL(patch.url).pathname).toBe("/api/series/s1/sources/a");
    expect(await patch.json()).toEqual({ closed: true });
  });

  it("sends the address of what comes after the latest source along with one more source", async () => {
    const base = makeSeries().sources[0]!;
    const show = "https://site.test/series/x";
    renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      {
        path: "/series/s1",
        handler: (request) => {
          const url = new URL(request.url);
          if (url.pathname === "/api/series/s1") {
            return jsonResponse(
              makeSeries({
                sources: [
                  // Listed by season: the second is the latest, whatever order they came in.
                  {
                    ...base,
                    id: "b",
                    sourceUrl: `${show}?season=2`,
                    season: 2,
                    nextUrl: `${show}?season=3`,
                  },
                  {
                    ...base,
                    id: "a",
                    sourceUrl: `${show}?season=1`,
                    season: 1,
                    nextUrl: `${show}?season=2`,
                  },
                ],
              }),
            );
          }
          if (url.pathname === "/api/series/s1/episodes") return jsonResponse([]);
          return jsonResponse({}, 404);
        },
      },
    );
    const link = await page().findByRole("link", { name: "Añadir otra fuente" });
    expect(new URLSearchParams(link.getAttribute("href")!.split("?")[1]).get("url")).toBe(
      `${show}?season=3`,
    );
  });

  it("shows the button that closes a lone source without anything to unfold", async () => {
    detailSetup();
    expect(
      await screen.findByRole("button", { name: "Cerrar: https://archive.org/details/bevhill" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /fuentes/ })).toBeNull();
    expect(screen.getByText("archive.org/details/bevhill")).toBeTruthy();
    // What it holds, from its episodes: a season at a time.
    expect(
      await screen.findByText("Temporada 1, episodios 1 al 3 · Temporada 2, episodios 1 al 2"),
    ).toBeTruthy();
    expect(page().getByRole("link", { name: "Añadir otra fuente" })).toBeTruthy();
  });

  it("says when the series does not exist", async () => {
    renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      { handler: () => jsonResponse({ error: "not_found" }, 404), path: "/series/nope" },
    );
    expect(await screen.findByText("No existe.")).toBeTruthy();
  });
});
