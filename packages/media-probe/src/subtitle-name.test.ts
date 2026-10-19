import { describe, expect, it } from "vite-plus/test";
import { externalSubtitleName } from "./index.ts";

describe("externalSubtitleName", () => {
  it("names a subtitle the way Jellyfin finds it next to the video", () => {
    expect(externalSubtitleName({ baseName: "Show S01E01", language: "es", format: "srt" })).toBe(
      "Show S01E01.es.srt",
    );
  });

  it("adds .forced before the extension", () => {
    expect(
      externalSubtitleName({
        baseName: "Show S01E01",
        language: "es",
        format: "srt",
        forced: true,
      }),
    ).toBe("Show S01E01.es.forced.srt");
  });

  it("normalises the language and tolerates a leading dot in the format", () => {
    expect(
      externalSubtitleName({ baseName: "Movie (2001)", language: " PT-br ", format: ".vtt" }),
    ).toBe("Movie (2001).pt-br.vtt");
  });

  it("leaves the language out when it is unknown", () => {
    expect(externalSubtitleName({ baseName: "Show S01E01", format: "ass" })).toBe(
      "Show S01E01.ass",
    );
    expect(externalSubtitleName({ baseName: "Show S01E01", language: "und", format: "ass" })).toBe(
      "Show S01E01.ass",
    );
  });

  it("rejects values that would escape the file name", () => {
    expect(() =>
      externalSubtitleName({ baseName: "a", language: "../x", format: "srt" }),
    ).toThrow();
    expect(() => externalSubtitleName({ baseName: "a", language: "es", format: "s/rt" })).toThrow();
  });
});
