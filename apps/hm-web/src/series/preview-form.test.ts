import { CreateSeriesBody } from "@orca/hm-contract";
import { describe, expect, it } from "vite-plus/test";
import { makePreview } from "../test/fixtures";
import {
  canConfirm,
  episodeCode,
  initialForm,
  matchExtractor,
  parseYear,
  setAllIncluded,
  toCreateBody,
  toggleEpisode,
  warningsByEpisode,
} from "./preview-form";

describe("initialForm", () => {
  it("starts from the preview, with every episode included", () => {
    const form = initialForm(makePreview());
    expect(form).toMatchObject({
      title: "The Beverly Hillbillies",
      year: "1962",
      included: ["e1", "e2", "e4"],
      follow: false,
      downloadNow: true,
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
    expect(canConfirm({ ...initialForm(unknown), year: "1982" })).toBe(true);
    expect(canConfirm({ ...initialForm(unknown), year: "" })).toBe(true);
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
      episodeKeys: ["e1", "e2", "e4"],
      follow: true,
      downloadNow: true,
    });
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
    },
    {
      id: "other",
      name: "Other",
      hosts: ["other.test", "www.other.test"],
      example: "",
      explicit: false,
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
