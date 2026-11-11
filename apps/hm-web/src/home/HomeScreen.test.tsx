import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { jsonResponse, renderApp, type Handler } from "@/test/render";
import { HomeScreen } from "./HomeScreen";

const ARCHIVE = {
  id: "internet-archive",
  name: "Internet Archive",
  hosts: ["archive.org", "www.archive.org"],
  example: "https://archive.org/details/bevhill?a=1&b=2",
  explicit: false,
  searchable: false,
};
const GENERIC = {
  id: "generic",
  name: "Generic page (browser)",
  hosts: [],
  example: "https://example.com/watch/my-video",
  explicit: true,
  searchable: false,
};

function handlerFor({ series = [] as unknown[], extractors = [] as unknown[] }): Handler {
  return (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/series") return jsonResponse(series);
    if (pathname === "/api/extractors") return jsonResponse(extractors);
    return jsonResponse({ error: "not_found" }, 404);
  };
}

/** The card a heading belongs to. */
async function tile(name: string) {
  return (await screen.findByRole("heading", { name })).closest("li")!;
}

describe("HomeScreen", () => {
  it("puts the series first, then one card per extractor", async () => {
    renderApp(<HomeScreen />, { handler: handlerFor({ extractors: [ARCHIVE, GENERIC] }) });
    await screen.findByRole("heading", { name: "Generic page (browser)" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Series", "Internet Archive", "Generic page (browser)"]);
  });

  it("counts the series and what is downloading, and links to the list and to add one", async () => {
    renderApp(<HomeScreen />, {
      handler: handlerFor({
        series: [
          {
            id: "s1",
            title: "Popeye",
            hasPoster: false,
            downloadingCount: 2,
            running: [{ episodeId: "e1", progress: 0.5 }],
          },
          {
            id: "s2",
            title: "Bonanza",
            hasPoster: false,
            downloadingCount: 1,
            running: [{ episodeId: "e2", progress: 0.3 }],
          },
        ],
      }),
    });
    const series = await tile("Series");
    expect(await within(series).findByText("2 series")).toBeTruthy();
    expect(within(series).getByRole("img", { name: "3 por descargar · 40 %" })).toBeTruthy();
    expect(within(series).getByRole("link", { name: "Series" }).getAttribute("href")).toBe(
      "/series",
    );
    expect(within(series).getByRole("link", { name: "Añadir" }).getAttribute("href")).toBe(
      "/series/new",
    );
  });

  it("says when there are no series yet", async () => {
    renderApp(<HomeScreen />, { handler: handlerFor({}) });
    expect(await within(await tile("Series")).findByText("Aún no hay nada")).toBeTruthy();
  });

  it("shows an extractor's sites and sends it to the add-series screen", async () => {
    renderApp(<HomeScreen />, { handler: handlerFor({ extractors: [ARCHIVE] }) });
    const card = await tile("Internet Archive");
    expect(within(card).getByText("archive.org")).toBeTruthy();
    // The rest of the sites are counted, and named on hover.
    expect(within(card).queryByText("www.archive.org")).toBeNull();
    const badge = within(card).getByText("+1").parentElement!;
    expect(badge.textContent).toBe("archive.org+1");
    expect(badge.getAttribute("title")).toBe("archive.org\nwww.archive.org");
    expect(within(card).getByRole("link", { name: "Probar" }).getAttribute("href")).toBe(
      "/series/new?extractor=internet-archive",
    );
  });

  it("sends an explicit extractor to the add-series screen too", async () => {
    renderApp(<HomeScreen />, { handler: handlerFor({ extractors: [GENERIC] }) });
    const card = await tile("Generic page (browser)");
    expect(within(card).getByText("Solo si lo eliges")).toBeTruthy();
    expect(within(card).getByRole("link", { name: "Probar" }).getAttribute("href")).toBe(
      "/series/new?extractor=generic",
    );
  });

  it("says when there are no extractors", async () => {
    renderApp(<HomeScreen />, { handler: handlerFor({}) });
    expect(await screen.findByText("No hay extractores.")).toBeTruthy();
  });
});
