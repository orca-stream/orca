import type { GuideEpisodeDto } from "@orca/hm-contract";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { makePreview } from "@/test/fixtures";
import { renderApp } from "@/test/render";
import { EpisodeGrid } from "./EpisodeGrid";
import { initialForm } from "./preview-form";

const tmdb = (number: number, airDate: string | null = "1962-09-26"): GuideEpisodeDto => ({
  number,
  name: `TMDB ${number}`,
  airDate,
  overview: null,
  runtimeMin: null,
  stillUrl: null,
});

function renderGrid(season1: GuideEpisodeDto[]) {
  const preview = makePreview();
  return renderApp(
    <EpisodeGrid
      preview={preview}
      form={initialForm(preview)}
      onChange={() => undefined}
      guide={new Map(season1.map((episode) => [`1:${episode.number}`, episode]))}
      guideSeasons={new Map([[1, season1]])}
      taken={new Set()}
      kept={new Set()}
    />,
  );
}

describe("EpisodeGrid against TMDB", () => {
  it("says it matches TMDB when the address has exactly its episodes", () => {
    // The fixture's address has E01, E02 and E04.
    renderGrid([tmdb(1), tmdb(2), tmdb(4)]);
    expect(screen.getByText("Igual que TMDB")).toBeTruthy();
    expect(screen.queryByText("No está en el sitio")).toBeNull();
  });

  it("puts what TMDB lists and the site lacks in its place, and marks what TMDB doesn't list", () => {
    renderGrid([tmdb(1), tmdb(2), tmdb(3), tmdb(5, "2999-01-01")]);
    expect(screen.getByText("Distinto de TMDB")).toBeTruthy();
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["TMDB 1", "TMDB 2", "TMDB 3", "Jed Buys Stock", "TMDB 5"]);
    expect(screen.getByText("No está en el sitio")).toBeTruthy();
    expect(screen.getByText("Sin emitir")).toBeTruthy();
    expect(screen.getByText("No está en TMDB")).toBeTruthy();
  });

  it("shows no comparison while TMDB's seasons aren't known", () => {
    const preview = makePreview();
    renderApp(
      <EpisodeGrid
        preview={preview}
        form={initialForm(preview)}
        onChange={() => undefined}
        guide={new Map()}
        guideSeasons={new Map()}
        taken={new Set()}
        kept={new Set()}
      />,
    );
    expect(screen.queryByText("Igual que TMDB")).toBeNull();
    expect(screen.queryByText("Distinto de TMDB")).toBeNull();
  });
});
