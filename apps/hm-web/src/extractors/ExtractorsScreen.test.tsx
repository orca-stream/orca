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

  it("says when there are none", async () => {
    renderApp(<ExtractorsScreen />, { handler: () => jsonResponse([]) });
    expect(await screen.findByText("No hay extractores.")).toBeTruthy();
  });
});
