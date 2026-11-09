import { describe, expect, it } from "vite-plus/test";
import { normalizeUrl, numberingWarnings, ownedUrl, ownsHost, parseUrl } from "../src/index.ts";
import { CapturingPattern, Pattern } from "../src/site.ts";

describe("addresses", () => {
  it("owns a host and its subdomains, not look-alikes", () => {
    expect(ownsHost(["site.example"], "site.example")).toBe(true);
    expect(ownsHost(["site.example"], "www.site.example")).toBe(true);
    expect(ownsHost(["site.example"], "othersite.example")).toBe(false);
  });

  it("reads only web addresses", () => {
    expect(parseUrl("  https://site.example/a ")?.href).toBe("https://site.example/a");
    expect(parseUrl("ftp://site.example/a")).toBeNull();
    expect(parseUrl("not an address")).toBeNull();
  });

  it("normalizes away query, fragment and trailing slashes", () => {
    const url = normalizeUrl(new URL("https://site.example/show//?x=1#top"));
    expect(url.href).toBe("https://site.example/show");
    expect(normalizeUrl(new URL("https://site.example/")).href).toBe("https://site.example/");
  });

  it("owns an address by its host, case-insensitively", () => {
    expect(ownedUrl(["site.example"], "https://WWW.Site.Example/x")).not.toBeNull();
    expect(ownedUrl(["site.example"], "https://other.example/x")).toBeNull();
  });
});

describe("numberingWarnings", () => {
  const ep = (episode: number, sourceRef: string) => ({ episode, sourceRef });

  it("says nothing about a clean season, or an empty one", () => {
    expect(numberingWarnings([ep(1, "a"), ep(2, "b")])).toEqual([]);
    expect(numberingWarnings([])).toEqual([]);
  });

  it("names duplicates and the gaps between the lowest and highest number", () => {
    expect(numberingWarnings([ep(1, "a"), ep(1, "b"), ep(4, "c")])).toEqual([
      { code: "duplicate", message: "Episode 1 is listed 2 times", sourceRefs: ["a", "b"] },
      { code: "gap", message: "Missing episode numbers: 2, 3" },
    ]);
  });
});

describe("patterns", () => {
  it("refuses a pattern that won't compile", () => {
    expect(Pattern.safeParse("(").success).toBe(false);
  });

  it("asks a capturing pattern for a group", () => {
    const Slug = CapturingPattern("the show's slug");
    expect(Slug.safeParse("^/series/([^/]+)$").success).toBe(true);
    expect(Slug.safeParse("^/series/[^/]+$").error?.issues[0]?.message).toBe(
      "Needs a group that captures the show's slug",
    );
  });
});
