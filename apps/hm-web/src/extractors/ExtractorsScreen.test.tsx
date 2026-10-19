import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { jsonResponse, renderApp } from "../test/render";
import { ExtractorsScreen } from "./ExtractorsScreen";

describe("ExtractorsScreen", () => {
  it("lists the extractors and links each example to the add-series screen", async () => {
    renderApp(<ExtractorsScreen />, {
      handler: () =>
        jsonResponse([
          {
            id: "internet-archive",
            name: "Internet Archive",
            hosts: ["archive.org", "www.archive.org"],
            example: "https://archive.org/details/bevhill?a=1&b=2",
            explicit: false,
          },
          {
            id: "generic",
            name: "Generic page (browser)",
            hosts: [],
            example: "https://example.com/watch/my-video",
            explicit: true,
          },
        ]),
    });
    const row = (await screen.findByText("Internet Archive")).closest("tr")!;
    expect(within(row).getByText("archive.org, www.archive.org")).toBeTruthy();
    const link = within(row).getByRole("link", { name: "Probar" });
    expect(link.getAttribute("href")).toBe(
      `/series/new?url=${encodeURIComponent("https://archive.org/details/bevhill?a=1&b=2")}`,
    );
  });

  it("sends an explicit extractor's example to the add screen with that extractor chosen", async () => {
    renderApp(<ExtractorsScreen />, {
      handler: () =>
        jsonResponse([
          {
            id: "generic",
            name: "Generic page (browser)",
            hosts: [],
            example: "https://example.com/watch/my-video",
            explicit: true,
          },
        ]),
    });
    const row = (await screen.findByText("Generic page (browser)")).closest("tr")!;
    expect(within(row).getByText("Solo si lo eliges")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "Probar" }).getAttribute("href")).toBe(
      `/series/new?url=${encodeURIComponent("https://example.com/watch/my-video")}&extractor=generic`,
    );
  });

  it("says when there are none", async () => {
    renderApp(<ExtractorsScreen />, { handler: () => jsonResponse([]) });
    expect(await screen.findByText("No hay extractores.")).toBeTruthy();
  });
});
