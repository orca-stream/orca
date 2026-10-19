import { CreateSeriesBody } from "@orca/hm-contract";
import { describe, expect, it } from "vite-plus/test";
import { makePreview } from "../test/fixtures";
import {
  ackReason,
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
  it("starts from the preview, with every episode included and nothing confirmed", () => {
    const form = initialForm(makePreview());
    expect(form).toMatchObject({
      title: "The Beverly Hillbillies",
      year: "1962",
      included: ["e1", "e2", "e4"],
      follow: false,
      downloadNow: true,
      licenseAck: false,
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

describe("ackReason / the license confirmation", () => {
  const publicDomain = makePreview();

  it("is not asked for an old show with a known license", () => {
    expect(ackReason(publicDomain, initialForm(publicDomain))).toBeNull();
  });

  it("is asked when the year goes from 1962 to 1982", () => {
    const form = { ...initialForm(publicDomain), year: "1982" };
    expect(ackReason(publicDomain, form)).toBe("year");
    expect(ackReason(publicDomain, { ...form, year: "1962" })).toBeNull();
  });

  it("is asked when there is no year, or it cannot be read", () => {
    const form = initialForm(publicDomain);
    expect(ackReason(publicDomain, { ...form, year: "" })).toBe("year");
    expect(ackReason(publicDomain, { ...form, year: "abc" })).toBe("year");
  });

  it("is always asked for an unknown license, even for an old year", () => {
    const unknown = makePreview({ license: { kind: "unknown", url: null, requiresAck: true } });
    expect(ackReason(unknown, initialForm(unknown))).toBe("license");
  });
});

describe("canConfirm", () => {
  const unknown = makePreview({ license: { kind: "unknown", url: null, requiresAck: true } });

  it("is blocked by an unknown license until it is acknowledged", () => {
    const form = initialForm(unknown);
    expect(canConfirm(unknown, form)).toBe(false);
    expect(canConfirm(unknown, { ...form, licenseAck: true })).toBe(true);
  });

  it("follows the year when the license is known", () => {
    const preview = makePreview();
    const form = initialForm(preview);
    expect(canConfirm(preview, form)).toBe(true);
    expect(canConfirm(preview, { ...form, year: "1982" })).toBe(false);
    expect(canConfirm(preview, { ...form, year: "1982", licenseAck: true })).toBe(true);
  });

  it("is blocked by an empty title, no episodes, or a year that cannot be read", () => {
    const preview = makePreview();
    const form = initialForm(preview);
    expect(canConfirm(preview, { ...form, title: "   " })).toBe(false);
    expect(canConfirm(preview, { ...form, included: [] })).toBe(false);
    expect(canConfirm(preview, { ...form, year: "19", licenseAck: true })).toBe(false);
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
      licenseAck: false,
    });
  });

  it("only sends the ack when the license needs it", () => {
    const preview = makePreview();
    const body = toCreateBody(preview, { ...initialForm(preview), licenseAck: true });
    expect(body.licenseAck).toBe(false);
    const recent = toCreateBody(preview, {
      ...initialForm(preview),
      year: "1982",
      licenseAck: true,
    });
    expect(recent.licenseAck).toBe(true);
    expect(recent.year).toBe(1982);
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
    { id: "internet-archive", name: "Internet Archive", hosts: ["archive.org"], example: "" },
    { id: "other", name: "Other", hosts: ["other.test", "www.other.test"], example: "" },
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
