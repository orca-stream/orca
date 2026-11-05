import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { firstLanguage } from "../src/infrastructure/web/app.ts";
import { addBevhill, BEVHILL_URL, createHarness, type Harness } from "./harness.ts";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ noJellyfin: true });
});
afterEach(() => h.cleanup());

describe("a server without Jellyfin", () => {
  it("looks a show up on TMDB itself, in the browser's language", async () => {
    h.episodeGuide.matches.set("4219", {
      title: "Los nuevos ricos",
      year: 1962,
      imdbId: "tt0055662",
      overview: "Una familia de las montañas.",
      posterUrl: "https://image.tmdb.org/t/p/w500/p.jpg",
    });
    expect(await h.useCases.lookupShow("4219", undefined, "es")).toMatchObject({
      tmdbId: "4219",
      title: "Los nuevos ricos",
      year: 1962,
      imdbId: "tt0055662",
    });
    expect(h.episodeGuide.languages).toContain("es");
    await expect(h.useCases.lookupShow("1", undefined, "es")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("asks for the show by hand without a TMDB key either", async () => {
    h.deps.episodeGuide = null;
    await expect(h.useCases.lookupShow("4219")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("has no library shows to offer, and takes none", async () => {
    expect(await h.useCases.listLibraryShows()).toEqual([]);
    expect(await h.useCases.listLibraryEpisodes("jf-1")).toEqual([]);
    const preview = await h.useCases.previewSeries(BEVHILL_URL);
    await expect(
      h.useCases.addSeries({
        previewId: preview.previewId,
        title: "",
        year: null,
        episodeKeys: preview.episodes.map((episode) => episode.key),
        jellyfinId: "jf-1",
        tmdbId: null,
        imdbId: null,
        follow: false,
      }),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  it("writes the library and tells nobody", async () => {
    const { series } = await addBevhill(h, { downloadNow: true });
    await h.queue.settle();
    const episodes = await h.useCases.listEpisodes(series.id);
    expect(episodes.map((episode) => episode.status)).toEqual(Array(6).fill("available"));
    const queued = (await h.jobs.list({ limit: 50, status: ["queued"] })).items;
    expect(queued.map((job) => job.kind)).not.toContain("refresh_library");
    expect(h.mediaServer.updated).toEqual([]);
  });
});

describe("firstLanguage", () => {
  it("takes the browser's first language as TMDB names it", () => {
    expect(firstLanguage("es-419,es;q=0.9,en;q=0.8")).toBe("es");
    expect(firstLanguage("es-HN,es;q=0.9")).toBe("es-HN");
    expect(firstLanguage("en-us")).toBe("en-US");
    expect(firstLanguage("es")).toBe("es");
    expect(firstLanguage("*")).toBeUndefined();
    expect(firstLanguage(undefined)).toBeUndefined();
  });
});
