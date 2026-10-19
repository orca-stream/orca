import { describe, expect, it } from "vite-plus/test";
import { licenseNeedsAck } from "./license.ts";

describe("licenseNeedsAck", () => {
  it("asks for confirmation when the license is unknown", () => {
    expect(licenseNeedsAck("unknown", 1960)).toBe(true);
    expect(licenseNeedsAck("unknown", undefined)).toBe(true);
  });

  it("asks for confirmation when the year is not known", () => {
    expect(licenseNeedsAck("public-domain", undefined)).toBe(true);
  });

  it("asks for confirmation when the show is newer than 1977, whatever the license says", () => {
    expect(licenseNeedsAck("public-domain", 1982)).toBe(true);
    expect(licenseNeedsAck("cc0", 1996)).toBe(true);
    expect(licenseNeedsAck("cc-by", 2010)).toBe(true);
  });

  it("lets an old show with a known license through", () => {
    expect(licenseNeedsAck("public-domain", 1962)).toBe(false);
    expect(licenseNeedsAck("public-domain", 1977)).toBe(false);
  });
});
