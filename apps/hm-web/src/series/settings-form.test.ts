import { describe, expect, it } from "vite-plus/test";
import { makeSeries } from "@/test/fixtures";
import {
  ALL_LANGUAGES,
  NO_SUBTITLES,
  applyLanguagePick,
  invalidSettings,
  pickedLanguages,
  settingsOf,
  toSettingsPatch,
} from "./settings-form";

describe("settingsOf", () => {
  it("shows the series as it is, ids empty when it has none", () => {
    expect(settingsOf(makeSeries({ follow: true, tmdbId: "105009" }))).toEqual({
      follow: true,
      interval: "24",
      tmdbId: "105009",
      imdbId: "",
      maxHeight: "",
      audio: "",
      subtitles: "",
      noSubtitles: false,
    });
  });
});

describe("toSettingsPatch", () => {
  const series = makeSeries({ tmdbId: "1", maxHeight: 1080 });

  it("is empty while nothing changed", () => {
    expect(toSettingsPatch(settingsOf(series), series)).toEqual({});
  });

  it("sends only what changed, every field of the bar in one patch", () => {
    const form = {
      ...settingsOf(series),
      follow: true,
      interval: " 6 ",
      tmdbId: "",
      imdbId: "tt0123456",
      audio: "SPA",
      noSubtitles: true,
    };
    expect(toSettingsPatch(form, series)).toEqual({
      follow: true,
      checkIntervalHours: 6,
      tmdbId: null,
      imdbId: "tt0123456",
      audioLangs: ["spa"],
      subtitleLangs: [],
    });
  });

  it("refuses the whole patch while a field can't be sent, and names that field", () => {
    for (const [field, value] of [
      ["interval", "0"],
      ["interval", "721"],
      ["interval", "1.5"],
      ["tmdbId", "abc"],
      ["imdbId", "nope"],
      ["audio", "english"],
      ["subtitles", "es"],
    ] as const) {
      const form = { ...settingsOf(series), [field]: value };
      expect(toSettingsPatch(form, series)).toBe("invalid");
      expect([...invalidSettings(form)]).toEqual([field]);
    }
  });

  it("ignores what is typed as subtitles once there are to be none", () => {
    const form = { ...settingsOf(series), subtitles: "nope", noSubtitles: true };
    expect(invalidSettings(form).size).toBe(0);
    expect(toSettingsPatch(form, series)).toEqual({ subtitleLangs: [] });
  });
});

describe("language picks", () => {
  it("shows the codes in their order, or the choice standing for all or none", () => {
    expect(pickedLanguages("spa, ENG")).toEqual(["spa", "eng"]);
    expect(pickedLanguages("")).toEqual([ALL_LANGUAGES]);
    expect(pickedLanguages("spa", true)).toEqual([NO_SUBTITLES]);
  });

  it("lets all or none, when just picked, clear the codes, and a code replace them", () => {
    expect(applyLanguagePick(["spa"], ["spa", ALL_LANGUAGES])).toEqual({ codes: "", none: false });
    expect(applyLanguagePick(["spa"], ["spa", NO_SUBTITLES])).toEqual({ codes: "", none: true });
    expect(applyLanguagePick([ALL_LANGUAGES], [ALL_LANGUAGES, "jpn"])).toEqual({
      codes: "jpn",
      none: false,
    });
    expect(applyLanguagePick([NO_SUBTITLES], [NO_SUBTITLES, "spa"])).toEqual({
      codes: "spa",
      none: false,
    });
    expect(applyLanguagePick(["jpn", "spa"], ["jpn", "spa", "eng"])).toEqual({
      codes: "jpn, spa, eng",
      none: false,
    });
  });

  it("falls back to all once nothing is left picked", () => {
    expect(applyLanguagePick(["spa"], [])).toEqual({ codes: "", none: false });
    expect(applyLanguagePick([NO_SUBTITLES], [])).toEqual({ codes: "", none: false });
  });
});
