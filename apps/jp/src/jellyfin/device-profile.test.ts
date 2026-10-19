import { describe, expect, it } from "vite-plus/test";
import { browserDeviceProfile, type MediaProbe } from "./device-profile";

/** A browser that decodes exactly what the list names, matched by a piece of the MIME type. */
function probe(file: string[], stream: string[] = file): MediaProbe {
  return {
    file: (type) => file.some((piece) => type.includes(piece)),
    stream: (type) => stream.some((piece) => type.includes(piece)),
  };
}

describe("browserDeviceProfile", () => {
  it("direct-plays only the codecs the browser decodes", () => {
    const profile = browserDeviceProfile(probe(["avc1", "mp4a", "audio/mpeg"]));
    expect(profile.DirectPlayProfiles).toEqual([
      { Container: "mp4,m4v", Type: "Video", VideoCodec: "h264", AudioCodec: "aac,mp3" },
    ]);
  });

  it("adds WebM and HEVC where they decode", () => {
    const profile = browserDeviceProfile(probe(["avc1", "hvc1", "vp9", "mp4a", "opus"]));
    expect(profile.DirectPlayProfiles).toEqual([
      { Container: "mp4,m4v", Type: "Video", VideoCodec: "h264,hevc,vp9", AudioCodec: "aac,opus" },
      { Container: "webm", Type: "Video", VideoCodec: "vp9", AudioCodec: "opus" },
    ]);
    // A HEVC file is remuxed into HLS rather than re-encoded.
    expect(profile.TranscodingProfiles?.[0]?.VideoCodec).toBe("hevc,h264");
  });

  it("transcodes to HLS in fragmented MP4, H.264 and AAC at least", () => {
    // Safari on an older iPhone: no Media Source, native HLS only.
    const profile = browserDeviceProfile(probe(["avc1", "mp4a"], []));
    expect(profile.TranscodingProfiles).toEqual([
      expect.objectContaining({
        Container: "mp4",
        Protocol: "hls",
        VideoCodec: "h264",
        AudioCodec: "aac",
      }),
    ]);
  });

  it("keeps HDR and 10-bit H.264 off direct play", () => {
    const profile = browserDeviceProfile(probe(["avc1", "mp4a"]));
    const h264 = profile.CodecProfiles?.find((entry) => entry.Codec === "h264");
    expect(h264?.Conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ Property: "VideoBitDepth", Value: "8" }),
        expect.objectContaining({ Property: "VideoRangeType", Value: "SDR" }),
      ]),
    );
  });

  it("shows text subtitles itself and burns in picture ones", () => {
    const profile = browserDeviceProfile(probe(["avc1", "mp4a"]));
    expect(profile.SubtitleProfiles).toEqual(
      expect.arrayContaining([
        { Format: "vtt", Method: "External" },
        { Format: "pgssub", Method: "Encode" },
      ]),
    );
  });
});
