import { describe, expect, it } from "vite-plus/test";
import { loginPath, safeNext } from "./next";

describe("safeNext", () => {
  it("keeps a path of the panel, with its query", () => {
    expect(safeNext("/series/abc")).toBe("/series/abc");
    expect(safeNext("/jobs?status=failed")).toBe("/jobs?status=failed");
  });

  it("falls back to the dashboard for anything that could leave the panel", () => {
    for (const bad of [null, "", "series", "//evil.test", "/\\evil.test", "https://evil.test"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });

  it("rejects control characters the URL parser would strip into another origin", () => {
    for (const bad of [
      "/\t/evil.test",
      "/\n/evil.test",
      "/\r/evil.test",
      "/a\u0000b",
      "/a\u007fb",
    ]) {
      expect(safeNext(bad)).toBe("/");
    }
  });

  it("never loops back to the sign-in screen", () => {
    expect(safeNext("/login")).toBe("/");
    expect(safeNext("/login?next=/x")).toBe("/");
  });
});

describe("loginPath", () => {
  it("carries where the person was going", () => {
    expect(loginPath("/series/abc", "")).toBe("/login?next=%2Fseries%2Fabc");
    expect(loginPath("/jobs", "?status=failed")).toBe("/login?next=%2Fjobs%3Fstatus%3Dfailed");
  });

  it("does not carry the dashboard", () => {
    expect(loginPath("/", "")).toBe("/login");
  });
});
