import type { GuideEpisodeDto } from "@orca/hm-contract";
import { describe, expect, it } from "vite-plus/test";
import { absentSeasons, agrees, localToday, matchTmdb, numberRanges } from "./tmdb-match";

const tmdb = (number: number, airDate: string | null = "2011-07-11"): GuideEpisodeDto => ({
  number,
  name: `Episode ${number}`,
  airDate,
  overview: null,
  runtimeMin: null,
  stillUrl: null,
});
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);
const landed = (season: number, numbers: number[]) =>
  numbers.map((episode) => ({ season, episode }));

describe("matchTmdb", () => {
  it("only compares what lands among the specials: no site is expected to bring them all", () => {
    const [match] = matchTmdb(
      landed(0, [1]),
      new Map([[0, range(1, 30).map((n) => tmdb(n))]]),
      new Set(["S00E02"]),
      "2026-10-31",
    );
    expect(match).toMatchObject({ extra: [], missing: [], upcoming: [], covered: [] });
    expect(agrees(match!)).toBe(true);
  });

  it("agrees when the address lands on exactly TMDB's episodes", () => {
    const [match] = matchTmdb(
      landed(3, range(1, 26)),
      new Map([[3, range(1, 26).map((n) => tmdb(n))]]),
      new Set(),
      "2026-10-31",
    );
    expect(match).toEqual({
      season: 3,
      site: 26,
      tmdb: 26,
      extra: [],
      missing: [],
      upcoming: [],
      covered: [],
    });
    expect(agrees(match!)).toBe(true);
  });

  it("names what the address has beyond TMDB and what it lacks of it", () => {
    const [match] = matchTmdb(
      landed(1, [1, 2, 4, 5, 6]),
      new Map([[1, range(1, 4).map((n) => tmdb(n))]]),
      new Set(),
      "2026-10-31",
    );
    expect(match).toMatchObject({ site: 5, tmdb: 4, extra: [5, 6], missing: [3] });
    expect(agrees(match!)).toBe(false);
  });

  it("doesn't count as missing what the series has already", () => {
    const [match] = matchTmdb(
      landed(1, range(14, 26)),
      new Map([[1, range(1, 26).map((n) => tmdb(n))]]),
      new Set(range(1, 13).map((n) => `S01E${String(n).padStart(2, "0")}`)),
      "2026-10-31",
    );
    expect(match?.missing).toEqual([]);
    // Said apart, so "14 on the site, 26 on TMDB" still reads as agreeing.
    expect(match?.covered).toEqual(range(1, 13));
  });

  it("keeps what hasn't aired apart from what is missing", () => {
    const [match] = matchTmdb(
      landed(2, [1, 2]),
      new Map([[2, [tmdb(1), tmdb(2), tmdb(3, "2026-11-07"), tmdb(4, null)]]]),
      new Set(),
      "2026-10-31",
    );
    expect(match).toMatchObject({ missing: [], upcoming: [3, 4] });
    expect(agrees(match!)).toBe(true);
  });

  it("makes everything extra in a season TMDB doesn't have, and skips one not known yet", () => {
    const matches = matchTmdb(
      [...landed(11, [1, 2]), ...landed(12, [1])],
      new Map([[11, []]]),
      new Set(),
      "2026-10-31",
    );
    expect(matches).toEqual([
      { season: 11, site: 2, tmdb: 0, extra: [1, 2], missing: [], upcoming: [], covered: [] },
    ]);
  });
});

describe("localToday", () => {
  it("writes the local date as YYYY-MM-DD", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("numberRanges", () => {
  it("joins runs of numbers into ranges", () => {
    expect(numberRanges([9, 5, 6, 7, 12, 13])).toBe("E05–E07, E09, E12–E13");
    expect(numberRanges([])).toBe("");
  });
});

describe("absentSeasons", () => {
  const season = (number: number, year: number | null = 2005, episodeCount = 10) => ({
    number,
    name: `Season ${number}`,
    episodeCount,
    year,
  });

  it("gives the aired seasons the series has nothing of, specials and empty ones aside", () => {
    const guide = [season(0), season(1), season(2), season(3), season(4, null), season(5, 2026, 0)];
    expect(absentSeasons(guide, new Set([1])).map((s) => s.number)).toEqual([2, 3]);
  });
});
