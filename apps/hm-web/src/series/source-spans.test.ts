import { describe, expect, it } from "vite-plus/test";
import { makeEpisode } from "@/test/fixtures";
import { sortBySpan, sourceSpans } from "./source-spans";

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
      { season: 1, from: 25, to: 37 },
      { season: 2, from: 3, to: 3 },
    ]);
    expect(sourceSpans(episodes, "a")).toEqual([{ season: 1, from: 1, to: 1 }]);
  });

  it("is empty for a source with no episodes of its own", () => {
    expect(sourceSpans([makeEpisode({ sourceId: null })], "a")).toEqual([]);
  });
});

describe("sortBySpan", () => {
  it("puts the sources in season and episode order, not the order they were added in", () => {
    const sources = [
      { id: "s2", season: 2 },
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
