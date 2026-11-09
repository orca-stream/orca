import { describe, expect, it } from "vite-plus/test";
import { isSiteSearch, pagesAround, readableLabel } from "./site-search";

describe("pagesAround", () => {
  it("offers every page when there are few", () => {
    expect(pagesAround(0, 1)).toEqual([0]);
    expect(pagesAround(1, 3)).toEqual([0, 1, 2]);
  });

  it("keeps the first, the last and the neighbours, with a gap for the rest", () => {
    expect(pagesAround(0, 10)).toEqual([0, 1, null, 9]);
    expect(pagesAround(5, 10)).toEqual([0, null, 4, 5, 6, null, 9]);
    expect(pagesAround(9, 10)).toEqual([0, null, 8, 9]);
  });

  it("leaves no gap of a single page", () => {
    expect(pagesAround(2, 5)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("isSiteSearch", () => {
  it("asks the sites only with enough letters", () => {
    expect(isSiteSearch(" de ")).toBe(false);
    expect(isSiteSearch("demon")).toBe(true);
  });
});

describe("readableLabel", () => {
  it("keeps a site's word as people read it, and drops a code word", () => {
    expect(readableLabel("OVA")).toBe("OVA");
    expect(readableLabel("TV Anime")).toBe("TV Anime");
    expect(readableLabel("TV_SHORT")).toBe("TV SHORT");
    expect(readableLabel("tvshows")).toBeNull();
    expect(readableLabel("animes")).toBeNull();
    expect(readableLabel(null)).toBeNull();
  });
});
