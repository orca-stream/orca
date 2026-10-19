import { describe, expect, it } from "vite-plus/test";
import { fixture } from "../test/fixtures.ts";
import { MediaProbeError, selectStreams } from "./index.ts";

const indexes = (list: ReadonlyArray<{ index: number }>) => list.map((s) => s.index);

describe("selectStreams", () => {
  it("keeps every track of a multi-audio mkv and picks mkv", () => {
    const selection = selectStreams(fixture("mkv-two-audio-two-subs"), {});
    expect(selection.container).toBe("mkv");
    expect(selection.video.index).toBe(0);
    expect(indexes(selection.audio)).toEqual([1, 2]);
    expect(indexes(selection.subtitles)).toEqual([3, 4]);
    expect(selection.maps).toEqual([
      "-map",
      "0:0",
      "-map",
      "0:1",
      "-map",
      "0:2",
      "-map",
      "0:3",
      "-map",
      "0:4",
    ]);
    expect(selection.warnings).toEqual([]);
  });

  it("puts the original-language audio first when told which one it is", () => {
    const selection = selectStreams(fixture("mkv-two-audio-two-subs"), { originalLanguage: "SPA" });
    expect(indexes(selection.audio)).toEqual([2, 1]);
  });

  it("falls back to the default-flagged audio as the original", () => {
    const selection = selectStreams(fixture("mkv-anime-original-default"), {});
    expect(indexes(selection.audio)).toEqual([2, 1]);
  });

  it("keeps only the wanted audio and subtitle languages", () => {
    const selection = selectStreams(fixture("mkv-two-audio-two-subs"), {
      audioLangs: ["spa"],
      subtitleLangs: ["eng"],
    });
    expect(indexes(selection.audio)).toEqual([2]);
    expect(indexes(selection.subtitles)).toEqual([3]);
    expect(selection.container).toBe("mkv");
  });

  it("orders the wanted audio with the original first", () => {
    const selection = selectStreams(fixture("mkv-two-audio-two-subs"), {
      audioLangs: ["spa", "jpn"],
      originalLanguage: "jpn",
    });
    expect(indexes(selection.audio)).toEqual([1, 2]);
  });

  it("does not drop the audio when none of the wanted languages exists, and says so", () => {
    const selection = selectStreams(fixture("mkv-two-audio-two-subs"), { audioLangs: ["fra"] });
    expect(indexes(selection.audio)).toEqual([1, 2]);
    expect(selection.warnings).toEqual(['No audio track matches "fra"; keeping all of them']);
  });

  it("picks mp4 for one audio track and no subtitles", () => {
    const selection = selectStreams(fixture("mp4-single-audio"), {});
    expect(selection.container).toBe("mp4");
    expect(selection.maps).toEqual(["-map", "0:0", "-map", "0:1"]);
    expect(selection.subtitleArgs).toEqual([]);
  });

  it("falls back to mp4 when the subtitle filter leaves nothing and one audio remains", () => {
    const selection = selectStreams(fixture("mkv-two-audio-two-subs"), {
      audioLangs: ["jpn"],
      subtitleLangs: [],
    });
    expect(selection.container).toBe("mp4");
    expect(selection.subtitles).toEqual([]);
  });

  it("chooses the tallest rendition that fits maxHeight and takes the audio of its program", () => {
    const hls = fixture("hls-two-renditions");
    expect(selectStreams(hls, {}).video.index).toBe(2);
    expect(selectStreams(hls, { maxHeight: 720 }).video.index).toBe(2);
    const small = selectStreams(hls, { maxHeight: 400 });
    expect(small.video.index).toBe(3);
    expect(small.maps).toEqual(["-map", "0:3", "-map", "0:0", "-map", "0:1"]);
    expect(small.container).toBe("mkv");
  });

  it("takes the shortest rendition when every one is taller than maxHeight", () => {
    expect(selectStreams(fixture("hls-two-renditions"), { maxHeight: 100 }).video.index).toBe(3);
  });

  it("skips bitmap subtitles and copies text ones as they are", () => {
    const selection = selectStreams(fixture("mkv-bitmap-subtitle"), {});
    expect(indexes(selection.subtitles)).toEqual([4]);
    expect(selection.subtitleArgs).toEqual(["-c:s:0", "copy"]);
    const ass = selectStreams(fixture("mkv-anime-original-default"), {});
    expect(ass.subtitleArgs).toEqual(["-c:s:0", "copy", "-c:s:1", "copy"]);
  });

  it("converts subtitle formats a Matroska muxer would not take as text to srt", () => {
    const probe = fixture("mkv-two-audio-two-subs");
    probe.streams[3]!.codec_name = "webvtt";
    expect(selectStreams(probe, {}).subtitleArgs).toEqual(["-c:s:0", "srt", "-c:s:1", "copy"]);
  });

  it("refuses a probe without video", () => {
    const probe = fixture("mp4-single-audio");
    probe.streams = probe.streams.filter((s) => s.codec_type !== "video");
    expect(() => selectStreams(probe, {})).toThrow(MediaProbeError);
  });

  it("ignores attached pictures when looking for the video", () => {
    const probe = fixture("mp4-single-audio");
    probe.streams[0]!.disposition = { ...probe.streams[0]!.disposition, attached_pic: 1 };
    expect(() => selectStreams(probe, {})).toThrow(MediaProbeError);
  });
});
