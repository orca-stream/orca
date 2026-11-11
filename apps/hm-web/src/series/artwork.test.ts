import { describe, expect, it } from "vite-plus/test";
import { filterOptions, languageFilters } from "./artwork";

const image = (language: string | null, id: string) => ({ language, id });

describe("the language filter of a kind's images", () => {
  it("offers each language in TMDB's order, with no text last, and how many each has", () => {
    const options = [image("es", "a"), image(null, "b"), image("en", "c"), image("es", "d")];
    expect(languageFilters(options)).toEqual([
      { filter: "lang:es", language: "es", count: 2 },
      { filter: "lang:en", language: "en", count: 1 },
      { filter: "none", language: null, count: 1 },
    ]);
  });

  it("offers nothing when every image falls under one filter", () => {
    expect(languageFilters([image(null, "a"), image(null, "b")])).toEqual([]);
    expect(languageFilters([])).toEqual([]);
  });

  it("keeps the images of the filter, and all of them for one no longer offered", () => {
    const options = [image("es", "a"), image(null, "b"), image("en", "c")];
    expect(filterOptions(options, "none").map((o) => o.id)).toEqual(["b"]);
    expect(filterOptions(options, "lang:es").map((o) => o.id)).toEqual(["a"]);
    expect(filterOptions(options, "all")).toHaveLength(3);
    expect(filterOptions(options, "lang:fr")).toHaveLength(3);
  });
});
