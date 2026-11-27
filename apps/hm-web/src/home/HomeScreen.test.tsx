import type { EpisodeDto, JobDto, NotificationDto, SeriesDto } from "@orca/hm-contract";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";
import { makeEpisode, makeJob, makeSeries } from "@/test/fixtures";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { HomeScreen } from "./HomeScreen";

function handlerFor({
  series = [] as SeriesDto[],
  active = [] as JobDto[],
  failed = [] as JobDto[],
  history = [] as JobDto[],
  extractors = [] as { id: string; name: string }[],
  notifications = [] as NotificationDto[],
  episodes = [] as EpisodeDto[],
  posted = [] as { path: string; body: unknown }[],
}): Handler {
  return async (request) => {
    const url = new URL(request.url);
    if (request.method === "POST") {
      posted.push({ path: url.pathname, body: await request.json() });
      return jsonResponse(url.pathname === "/api/jobs" ? [] : { unreadCount: 0 });
    }
    if (url.pathname === "/api/notifications") {
      return jsonResponse({ items: notifications, unreadCount: notifications.length });
    }
    if (url.pathname === "/api/series/s1/episodes") return jsonResponse(episodes);
    if (url.pathname === "/api/series") return jsonResponse(series);
    if (url.pathname === "/api/jobs") {
      const status = url.searchParams.get("status");
      const items = status === "failed" ? failed : status === "queued,running" ? active : history;
      return jsonResponse({ items, nextCursor: null });
    }
    if (url.pathname === "/api/extractors") return jsonResponse(extractors);
    return jsonResponse({ error: "not_found" }, 404);
  };
}

/** The card a heading names. */
async function card(name: string) {
  return (await screen.findByRole("heading", { name: new RegExp(`^${name}`) })).closest("section")!;
}

describe("HomeScreen", () => {
  it("sends what is typed to the add screen, where it searches the sites", async () => {
    const user = userEvent.setup();
    const { location } = renderApp(<HomeScreen />, { handler: handlerFor({}) });
    await user.type(
      screen.getByRole("textbox", { name: "Buscar una serie o una película para añadirla" }),
      "frieren{Enter}",
    );
    expect(location.history.at(-1)).toBe("/series/new?url=frieren");
  });

  it("with nothing yet, shows only the search and what it is for", async () => {
    renderApp(<HomeScreen />, { handler: handlerFor({}) });
    expect(await screen.findByText("Tu biblioteca está vacía")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Descargando ahora/ })).toBeNull();
  });

  it("counts the library in figures and shows what is downloading", async () => {
    renderApp(<HomeScreen />, {
      handler: handlerFor({
        series: [
          makeSeries({ id: "s1", title: "Popeye", downloadingCount: 1, availableCount: 36 }),
          makeSeries({ id: "s2", kind: "movie", title: "Nosferatu", episodeCount: 1 }),
        ],
        active: [makeJob({ status: "running", seriesTitle: "Popeye", progress: 0.5 })],
      }),
    });
    const figures = await screen.findByRole("list", { name: "Biblioteca" });
    expect(within(figures).getByText("Series").previousSibling?.textContent).toBe("1");
    expect(within(figures).getByText("Películas").previousSibling?.textContent).toBe("1");
    expect(within(figures).getByText("Episodios descargados").previousSibling?.textContent).toBe(
      "36",
    );
    const downloading = await card("Descargando ahora");
    expect(await within(downloading).findByText("Popeye")).toBeTruthy();
  });

  it("names the shows with episodes left, and every failed download across the width", async () => {
    renderApp(<HomeScreen />, {
      handler: handlerFor({
        series: [
          // 36 found, 12 here, 4 on their way: 20 left.
          makeSeries({ id: "s1", title: "Bonanza", downloadingCount: 4 }),
          makeSeries({ id: "s2", title: "Popeye", availableCount: 36 }),
        ],
        failed: [
          makeJob({ id: "j9", status: "failed", errorKind: "permanent", lastError: "HTTP 404" }),
        ],
      }),
    });
    const pending = await card("Sin descargar");
    const row = (await within(pending).findByText("20 sin descargar")).closest("a")!;
    expect(row.getAttribute("href")).toBe("/series/s1");
    expect(within(pending).queryByText("Popeye")).toBeNull();
    // Even a permanent error can be tried again: the site may have mended.
    const errors = await card("Descargas con error");
    expect(await within(errors).findByText("HTTP 404")).toBeTruthy();
    expect(
      within(errors).getByRole("button", { name: "Reintentar Beverly Hillbillies S01E01" }),
    ).toBeTruthy();
  });

  it("says when nothing is pending, and links the recent ones to the library", async () => {
    renderApp(<HomeScreen />, {
      handler: handlerFor({ series: [makeSeries({ availableCount: 36 })] }),
    });
    expect(await within(await card("Sin descargar")).findByText("Todo descargado.")).toBeTruthy();
    expect(
      await within(await card("Descargando ahora")).findByText("Nada descargándose"),
    ).toBeTruthy();
    const recent = await card("Recientes");
    expect(within(recent).getByRole("link", { name: "Beverly Hillbillies" })).toBeTruthy();
    expect(
      within(recent).getByRole("link", { name: "Ver la biblioteca" }).getAttribute("href"),
    ).toBe("/series");
  });

  it("says where each of the last downloads came from, an episode downloaded twice once", async () => {
    const done = { status: "done", finishedAt: Date.now() - 60_000 } as const;
    renderApp(<HomeScreen />, {
      handler: handlerFor({
        series: [makeSeries()],
        history: [
          makeJob({ ...done, id: "j3", extractorId: "site-a", player: "player.example" }),
          makeJob({ ...done, id: "j2", extractorId: "site-b", player: "old.example" }),
          makeJob({
            ...done,
            id: "j1",
            episodeId: "e2",
            episodeCode: "S01E02",
            extractorId: "site-a",
          }),
        ],
        extractors: [{ id: "site-a", name: "Site A" }],
      }),
    });
    const last = await card("Últimas descargas");
    expect(await within(last).findByText(/· de Site A \(player\.example\)$/)).toBeTruthy();
    expect(await within(last).findByText(/· de Site A$/)).toBeTruthy();
    expect(within(last).getAllByRole("listitem")).toHaveLength(2);
    expect(within(last).queryByText(/old\.example/)).toBeNull();
  });

  it("shows the new episodes nobody looked at, and downloads only those still missing", async () => {
    const user = userEvent.setup();
    const posted: { path: string; body: unknown }[] = [];
    const note = (over: Partial<NotificationDto>): NotificationDto => ({
      id: "n1",
      kind: "new_episodes",
      title: "New episodes",
      body: "",
      seriesId: "s1",
      jobId: null,
      data: { seriesTitle: "Bonanza", count: 2, codes: "S01E03, S01E04" },
      createdAt: Date.now() - 60_000,
      readAt: null,
      ...over,
    });
    renderApp(<HomeScreen />, {
      handler: handlerFor({
        series: [makeSeries({ id: "s1", title: "Bonanza" })],
        notifications: [
          note({}),
          // Read already, or about something else: not news any more.
          note({
            id: "n2",
            readAt: 5,
            data: { seriesTitle: "Bonanza", count: 1, codes: "S01E09" },
          }),
          note({ id: "n3", kind: "job_failed", data: { error: "HTTP 404" } }),
        ],
        episodes: [
          makeEpisode({ id: "e3", season: 1, episode: 3, status: "missing" }),
          makeEpisode({ id: "e4", season: 1, episode: 4, status: "available" }),
          makeEpisode({ id: "e5", season: 1, episode: 5, status: "missing" }),
        ],
        posted,
      }),
    });
    const news = await card("Episodios nuevos");
    expect(within(news).getAllByRole("listitem")).toHaveLength(1);
    expect(within(news).getByText(/^2 episodios nuevos \(S01E03, S01E04\) · /)).toBeTruthy();
    await user.click(
      await within(news).findByRole("button", {
        name: "Descargar los episodios nuevos de Bonanza",
      }),
    );
    await waitFor(() =>
      expect(posted).toEqual([
        { path: "/api/jobs", body: { episodeIds: ["e3"] } },
        { path: "/api/notifications/read", body: { ids: ["n1"] } },
      ]),
    );
  });

  it("has no card of new episodes when no check found any", async () => {
    renderApp(<HomeScreen />, { handler: handlerFor({ series: [makeSeries()] }) });
    await card("Sin descargar");
    expect(screen.queryByRole("heading", { name: /^Episodios nuevos/ })).toBeNull();
  });

  it("puts the same dock as everywhere, home lit and the + straight to adding", async () => {
    renderApp(<HomeScreen />, { handler: handlerFor({}) });
    const dock = screen.getByRole("navigation", { name: "Atajos" });
    expect(within(dock).getByRole("link", { name: "Inicio" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(dock).getByRole("link", { name: "Añadir" }).getAttribute("href")).toBe(
      "/series/new",
    );
    // The notifications live there too, on every screen: no bar on top to look for them in.
    expect(await within(dock).findByRole("button", { name: /^Notificaciones/ })).toBeTruthy();
  });
});
