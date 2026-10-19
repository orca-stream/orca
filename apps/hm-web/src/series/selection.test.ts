import { describe, expect, it } from "vite-plus/test";
import { makeEpisode } from "../test/fixtures";
import {
  groupBySeason,
  isSelectable,
  missingIds,
  pruneSelection,
  seasonState,
  selectAllSelectable,
  setSeason,
  toggleSelected,
} from "./selection";

const EPISODES = [
  makeEpisode({ id: "a2", season: 1, episode: 2, status: "available" }),
  makeEpisode({ id: "a1", season: 1, episode: 1, status: "missing" }),
  makeEpisode({ id: "b1", season: 2, episode: 1, status: "failed" }),
  makeEpisode({ id: "b2", season: 2, episode: 2, status: "downloading", progress: 0.3 }),
  makeEpisode({ id: "b3", season: 2, episode: 3, status: "queued" }),
  makeEpisode({ id: "s1", season: 0, episode: 1, status: "missing" }),
];

describe("groupBySeason", () => {
  it("orders seasons ascending, specials (0) last, and episodes by number", () => {
    const groups = groupBySeason(EPISODES);
    expect(groups.map((g) => g.season)).toEqual([1, 2, 0]);
    expect(groups[0]?.episodes.map((e) => e.id)).toEqual(["a1", "a2"]);
  });
});

describe("isSelectable", () => {
  it("excludes only what is downloading right now", () => {
    expect(isSelectable(makeEpisode({ status: "downloading" }))).toBe(false);
    for (const status of ["missing", "failed", "queued", "available"] as const) {
      expect(isSelectable(makeEpisode({ status }))).toBe(true);
    }
  });
});

describe("missingIds", () => {
  it("is what is missing plus what failed, nothing already queued, downloading or available", () => {
    expect(missingIds(EPISODES).toSorted()).toEqual(["a1", "b1", "s1"]);
  });
});

describe("toggleSelected", () => {
  it("adds and removes, without mutating", () => {
    const empty = new Set<string>();
    const one = toggleSelected(empty, EPISODES, "a1");
    expect([...one]).toEqual(["a1"]);
    expect(empty.size).toBe(0);
    expect(toggleSelected(one, EPISODES, "a1").size).toBe(0);
  });

  it("refuses an episode that is downloading", () => {
    expect(toggleSelected(new Set(), EPISODES, "b2").size).toBe(0);
  });
});

describe("setSeason / seasonState", () => {
  it("selects every selectable episode of one season, and clears it", () => {
    const on = setSeason(new Set(), EPISODES, 2, true);
    expect([...on].toSorted()).toEqual(["b1", "b3"]);
    expect(seasonState(on, EPISODES, 2)).toBe("all");
    expect(seasonState(on, EPISODES, 1)).toBe("none");
    expect(setSeason(on, EPISODES, 2, false).size).toBe(0);
  });

  it("reads as partial when only some are picked", () => {
    expect(seasonState(new Set(["b1"]), EPISODES, 2)).toBe("some");
  });

  it("keeps other seasons' picks when it changes one", () => {
    const start = new Set(["a1"]);
    expect([...setSeason(start, EPISODES, 2, true)].toSorted()).toEqual(["a1", "b1", "b3"]);
  });
});

describe("selectAllSelectable", () => {
  it("picks everything but what is downloading", () => {
    expect(selectAllSelectable(EPISODES).size).toBe(5);
    expect(selectAllSelectable(EPISODES).has("b2")).toBe(false);
  });
});

describe("pruneSelection", () => {
  it("forgets episodes that are gone or started downloading", () => {
    const pruned = pruneSelection(new Set(["a1", "b2", "ghost"]), EPISODES);
    expect([...pruned]).toEqual(["a1"]);
  });

  it("returns the same set when nothing changes", () => {
    const set = new Set(["a1"]);
    expect(pruneSelection(set, EPISODES)).toBe(set);
  });
});
