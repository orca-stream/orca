import { describe, expect, it } from "vite-plus/test";
import { numberEpisodes } from "../src/numbering.ts";

const entry = (key: string, ...texts: string[]) => ({ key, texts });

describe("numberEpisodes", () => {
  it("reads season and episode from the first text that has a code", () => {
    const result = numberEpisodes([entry("a", "no code here", "s02e05 x"), entry("b", "S1E3")]);
    expect(result.numbers.map((n) => [n.key, n.season, n.episode, n.inferred])).toEqual([
      ["b", 1, 3, false],
      ["a", 2, 5, false],
    ]);
  });

  it("prefers a text that carries the season over one that doesn't", () => {
    const result = numberEpisodes([entry("a", "S  E13 THE NAVIGATOR", "S1E13THENAVIGATOR")]);
    expect(result.numbers[0]).toMatchObject({ season: 1, episode: 13, inferred: false });
  });

  it("gives a season-less episode the season of the previous numbered one", () => {
    const result = numberEpisodes([entry("a", "S2E1"), entry("b", "S  E13"), entry("c", "S3E2")]);
    expect(result.numbers[1]).toMatchObject({ season: 2, episode: 13, inferred: true });
    expect(result.warnings.map((w) => w.code)).toContain("season-inferred");
  });

  it("takes the next season when nothing comes before, and season 1 when nothing is known", () => {
    const next = numberEpisodes([entry("a", "S  E1"), entry("b", "S4E2")]);
    expect(next.numbers[0]).toMatchObject({ season: 4, inferred: true });
    const none = numberEpisodes([entry("a", "S  E1")]);
    expect(none.numbers[0]).toMatchObject({ season: 1, inferred: true });
  });

  it("numbers by natural file order, in season 1, when no name has a code", () => {
    const result = numberEpisodes([
      entry("ep10.mp4", "ep10"),
      entry("ep2.mp4", "ep2"),
      entry("ep1.mp4", "ep1"),
    ]);
    expect(result.numbers.map((n) => [n.key, n.season, n.episode, n.inferred])).toEqual([
      ["ep1.mp4", 1, 1, true],
      ["ep2.mp4", 1, 2, true],
      ["ep10.mp4", 1, 3, true],
    ]);
    expect(result.warnings.map((w) => w.code)).toContain("numbering-inferred");
  });

  it("puts a name without a code after the numbered ones", () => {
    const result = numberEpisodes([entry("x", "S1E1"), entry("y", "bonus")]);
    expect(result.numbers.find((n) => n.key === "y")).toMatchObject({
      season: 1,
      episode: 2,
      inferred: true,
    });
  });

  it("keeps the first of two episodes with the same number and reports the other", () => {
    const result = numberEpisodes([entry("a", "s01e02 first"), entry("b", "s01e02 second")]);
    expect(result.numbers.map((n) => n.key)).toEqual(["a"]);
    const duplicate = result.warnings.find((w) => w.code === "duplicate");
    expect(duplicate?.sourceRefs).toEqual(["b"]);
  });

  it("reports the gaps of each season", () => {
    const result = numberEpisodes([
      entry("a", "s01e01"),
      entry("b", "s01e02"),
      entry("c", "s01e05"),
      entry("d", "s01e07"),
      entry("e", "s02e01"),
    ]);
    const gaps = result.warnings.filter((w) => w.code === "gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.message).toBe("Season 1 is missing episodes 3-4, 6");
  });
});
