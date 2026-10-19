import { describe, expect, it } from "vite-plus/test";
import { makeSeries } from "../test/fixtures";
import { formState, parseLangs, toTrackPatch } from "./track-prefs";

describe("parseLangs", () => {
  it("reads three-letter codes, lower-cased, ignoring spaces and repeats", () => {
    expect(parseLangs("spa, ENG ,spa")).toEqual(["spa", "eng"]);
  });

  it("is null for nothing, which means the server's default", () => {
    expect(parseLangs("")).toBeNull();
    expect(parseLangs("  ,  ")).toBeNull();
  });

  it("is invalid for anything but ISO 639-2 codes", () => {
    for (const bad of ["english", "es", "sp1", "spa;eng"]) {
      expect(parseLangs(bad)).toBe("invalid");
    }
    expect(parseLangs("spa,eng,jpn,fra,deu,ita,por,rus,kor,zho,ara")).toBe("invalid"); // 11
  });
});

describe("formState", () => {
  it("shows a series on the defaults as empty fields", () => {
    expect(formState(makeSeries())).toEqual({
      maxHeight: "",
      audio: "",
      subtitles: "",
      noSubtitles: false,
    });
  });

  it("shows its own choices, and an empty subtitle list as 'no subtitles'", () => {
    expect(
      formState(makeSeries({ maxHeight: 720, audioLangs: ["spa", "eng"], subtitleLangs: [] })),
    ).toEqual({ maxHeight: "720", audio: "spa, eng", subtitles: "", noSubtitles: true });
  });
});

describe("toTrackPatch", () => {
  const current = makeSeries({ maxHeight: 720, audioLangs: ["spa"], subtitleLangs: ["eng"] });

  it("is empty while nothing changed", () => {
    expect(toTrackPatch(formState(current), current)).toEqual({});
  });

  it("sends only what changed, with null for 'back to the default'", () => {
    expect(
      toTrackPatch({ maxHeight: "", audio: "spa", subtitles: "eng", noSubtitles: false }, current),
    ).toEqual({ maxHeight: null });
    expect(
      toTrackPatch(
        { maxHeight: "1080", audio: "jpn, spa", subtitles: "", noSubtitles: false },
        current,
      ),
    ).toEqual({ maxHeight: 1080, audioLangs: ["jpn", "spa"], subtitleLangs: null });
  });

  it("turns 'no subtitles' into an empty list, whatever is typed in the field", () => {
    expect(
      toTrackPatch(
        { maxHeight: "720", audio: "spa", subtitles: "eng", noSubtitles: true },
        current,
      ),
    ).toEqual({ subtitleLangs: [] });
  });

  it("is invalid for a language that is not a code or a height that is not a size", () => {
    expect(
      toTrackPatch(
        { maxHeight: "720", audio: "english", subtitles: "", noSubtitles: false },
        current,
      ),
    ).toBe("invalid");
    for (const bad of ["abc", "50", "99999", "720.5"]) {
      expect(
        toTrackPatch(
          { maxHeight: bad, audio: "spa", subtitles: "eng", noSubtitles: false },
          current,
        ),
      ).toBe("invalid");
    }
  });
});
