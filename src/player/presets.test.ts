import { describe, expect, it } from "vite-plus/test";
import type { PlaybackSource } from "../jellyfin/playback";
import { languageName, presetChoice, trackPresets } from "./presets";

const withSubtitles = (language: string) => `${language} con subtítulos`;

function source(overrides: Partial<PlaybackSource> = {}): PlaybackSource {
  return {
    url: "https://jf.example.com/v",
    hls: false,
    method: "DirectPlay",
    itemId: "ep-1",
    mediaSourceId: "ms-1",
    playSessionId: "ps-1",
    audioTracks: [
      { index: 1, label: "Japanese - AAC", language: "jpn", default: true },
      { index: 2, label: "Spanish - AAC", language: "spa", default: false },
    ],
    subtitleTracks: [
      { index: 3, label: "Spanish (Forced)", language: "spa", default: false, forced: true },
      { index: 4, label: "Spanish", language: "spa", default: false },
      { index: 5, label: "English", language: "eng", default: false },
    ],
    audioIndex: 1,
    subtitleIndex: 4,
    ...overrides,
  };
}

describe("trackPresets", () => {
  it("lays out Netflix's chips: the dub, the original with subtitles, the dub with subtitles", () => {
    expect(trackPresets(source(), "es", withSubtitles)).toEqual([
      { label: "Español", audioIndex: 2, subtitleIndex: -1, active: false },
      { label: "Japonés con subtítulos", audioIndex: 1, subtitleIndex: 4, active: true },
      { label: "Español con subtítulos", audioIndex: 2, subtitleIndex: 4, active: false },
    ]);
  });

  it("offers a foreign audio on its own when nothing is subtitled in the app's language", () => {
    const presets = trackPresets(source({ subtitleTracks: [] }), "es", withSubtitles);
    expect(presets.map((preset) => preset.label)).toEqual(["Español", "Japonés"]);
  });

  it("keeps one chip per language and at most four", () => {
    const audioTracks = ["jpn", "jpn", "eng", "fra", "deu", "ita"].map((language, index) => ({
      index,
      label: language,
      language,
      default: index === 0,
    }));
    const presets = trackPresets(source({ audioTracks }), "es", withSubtitles);
    expect(presets).toHaveLength(4);
    expect(new Set(presets.map((preset) => preset.audioIndex)).size).toBe(4);
  });
});

describe("presetChoice", () => {
  it("switches only the subtitles when the audio stays", () => {
    const [, japanese] = trackPresets(source({ subtitleIndex: undefined }), "es", withSubtitles);
    expect(presetChoice(source(), japanese!)).toEqual({ subtitleIndex: 4 });
  });

  it("asks for the other audio and turns subtitles off", () => {
    const [spanish] = trackPresets(source(), "es", withSubtitles);
    expect(presetChoice(source(), spanish!)).toEqual({ audioIndex: 2, subtitleIndex: -1 });
  });
});

describe("languageName", () => {
  it("falls back to the track's label without a language Intl knows", () => {
    expect(languageName({ index: 1, label: "Track 1", default: false }, "es")).toBe("Track 1");
    expect(
      languageName({ index: 1, label: "Track 1", language: "und", default: false }, "es"),
    ).toBe("Track 1");
  });
});
