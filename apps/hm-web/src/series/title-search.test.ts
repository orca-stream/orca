import { describe, expect, it } from "vite-plus/test";
import { searchQuery } from "./title-search";

describe("searchQuery", () => {
  it("asks for what was typed, once it is long enough to mean something", () => {
    expect(searchQuery("  Lost ", "Perdidos")).toBe("Lost");
    expect(searchQuery("L", "Perdidos")).toBe("");
  });

  it("asks for the site's name while nothing is typed", () => {
    expect(searchQuery("", " Nocturne ")).toBe("Nocturne");
    expect(searchQuery("   ", null)).toBe("");
  });
});
