import { describe, expect, it } from "vite-plus/test";
import { makeEpisode } from "@/test/fixtures";
import { offersSeason, sortBySpan, sourceSpans } from "./source-spans";

describe("sourceSpans", () => {
  it("gives each season of a source its first and last episode, in season order", () => {
    const episodes = [
      makeEpisode({ sourceId: "b", season: 2, episode: 3 }),
      makeEpisode({ sourceId: "b", season: 1, episode: 25 }),
      makeEpisode({ sourceId: "a", season: 1, episode: 1 }),
      makeEpisode({ sourceId: "b", season: 1, episode: 37 }),
      makeEpisode({ sourceId: "b", season: 1, episode: 30 }),
    ];
    expect(sourceSpans(episodes, "b")).toEqual([
      { season: 1, from: 25, to: 37, gaps: [26, 27, 28, 29, 31, 32, 33, 34, 35, 36] },
      { season: 2, from: 3, to: 3, gaps: [] },
    ]);
    expect(sourceSpans(episodes, "a")).toEqual([{ season: 1, from: 1, to: 1, gaps: [] }]);
  });

  it("names the numbers a season skips, as TMDB does when it merges a double episode", () => {
    const episodes = [21, 22, 24, 25].map((episode) =>
      makeEpisode({ sourceId: "a", season: 3, episode }),
    );
    expect(sourceSpans(episodes, "a")).toEqual([{ season: 3, from: 21, to: 25, gaps: [23] }]);
  });

  it("is empty for a source with no episodes of its own", () => {
    expect(sourceSpans([makeEpisode({ sourceId: null })], "a")).toEqual([]);
  });
});

describe("sortBySpan", () => {
  it("puts the sources in season and episode order, not the order they were added in", () => {
    const sources = [
      { id: "s2", season: 2, listedSeasons: null },
      { id: "s1-late", season: 1 },
      { id: "empty", season: 3 },
      { id: "s1", season: 1 },
    ];
    const episodes = [
      makeEpisode({ sourceId: "s2", season: 2, episode: 1 }),
      makeEpisode({ sourceId: "s1-late", season: 1, episode: 171 }),
      makeEpisode({ sourceId: "s1", season: 1, episode: 170 }),
      makeEpisode({ sourceId: "s1", season: 1, episode: 1 }),
    ];
    expect(sortBySpan(sources, episodes).map((source) => source.id)).toEqual([
      "s1",
      "s1-late",
      "s2",
      "empty",
    ]);
  });
});

describe("offersSeason", () => {
  // As the series in the report: one source of season 1 by the site's numbers, one that brought
  // season 2, and one set to season 2 that has brought nothing yet.
  const episodes = [
    makeEpisode({ id: "a", sourceId: "s1", season: 1, episode: 1 }),
    makeEpisode({ id: "b", sourceId: "s2", season: 2, episode: 1 }),
  ];

  it("offers a season only from a source that brought it, is set to it, or can't be ruled out", () => {
    expect(offersSeason({ id: "s1", season: null, listedSeasons: null }, episodes, 2)).toBe(false);
    expect(offersSeason({ id: "s1", season: null, listedSeasons: null }, episodes, 1)).toBe(true);
    expect(offersSeason({ id: "s2", season: 2, listedSeasons: null }, episodes, 2)).toBe(true);
    expect(offersSeason({ id: "s3", season: 2, listedSeasons: null }, episodes, 2)).toBe(true);
    expect(offersSeason({ id: "s3", season: 2, listedSeasons: null }, episodes, 1)).toBe(false);
    // Nothing brought and the site's own seasons: it might have any.
    expect(offersSeason({ id: "s4", season: null, listedSeasons: null }, episodes, 5)).toBe(true);
  });

  it("goes by the seasons its address listed once they are known", () => {
    // An alternative of seasons 1 and 2 that no episode uses yet: not offered for season 4.
    const alternative = { id: "alt", season: null, listedSeasons: [1, 2] };
    expect(offersSeason(alternative, episodes, 4)).toBe(false);
    expect(offersSeason(alternative, episodes, 2)).toBe(true);
    // What it brought counts even if the site no longer lists it.
    expect(offersSeason({ id: "s1", season: null, listedSeasons: [] }, episodes, 1)).toBe(true);
  });
});
