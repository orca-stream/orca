import { describe, expect, it } from "vite-plus/test";
import { ExtractorError } from "@orca/extractor-core";
import { canHandleUrl, parseIaUrl } from "../src/url.ts";

describe("parseIaUrl", () => {
  const accepted: [string, { id: string; file?: string }][] = [
    ["https://archive.org/details/bevhill-s01e01-36", { id: "bevhill-s01e01-36" }],
    ["http://archive.org/details/bevhill-s01e01-36", { id: "bevhill-s01e01-36" }],
    ["https://www.archive.org/details/X.y_z-1?tab=about#frag", { id: "X.y_z-1" }],
    ["https://archive.org/details/X/", { id: "X" }],
    [
      "https://archive.org/details/X/S1E10%20-%20THE%20VISION.mp4",
      { id: "X", file: "S1E10 - THE VISION.mp4" },
    ],
    ["https://archive.org/download/X", { id: "X" }],
    [
      "https://archive.org/download/X/dir/file%20one.mp4?x=1",
      { id: "X", file: "dir/file one.mp4" },
    ],
    ["https://archive.org/embed/X", { id: "X" }],
    ["  https://archive.org/details/X  ", { id: "X" }],
  ];
  it.each(accepted)("accepts %s", (url, expected) => {
    expect(parseIaUrl(url)).toEqual(expected);
  });

  const rejected = [
    "https://archive.org/search?query=hillbillies",
    "https://archive.org/search.php?query=x",
    "https://archive.org/details/@someuser",
    "https://archive.org/details/",
    "https://archive.org/details",
    "https://archive.org/about/",
    "https://archive.org/",
    "https://web.archive.org/web/2020/https://example.com",
    "https://example.com/details/X",
    "not a url",
    "ftp://archive.org/details/X",
  ];
  it.each(rejected)("rejects %s with an unsupported-url error", (url) => {
    try {
      parseIaUrl(url);
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractorError);
      expect((error as ExtractorError).code).toBe("unsupported-url");
      return;
    }
    throw new Error("expected parseIaUrl to throw");
  });
});

describe("canHandleUrl", () => {
  it("claims archive.org hosts only, without looking at the path", () => {
    expect(canHandleUrl("https://archive.org/details/X")).toBe(true);
    expect(canHandleUrl("http://www.archive.org/search?query=x")).toBe(true);
    expect(canHandleUrl("https://web.archive.org/web/2020/https://example.com")).toBe(false);
    expect(canHandleUrl("https://example.com/")).toBe(false);
    expect(canHandleUrl("garbage")).toBe(false);
  });
});
