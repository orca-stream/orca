import { describe, expect, it } from "vite-plus/test";
import { airingHint, finishedStatus } from "./airing";

describe("airingHint", () => {
  it("warns of a followed show that ended or was canceled", () => {
    expect(airingHint(true, "ended")).toBe("ended");
    expect(airingHint(true, "canceled")).toBe("canceled");
  });

  it("points out a show still airing that isn't followed", () => {
    expect(airingHint(false, "airing")).toBe("airing");
  });

  it("says nothing when following matches the show, or TMDB doesn't say", () => {
    expect(airingHint(true, "airing")).toBeNull();
    expect(airingHint(false, "ended")).toBeNull();
    expect(airingHint(false, "canceled")).toBeNull();
    expect(airingHint(true, null)).toBeNull();
    expect(airingHint(false, null)).toBeNull();
  });
});

describe("finishedStatus", () => {
  it("names a show that won't air again", () => {
    expect(finishedStatus("ended")).toBe("ended");
    expect(finishedStatus("canceled")).toBe("canceled");
  });

  it("says nothing of one airing, between seasons, or unknown", () => {
    expect(finishedStatus("airing")).toBeNull();
    expect(finishedStatus("returning")).toBeNull();
    expect(finishedStatus(null)).toBeNull();
    expect(finishedStatus(undefined)).toBeNull();
  });
});
