import { describe, expect, it } from "vite-plus/test";
import { normalizeServerUrl } from "./server-url";

describe("normalizeServerUrl", () => {
  it("keeps a clean https origin as is", () => {
    expect(normalizeServerUrl("https://jf.example.com")).toBe("https://jf.example.com");
  });

  it("adds http:// when the scheme is missing", () => {
    expect(normalizeServerUrl("192.168.1.100:8096")).toBe("http://192.168.1.100:8096");
  });

  it("trims whitespace and trailing slashes", () => {
    expect(normalizeServerUrl("  https://jf.example.com///  ")).toBe("https://jf.example.com");
  });

  it("strips the jellyfin-web client path pasted from the address bar", () => {
    expect(normalizeServerUrl("https://jf.example.com/web/#/home")).toBe("https://jf.example.com");
    expect(normalizeServerUrl("http://192.168.1.100:8096/web/index.html")).toBe(
      "http://192.168.1.100:8096",
    );
  });

  it("keeps a reverse-proxy base path", () => {
    expect(normalizeServerUrl("https://example.com/jellyfin/web/")).toBe(
      "https://example.com/jellyfin",
    );
  });

  it("rejects empty input and non-http protocols", () => {
    expect(() => normalizeServerUrl("   ")).toThrow("empty");
    expect(() => normalizeServerUrl("ftp://jf.example.com")).toThrow("Unsupported protocol");
  });
});
