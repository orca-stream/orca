import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route } from "wouter";
import { describe, expect, it } from "vite-plus/test";
import { makeEpisode, makeSeries } from "../test/fixtures";
import { jsonResponse, renderApp, type Handler } from "../test/render";
import { SeriesDetailScreen } from "./SeriesDetailScreen";
import { SeriesListScreen } from "./SeriesListScreen";

describe("SeriesListScreen", () => {
  it("shows a poster grid with availability, the following badge and the downloading chip", async () => {
    const handler: Handler = (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/api/series")
        return jsonResponse([
          makeSeries({ id: "s1", follow: true, downloadingCount: 2 }),
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

    const card = (await screen.findByText("Beverly Hillbillies")).closest("a")!;
    expect(within(card).getByText(/12\/36 disponibles/)).toBeTruthy();
    expect(within(card).getByText("Siguiendo")).toBeTruthy();
    expect(within(card).getByText("Descargando 2")).toBeTruthy();
    // The count comes with the series: the list doesn't go and fetch the queue to work it out.
    expect(requests.some((r) => new URL(r.url).pathname === "/api/jobs")).toBe(false);
    expect(card.getAttribute("href")).toBe("/series/s1");
    expect(card.querySelector("img")?.getAttribute("src")).toBe("/api/series/s1/poster");

    const other = screen.getByText("Other").closest("a")!;
    expect(other.querySelector("img")).toBeNull();
    expect(within(other).queryByText("Siguiendo")).toBeNull();
  });

  it("invites to add the first series when there are none", async () => {
    renderApp(<SeriesListScreen />, {
      handler: (request) =>
        new URL(request.url).pathname === "/api/series"
          ? jsonResponse([])
          : jsonResponse({ items: [], nextCursor: null }),
    });
    expect(await screen.findByText("Todavía no hay series.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Añadir serie" }).getAttribute("href")).toBe(
      "/series/new",
    );
  });
});

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

function detailSetup() {
  const handler: Handler = (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/api/series/s1" && request.method === "GET")
      return jsonResponse(makeSeries());
    if (url.pathname === "/api/series/s1" && request.method === "PATCH")
      return jsonResponse(makeSeries({ follow: true }));
    if (url.pathname === "/api/series/s1/episodes") return jsonResponse(EPISODES);
    if (url.pathname === "/api/jobs" && request.method === "POST") return jsonResponse([], 201);
    return jsonResponse({}, 404);
  };
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
  it("lists the episodes by season with their status and the progress of what downloads", async () => {
    detailSetup();
    expect(await screen.findByRole("heading", { name: "Beverly Hillbillies" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Temporada 1" })).toBeTruthy();
    const season2 = screen.getByRole("region", { name: "Temporada 2" });
    expect(within(season2).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(within(screen.getByText("Tres").closest("tr")!).getByText("Fallido")).toBeTruthy();
    expect(
      (screen.getByRole("checkbox", { name: "Seleccionar S02E01" }) as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("downloads the missing ones, which includes the failed", async () => {
    const user = userEvent.setup();
    const { posted } = detailSetup();
    await user.click(await screen.findByRole("button", { name: "Descargar los que faltan" }));
    await waitFor(async () => expect(await posted()).toEqual([{ episodeIds: ["e2", "e3", "e5"] }]));
  });

  it("downloads exactly the selected episodes, by season or one by one", async () => {
    const user = userEvent.setup();
    const { posted } = detailSetup();
    await screen.findByRole("heading", { name: "Beverly Hillbillies" });
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar la temporada 2" }));
    await user.click(screen.getByRole("checkbox", { name: "Seleccionar S01E02" }));
    await user.click(screen.getByRole("button", { name: "Descargar seleccionados (2)" }));
    await waitFor(async () => expect(await posted()).toEqual([{ episodeIds: ["e2", "e5"] }]));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: /Descargar seleccionados/ }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
  });

  it("retries a failed episode on its own", async () => {
    const user = userEvent.setup();
    const { posted } = detailSetup();
    await user.click(
      await within((await screen.findByText("Tres")).closest("tr")!).findByRole("button", {
        name: "Reintentar",
      }),
    );
    await waitFor(async () => expect(await posted()).toEqual([{ episodeIds: ["e3"] }]));
  });

  it("follows the series and changes the check interval through PATCH", async () => {
    const user = userEvent.setup();
    const { requests } = detailSetup();
    await user.click(await screen.findByRole("switch", { name: "Seguir la serie" }));
    const interval = screen.getByLabelText("Revisar cada (horas)");
    await user.clear(interval);
    await user.type(interval, "6");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => {
      const bodies = requests.filter((r) => r.method === "PATCH");
      expect(bodies).toHaveLength(2);
    });
    const patches = await Promise.all(
      requests.filter((r) => r.method === "PATCH").map((r) => r.json()),
    );
    expect(patches).toEqual([{ follow: true }, { checkIntervalHours: 6 }]);
  });

  it("says when the series does not exist", async () => {
    renderApp(
      <Route path="/series/:id">
        <SeriesDetailScreen />
      </Route>,
      { handler: () => jsonResponse({ error: "not_found" }, 404), path: "/series/nope" },
    );
    expect(await screen.findByText("No existe esa serie.")).toBeTruthy();
  });
});
