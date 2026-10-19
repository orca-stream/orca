import { describe, expect, it } from "vite-plus/test";
import { ExtractorError } from "@orca/extractor-core";
import { createInternetArchiveExtractor } from "../src/extractor.ts";
import { fakeHttp, fixture, metadataUrl, oneStepBeyond, scrapeUrl } from "./fixtures.ts";

const BEVHILL = "bevhill-s01e01-36";
const bevhillUrl = `https://archive.org/details/${BEVHILL}`;

function extractorFor(answers: Record<string, unknown>) {
  const { http, requests } = fakeHttp(answers);
  return { extractor: createInternetArchiveExtractor({ http }), requests };
}

const codes = (warnings: { code: string }[]) => warnings.map((w) => w.code);

describe("extractor identity", () => {
  it("describes itself for GET /extractors and claims archive.org URLs", () => {
    const { extractor } = extractorFor({});
    expect(extractor).toMatchObject({
      id: "internet-archive",
      name: "Internet Archive",
      hosts: ["archive.org"],
    });
    expect(extractor.example).toMatch(/^https:\/\/archive\.org\/details\//);
    expect(extractor.canHandle("https://www.archive.org/details/x")).toBe(true);
    expect(extractor.canHandle("https://youtube.com/watch?v=x")).toBe(false);
  });
});

describe("shape A: one item with many files (bevhill)", () => {
  const run = async () => {
    const { extractor, requests } = extractorFor({
      [metadataUrl(BEVHILL)]: fixture(`${BEVHILL}.metadata`),
    });
    return { result: await extractor.extract(bevhillUrl), requests };
  };

  it("makes one request and one episode per video, ogv derivatives left out", async () => {
    const { result, requests } = await run();
    expect(requests).toEqual([metadataUrl(BEVHILL)]);
    expect(result.episodes.map((e) => [e.season, e.episode, e.title, e.inferred])).toEqual([
      [1, 1, "The Clampetts Strike Oil", false],
      [1, 2, "Getting Settled", false],
      [1, 18, "Jed Saves The Drysdales Marriage", false],
      [1, 20, "Jed Throws A WingDing", false],
      [1, 21, "Jed Plays Solomon", false],
      [2, 1, "Jed Gets The Misery", false],
    ]);
    expect(result.seasons).toEqual([
      { number: 1, episodeCount: 5 },
      { number: 2, episodeCount: 1 },
    ]);
  });

  it("points every episode at the direct download of the original mp4", async () => {
    const { result } = await run();
    const [first] = result.episodes;
    expect(first?.sourceRef).toBe(`${BEVHILL}/s01e01-The-Clampetts-Strike-Oil.mp4`);
    expect(first?.media).toMatchObject({
      kind: "direct",
      url: `https://archive.org/download/${BEVHILL}/s01e01-The-Clampetts-Strike-Oil.mp4`,
      fileName: "s01e01-The-Clampetts-Strike-Oil.mp4",
      format: "MPEG4",
    });
    expect(first?.media.sizeBytes).toBeGreaterThan(0);
    expect(first?.media.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(first?.media.durationSec).toBeGreaterThan(0);
  });

  it("describes the series, leaving the junk title for the user to fix", async () => {
    const { result } = await run();
    expect(result.series).toMatchObject({
      externalId: BEVHILL,
      sourceUrl: bevhillUrl,
      title: "beverly hillbillies",
      plot: "public domain episodes of the beverly hillbillies",
    });
    expect(result.series.year).toBeUndefined();
    expect(result.series.remoteMarker).toMatch(/^\d+$/);
  });

  it("reports the gap and the missing year, and asks to confirm a license no year backs up", async () => {
    const { result } = await run();
    expect(result.license).toEqual({
      kind: "public-domain",
      url: "http://creativecommons.org/publicdomain/mark/1.0/",
      // No year to vouch for it: confirmation required.
      requiresAck: true,
    });
    const gap = result.warnings.find((w) => w.code === "gap" && w.message.startsWith("Season 1"));
    expect(gap?.message).toContain("19");
    expect(codes(result.warnings)).toContain("year-missing");
  });

  it("preselects the episode named by a file URL", async () => {
    const { extractor } = extractorFor({ [metadataUrl(BEVHILL)]: fixture(`${BEVHILL}.metadata`) });
    const result = await extractor.extract(
      `https://archive.org/details/${BEVHILL}/s01e02-Getting-Settled.mp4?ref=x`,
    );
    expect(result.selectedSourceRef).toBe(`${BEVHILL}/s01e02-Getting-Settled.mp4`);
  });

  it("asks for confirmation when a public domain tag sits on a show from 1982", async () => {
    const item = fixture<{ metadata: Record<string, unknown> }>(`${BEVHILL}.metadata`);
    item.metadata.year = "1982";
    const { extractor } = extractorFor({ [metadataUrl(BEVHILL)]: item });
    const result = await extractor.extract(bevhillUrl);
    expect(result.series.year).toBe(1982);
    expect(result.license.requiresAck).toBe(true);
    expect(codes(result.warnings)).toContain("license-recent");
  });

  it("keeps the first of two videos with the same number", async () => {
    const item = fixture<{ files: Record<string, unknown>[] }>(`${BEVHILL}.metadata`);
    const copy = item.files.find((f) => f.name === "s01e02-Getting-Settled.mp4");
    item.files.push({ ...copy, name: "s01e02-Getting-Settled-v2.mp4" });
    const { extractor } = extractorFor({ [metadataUrl(BEVHILL)]: item });
    const result = await extractor.extract(bevhillUrl);
    expect(result.episodes.filter((e) => e.season === 1 && e.episode === 2)).toHaveLength(1);
    const duplicate = result.warnings.find((w) => w.code === "duplicate");
    const kept = result.episodes.find((e) => e.season === 1 && e.episode === 2);
    const both = [
      `${BEVHILL}/s01e02-Getting-Settled-v2.mp4`,
      `${BEVHILL}/s01e02-Getting-Settled.mp4`,
    ];
    expect(
      [kept?.sourceRef ?? "", ...(duplicate?.sourceRefs ?? [])].sort((a, b) => a.localeCompare(b)),
    ).toEqual(both);
  });
});

describe("format ranking and numbering by file order (The_Beverly_Hillbillies)", () => {
  it("picks the h.264 derivative and numbers the episodes in season 1, flagged as inferred", async () => {
    const { extractor } = extractorFor({
      [metadataUrl("The_Beverly_Hillbillies")]: fixture("The_Beverly_Hillbillies.metadata"),
    });
    const result = await extractor.extract("https://archive.org/details/The_Beverly_Hillbillies");
    expect(result.episodes.map((e) => [e.episode, e.title, e.media.fileName, e.inferred])).toEqual([
      [1, "Getting Settled", "Getting_Settled.mp4", true],
      [2, "Grannys Garden", "GRANNYS_GARDEN.mp4", true],
      [3, "The Clampets Strike Oil", "The_Clampets_Strike_Oil.mp4", true],
    ]);
    expect(result.series.year).toBe(1962);
    expect(result.series.title).toBe("The Beverly Hillbillies TV Show");
    expect(codes(result.warnings)).toContain("numbering-inferred");
    // licenseurl is null on this item: unknown, so the panel asks for confirmation.
    expect(result.license).toEqual({ kind: "unknown", requiresAck: true });
    expect(codes(result.warnings)).toContain("license-unknown");
  });
});

describe("compilation files (fg-1-12)", () => {
  it("flags the video that is several episodes in one instead of guessing", async () => {
    const { extractor } = extractorFor({ [metadataUrl("fg-1-12")]: fixture("fg-1-12.metadata") });
    const result = await extractor.extract("https://archive.org/details/fg-1-12");
    expect(result.episodes).toHaveLength(5);
    const compilation = result.warnings.find((w) => w.code === "compilation");
    expect(compilation?.sourceRefs).toEqual(["fg-1-12/FG 1-12.mp4"]);
    expect(result.episodes[0]?.media.url).toBe(
      "https://archive.org/download/fg-1-12/FG%201-12.mp4",
    );
    expect(result.series.year).toBe(1954);
  });
});

describe("shape B: a collection with one item per episode (One Step Beyond)", () => {
  const run = async () => {
    const { extractor, requests } = extractorFor(oneStepBeyond());
    const result = await extractor.extract("https://archive.org/details/onestepbeyondcomplete");
    return { result, requests };
  };

  it("reads the collection, both scrape pages and each item, in that order", async () => {
    const { requests } = await run();
    expect(requests.slice(0, 3)).toEqual([
      metadataUrl("onestepbeyondcomplete"),
      scrapeUrl("onestepbeyondcomplete"),
      scrapeUrl("onestepbeyondcomplete", "CURSOR-PAGE-2"),
    ]);
    expect(requests).toHaveLength(8);
  });

  it("builds the series from the collection and the episodes from the items", async () => {
    const { result } = await run();
    expect(result.series).toMatchObject({
      externalId: "onestepbeyondcomplete",
      title: "One Step Beyond",
    });
    expect(result.series.plot).toContain("all 96 episodes");
    expect(result.series.remoteMarker).toBe("5");
    expect(result.episodes.map((e) => [e.season, e.episode, e.title])).toEqual([
      [1, 1, "The Bride Possessed"],
      [1, 10, "The Vision"],
      [1, 13, "The Navigator"],
      [1, 16, "The Burning Girl"],
      [2, 13, "Father Image"],
    ]);
  });

  it("strips the HTML out of each item's description and points at the chosen file", async () => {
    const { result } = await run();
    const vision = result.episodes.find((e) => e.episode === 10);
    expect(vision?.plot).toMatch(/^On a battlefield during the first World War/);
    expect(vision?.plot).not.toContain("<");
    expect(vision?.media).toMatchObject({
      url: "https://archive.org/download/S1E10THEVISION/S1E10%20-%20THE%20VISION.mp4",
      format: "MPEG4",
    });
    const navigator = result.episodes.find((e) => e.episode === 13 && e.season === 1);
    expect(navigator?.media.fileName).toBe("S1E13 - THE NAVIGATOR.mp4");
  });

  it("leaves the license unknown (none on the collection or its items) and asks for confirmation", async () => {
    const { result } = await run();
    expect(result.license.kind).toBe("unknown");
    expect(result.license.requiresAck).toBe(true);
  });

  it("gives an episode with no season in any name the season of its neighbour in the list", async () => {
    const answers = oneStepBeyond();
    const page = answers[scrapeUrl("onestepbeyondcomplete")] as { items: { identifier: string }[] };
    const item = page.items.find((i) => i.identifier === "S1E13THENAVIGATOR");
    if (!item) throw new Error("fixture changed");
    item.identifier = "NAVIGATOR";
    const nav = answers[metadataUrl("S1E13THENAVIGATOR")] as {
      metadata: { title: string; identifier: string };
      files: { name: string; original?: string }[];
    };
    nav.metadata.identifier = "NAVIGATOR";
    nav.files = nav.files.map((f) => ({
      ...f,
      name: f.name.replace("S1E13 - ", ""),
      ...(f.original ? { original: f.original.replace("S1E13 - ", "") } : {}),
    }));
    answers[metadataUrl("NAVIGATOR")] = nav;
    const { extractor } = extractorFor(answers);
    const result = await extractor.extract("https://archive.org/details/onestepbeyondcomplete");
    const navigator = result.episodes.find((e) => e.episode === 13 && e.season !== 2);
    expect(navigator).toMatchObject({ season: 1, inferred: true, title: "The Navigator" });
    expect(codes(result.warnings)).toContain("season-inferred");
  });
});

describe("errors", () => {
  it("rejects what is not an item or collection address before touching the network", async () => {
    const { extractor, requests } = extractorFor({});
    await expect(extractor.extract("https://archive.org/search?query=x")).rejects.toMatchObject({
      code: "unsupported-url",
    });
    expect(requests).toEqual([]);
  });

  it("says not-found for an identifier archive.org answers with an empty object", async () => {
    const { extractor } = extractorFor({ [metadataUrl("nope")]: {} });
    await expect(extractor.extract("https://archive.org/details/nope")).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("says invalid-response for a body that is not metadata", async () => {
    const { extractor } = extractorFor({ [metadataUrl("odd")]: { metadata: "text" } });
    const error = await extractor
      .extract("https://archive.org/details/odd")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractorError);
    expect((error as ExtractorError).code).toBe("invalid-response");
  });

  it("says no-episodes for an item with no video in it", async () => {
    const item = fixture<{ files: unknown[] }>(`${BEVHILL}.metadata`);
    item.files = [];
    const { extractor } = extractorFor({ [metadataUrl(BEVHILL)]: item });
    await expect(extractor.extract(bevhillUrl)).rejects.toMatchObject({ code: "no-episodes" });
  });
});
