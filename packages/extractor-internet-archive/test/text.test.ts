import { describe, expect, it } from "vite-plus/test";
import { cleanSeriesTitle, firstYear, stripHtml, tidyUppercase } from "../src/text.ts";

describe("stripHtml", () => {
  it("removes tags and collapses the hard-wrapped lines of a paragraph", () => {
    const html =
      '<p class="MsoNormal">On a battlefield during the first World War, a group of\nFrench soldiers drop their weapons.</p>\n\n<p class="MsoNormal"> </p>';
    expect(stripHtml(html)).toBe(
      "On a battlefield during the first World War, a group of French soldiers drop their weapons.",
    );
  });

  it("keeps paragraph breaks and decodes entities", () => {
    expect(stripHtml("<p>Tom &amp; Jerry&#39;s &quot;show&quot;</p><p>Second&nbsp;one</p>")).toBe(
      'Tom & Jerry\'s "show"\n\nSecond one',
    );
    expect(stripHtml("line one<br>line two<br/>three")).toBe("line one\nline two\nthree");
  });

  it("returns undefined for nothing at all", () => {
    expect(stripHtml(undefined)).toBeUndefined();
    expect(stripHtml("<p> </p>")).toBeUndefined();
  });
});

describe("firstYear", () => {
  it("takes the first 4-digit year, in order of the candidates", () => {
    expect(firstYear(["1962", "1962-71"])).toBe(1962);
    expect(firstYear([], "1954")).toBe(1954);
    expect(firstYear(["unknown"], "1962-71")).toBe(1962);
    expect(firstYear([], undefined)).toBeUndefined();
  });
});

describe("cleanSeriesTitle", () => {
  it("drops the 'complete series' suffix and a trailing season range", () => {
    expect(cleanSeriesTitle("One Step Beyond: The Complete Series")).toBe("One Step Beyond");
    expect(cleanSeriesTitle("beverly hillbillies s01 e01-18")).toBe("beverly hillbillies");
    expect(cleanSeriesTitle("The Beverly Hillbillies TV Show")).toBe(
      "The Beverly Hillbillies TV Show",
    );
  });
});

describe("tidyUppercase", () => {
  it("title-cases a shouting title and leaves a normal one alone", () => {
    expect(tidyUppercase("THE VISION")).toBe("The Vision");
    expect(tidyUppercase("FATHER IMAGE")).toBe("Father Image");
    expect(tidyUppercase("Getting Settled")).toBe("Getting Settled");
  });
});
