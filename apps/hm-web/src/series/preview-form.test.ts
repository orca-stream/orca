import { CreateSeriesBody } from "@orca/hm-contract";
import { describe, expect, it } from "vite-plus/test";
import { makePreview } from "@/test/fixtures";
import {
  canConfirm,
  clashingCodes,
  episodeCode,
  episodeRanges,
  initialForm,
  invalidFields,
  numberer,
  parseFirstEpisode,
  parseImdbId,
  parseSeason,
  parseTmdbId,
  matchExtractor,
  nextEpisode,
  nextOpenSeason,
  nextSpecial,
  parseYear,
  setAdjustment,
  setAllIncluded,
  shortRanges,
  jellyfinTarget,
  toCreateBody,
  toggleEpisode,
  warningsByEpisode,
} from "./preview-form";

describe("initialForm", () => {
  it("starts from the preview with the title empty, for TMDB to fill in, and every episode included", () => {
    const form = initialForm(makePreview());
    expect(form).toMatchObject({
      title: "",
      year: "1962",
      included: ["e1", "e2", "e4"],
      follow: false,
      downloadNow: false,
    });
  });

  it("leaves the year empty when the source gave none", () => {
    const base = makePreview();
    const form = initialForm(makePreview({ series: { ...base.series, year: null } }));
    expect(form.year).toBe("");
  });

  it("starts with only the episode the address pointed at, when it named one", () => {
    expect(initialForm(makePreview({ selectedKey: "e2" })).included).toEqual(["e2"]);
  });
});

describe("parseYear", () => {
  it("reads four digits, nothing as no year, and refuses the rest", () => {
    expect(parseYear("1962")).toBe(1962);
    expect(parseYear(" 1962 ")).toBe(1962);
    expect(parseYear("")).toBeNull();
    expect(parseYear("62")).toBe("invalid");
    expect(parseYear("19x2")).toBe("invalid");
    expect(parseYear("1700")).toBe("invalid");
  });
});

describe("canConfirm", () => {
  it("lets an unknown license or a recent year through", () => {
    const unknown = makePreview({ license: { kind: "unknown", url: null } });
    const titled = { ...initialForm(unknown), title: "The Beverly Hillbillies" };
    expect(canConfirm({ ...titled, year: "1982" })).toBe(true);
    expect(canConfirm({ ...titled, year: "" })).toBe(true);
  });

  it("is blocked by an empty title, no episodes, or a year that cannot be read", () => {
    const preview = makePreview();
    const form = initialForm(preview);
    expect(canConfirm({ ...form, title: "   " })).toBe(false);
    expect(canConfirm({ ...form, included: [] })).toBe(false);
    expect(canConfirm({ ...form, year: "19" })).toBe(false);
  });
});

describe("toCreateBody", () => {
  it("builds a body the contract accepts", () => {
    const preview = makePreview();
    const body = toCreateBody(preview, {
      ...initialForm(preview),
      title: " Beverly ",
      follow: true,
    });
    expect(CreateSeriesBody.parse(body)).toEqual({
      previewId: "p1",
      title: "Beverly",
      year: 1962,
      tmdbId: null,
      imdbId: null,
      season: null,
      firstEpisode: null,
      adjustments: [],
      episodeKeys: ["e1", "e2", "e4"],
      follow: true,
      downloadNow: false,
    });
  });

  it("sends the ids and the numbering of a new series, trimmed", () => {
    const preview = makePreview();
    const body = toCreateBody(preview, {
      ...initialForm(preview),
      title: "The Beverly Hillbillies",
      tmdbId: " 12345 ",
      imdbId: "tt0123456",
      season: "2",
      firstEpisode: "13",
    });
    expect(CreateSeriesBody.parse(body)).toMatchObject({
      tmdbId: "12345",
      imdbId: "tt0123456",
      season: 2,
      firstEpisode: 13,
    });
  });

  it("adds to an existing series without a title, a year, ids or a follow setting of its own", () => {
    const preview = makePreview();
    const body = toCreateBody(preview, {
      ...initialForm(preview),
      addTo: "s9",
      tmdbId: "999",
      season: "1",
      firstEpisode: "13",
    });
    const parsed = CreateSeriesBody.parse(body);
    expect(parsed).toMatchObject({ seriesId: "s9", season: 1, firstEpisode: 13, tmdbId: null });
    expect(parsed).not.toHaveProperty("title");
    expect(parsed).not.toHaveProperty("year");
  });

  it("adds to a show in Jellyfin by its id, with the show's own title and ids", () => {
    const preview = makePreview();
    const body = toCreateBody(preview, {
      ...initialForm(preview),
      addTo: jellyfinTarget("jf1"),
      tmdbId: "999",
      follow: true,
    });
    const parsed = CreateSeriesBody.parse(body);
    expect(parsed).toMatchObject({ jellyfinId: "jf1", tmdbId: null, follow: true });
    expect(parsed).not.toHaveProperty("seriesId");
    expect(parsed).not.toHaveProperty("title");
  });

  it("keeps the episodes in the preview's order", () => {
    const preview = makePreview();
    const form = { ...initialForm(preview), included: ["e4", "e1"] };
    expect(toCreateBody(preview, form).episodeKeys).toEqual(["e1", "e4"]);
  });
});

describe("toggleEpisode / setAllIncluded", () => {
  it("adds and removes one episode", () => {
    const form = initialForm(makePreview());
    expect(toggleEpisode(form, "e2").included).toEqual(["e1", "e4"]);
    expect(toggleEpisode(toggleEpisode(form, "e2"), "e2").included).toContain("e2");
  });

  it("includes or excludes all", () => {
    const preview = makePreview();
    expect(setAllIncluded(preview, initialForm(preview), false).included).toEqual([]);
    expect(setAllIncluded(preview, initialForm(preview), true).included).toEqual([
      "e1",
      "e2",
      "e4",
    ]);
  });
});

describe("warningsByEpisode", () => {
  it("attaches each warning to the rows it names", () => {
    const map = warningsByEpisode(makePreview());
    expect(map.get("e4")?.map((w) => w.kind)).toEqual(["gap"]);
    expect(map.get("e2")?.map((w) => w.kind)).toEqual(["inferred"]);
    expect(map.has("e1")).toBe(false);
  });
});

describe("episodeCode", () => {
  it("pads season and episode", () => {
    expect(episodeCode(1, 2)).toBe("S01E02");
    expect(episodeCode(12, 103)).toBe("S12E103");
  });
});

describe("matchExtractor", () => {
  const extractors = [
    {
      id: "internet-archive",
      name: "Internet Archive",
      hosts: ["archive.org"],
      example: "",
      explicit: false,
      searchable: false,
    },
    {
      id: "other",
      name: "Other",
      hosts: ["other.test", "www.other.test"],
      example: "",
      explicit: false,
      searchable: false,
    },
  ];

  it("matches the host and its subdomains", () => {
    expect(matchExtractor("https://archive.org/details/x", extractors)?.id).toBe(
      "internet-archive",
    );
    expect(matchExtractor("https://www.archive.org/details/x", extractors)?.id).toBe(
      "internet-archive",
    );
    expect(matchExtractor("https://other.test/a", extractors)?.id).toBe("other");
  });

  it("accepts an address typed without the scheme", () => {
    expect(matchExtractor("archive.org/details/x", extractors)?.id).toBe("internet-archive");
  });

  it("does not match a look-alike host, an unknown site or something that is not an address", () => {
    expect(matchExtractor("https://notarchive.org/x", extractors)).toBeNull();
    expect(matchExtractor("https://archive.org.evil.test/x", extractors)).toBeNull();
    expect(matchExtractor("https://example.com", extractors)).toBeNull();
    expect(matchExtractor("not a url", extractors)).toBeNull();
    expect(matchExtractor("", extractors)).toBeNull();
  });
});

describe("episodes numbered by hand", () => {
  const withZero = () => {
    const base = makePreview();
    return makePreview({
      episodes: [{ ...base.episodes[0]!, key: "e0", episode: 0 }, ...base.episodes],
    });
  };
  const codes = (preview: ReturnType<typeof makePreview>, form: ReturnType<typeof initialForm>) =>
    preview.episodes.map((episode) => {
      const mapped = numberer(preview, form)(episode);
      return episodeCode(mapped.season, mapped.episode);
    });

  it("starts a site's episode 0 among the specials, left out, and episode 1 stays 1", () => {
    const preview = withZero();
    const form = initialForm(preview);
    expect(form.adjustments).toEqual([{ season: 1, episode: 0, kind: "special", number: 1 }]);
    expect(form.included).toEqual(["e1", "e2", "e4"]);
    expect(codes(preview, form)).toEqual(["S00E01", "S01E01", "S01E02", "S01E04"]);
    expect(codes(preview, { ...form, season: "4", firstEpisode: "1" })).toEqual([
      "S00E01",
      "S04E01",
      "S04E02",
      "S04E04",
    ]);
    // Counted again, it moves the rest as before.
    expect(
      codes(
        preview,
        setAdjustment({ ...form, firstEpisode: "1" }, { season: 1, episode: 0 }, null),
      ),
    ).toEqual(["S01E01", "S01E02", "S01E03", "S01E05"]);
  });

  it("carries on from an episode renumbered by hand, and sends it to the server", () => {
    const preview = makePreview();
    const form = setAdjustment(
      initialForm(preview),
      { season: 1, episode: 2 },
      {
        kind: "renumber",
        number: 7,
      },
    );
    expect(codes(preview, form)).toEqual(["S01E01", "S01E07", "S01E09"]);
    expect(toCreateBody(preview, { ...form, title: "B" }).adjustments).toEqual([
      { season: 1, episode: 2, kind: "renumber", number: 7 },
    ]);
  });

  it("picks the first special number neither the series nor the form has", () => {
    const form = initialForm(withZero());
    expect(nextSpecial(form, new Set(["S00E02"]))).toBe(3);
  });
});

describe("numbering", () => {
  // The preview lists S01E01, S01E02 and S01E04.
  const preview = makePreview();
  const codes = (form: ReturnType<typeof initialForm>) =>
    preview.episodes.map((episode) => {
      const mapped = numberer(preview, form)(episode);
      return episodeCode(mapped.season, mapped.episode);
    });

  it("keeps the site's numbers when the fields are empty", () => {
    expect(codes(initialForm(preview))).toEqual(["S01E01", "S01E02", "S01E04"]);
  });

  it("moves the lowest episode to the first episode given, and the rest with it, into the season given", () => {
    expect(codes({ ...initialForm(preview), season: "3", firstEpisode: "13" })).toEqual([
      "S03E13",
      "S03E14",
      "S03E16",
    ]);
  });

  it("refuses what is not a whole number", () => {
    const form = { ...initialForm(preview), season: "x", firstEpisode: "-1" };
    expect([...invalidFields(form)].sort()).toEqual(["firstEpisode", "season"]);
    expect(canConfirm(form)).toBe(false);
    expect(parseSeason("")).toBeNull();
    expect(parseFirstEpisode("0")).toBe(0);
  });

  it("checks the ids only for a new series", () => {
    const bad = { ...initialForm(preview), tmdbId: "abc", imdbId: "123" };
    expect([...invalidFields(bad)].sort()).toEqual(["imdbId", "tmdbId"]);
    expect(invalidFields({ ...bad, addTo: "s9" }).size).toBe(0);
    expect(parseTmdbId(" 12345 ")).toBe("12345");
    expect(parseImdbId("")).toBeNull();
  });

  it("finds two chosen episodes that would land on the same number, not ones the series has", () => {
    // What the series has is no clash: it takes its video from this address.
    const form = { ...initialForm(preview), addTo: "s9" };
    expect(clashingCodes(preview, form)).toEqual([]);
    // Episode 4 numbered as 2 lands on episode 2.
    const twice = {
      ...form,
      adjustments: [{ season: 1, episode: 4, kind: "renumber" as const, number: 2 }],
    };
    expect(clashingCodes(preview, twice)).toEqual(["S01E02"]);
    expect(canConfirm(twice, ["S01E02"])).toBe(false);
    // Leaving one out clears it.
    expect(clashingCodes(preview, { ...twice, included: ["e1", "e4"] })).toEqual([]);
  });

  it("finds the episode after the last one a season has, and none for a season it lacks", () => {
    const existing = [
      { season: 1, episode: 24 },
      { season: 1, episode: 3 },
      { season: 2, episode: 5 },
    ];
    expect(nextEpisode(existing, 1)).toBe(25);
    expect(nextEpisode(existing, 2)).toBe(6);
    expect(nextEpisode(existing, 3)).toBeNull();
  });

  it("doesn't continue a season that has all of its episodes", () => {
    const existing = [{ season: 5, episode: 22 }];
    expect(nextEpisode(existing, 5, 22)).toBeNull();
    expect(nextEpisode(existing, 5, 23)).toBe(23);
  });

  it("moves an address whose season the series has whole to the next one it hasn't", () => {
    const seasons = [
      { number: 0, episodeCount: 4 },
      { number: 1, episodeCount: 13 },
      { number: 2, episodeCount: 25 },
      { number: 3, episodeCount: 25 },
    ];
    const s1 = Array.from({ length: 13 }, (_, i) => ({ season: 1, episode: i + 1 }));
    // Season 1 whole, nothing of 2: the address goes to 2.
    expect(nextOpenSeason(s1, seasons, 1)).toBe(2);
    // Season 2 started too: it is continued, not skipped.
    expect(nextOpenSeason([...s1, { season: 2, episode: 7 }], seasons, 1)).toBe(2);
    // 1 and 2 whole: 3.
    expect(nextOpenSeason([...s1, { season: 2, episode: 25 }], seasons, 1)).toBe(3);
  });

  it("leaves the season alone when the series doesn't have it whole, or has every later one", () => {
    const seasons = [
      { number: 1, episodeCount: 13 },
      { number: 2, episodeCount: 25 },
    ];
    expect(nextOpenSeason([], seasons, 1)).toBeNull();
    expect(nextOpenSeason([{ season: 1, episode: 5 }], seasons, 1)).toBeNull();
    expect(
      nextOpenSeason(
        [
          { season: 1, episode: 13 },
          { season: 2, episode: 25 },
        ],
        seasons,
        1,
      ),
    ).toBeNull();
    // A season TMDB doesn't list can't be told complete.
    expect(nextOpenSeason([{ season: 9, episode: 1 }], seasons, 9)).toBeNull();
  });

  it("sums up what a series has, season by season", () => {
    expect(
      episodeRanges([
        { season: 1, episode: 1 },
        { season: 1, episode: 12 },
        { season: 2, episode: 5 },
      ]),
    ).toBe("S01E01–S01E12, S02E05");
    expect(episodeRanges([])).toBe("");
  });

  it("says it shorter, without repeating the season inside a range", () => {
    expect(
      shortRanges([
        { season: 1, episode: 1 },
        { season: 1, episode: 12 },
        { season: 2, episode: 5 },
      ]),
    ).toBe("S01E01–E12, S02E05");
  });
});
