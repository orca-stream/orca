import type { CodecProfile } from "@jellyfin/sdk/lib/generated-client/models/codec-profile";
import { CodecType } from "@jellyfin/sdk/lib/generated-client/models/codec-type";
import type { DeviceProfile } from "@jellyfin/sdk/lib/generated-client/models/device-profile";
import type { DirectPlayProfile } from "@jellyfin/sdk/lib/generated-client/models/direct-play-profile";
import { DlnaProfileType } from "@jellyfin/sdk/lib/generated-client/models/dlna-profile-type";
import { EncodingContext } from "@jellyfin/sdk/lib/generated-client/models/encoding-context";
import { MediaStreamProtocol } from "@jellyfin/sdk/lib/generated-client/models/media-stream-protocol";
import type { ProfileCondition } from "@jellyfin/sdk/lib/generated-client/models/profile-condition";
import { ProfileConditionType } from "@jellyfin/sdk/lib/generated-client/models/profile-condition-type";
import { ProfileConditionValue } from "@jellyfin/sdk/lib/generated-client/models/profile-condition-value";
import { SubtitleDeliveryMethod } from "@jellyfin/sdk/lib/generated-client/models/subtitle-delivery-method";

/**
 * What the platform can decode. The port behind the device profile: the browser answers from its
 * video element, and the Xbox and the TV will answer from what they are known to play.
 */
export interface MediaProbe {
  /** A file the video element can play from start to end (`canPlayType`). */
  file: (type: string) => boolean;
  /** A stream fed through Media Source Extensions, which is how hls.js plays a transcode. */
  stream: (type: string) => boolean;
}

/** Media Source types tried for each codec, the way jellyfin-web asks the browser. */
const VIDEO = {
  h264: 'video/mp4; codecs="avc1.640029"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
  av1: 'video/mp4; codecs="av01.0.15M.08"',
  vp9: 'video/webm; codecs="vp9"',
  vp8: 'video/webm; codecs="vp8"',
} as const;

const AUDIO = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: "audio/mpeg",
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  opus: 'audio/webm; codecs="opus"',
  flac: 'audio/mp4; codecs="flac"',
  vorbis: 'audio/webm; codecs="vorbis"',
} as const;

/** Bits per second. High enough that a LAN never transcodes for bandwidth alone. */
const MAX_BITRATE = 120_000_000;

function supported<T extends string>(table: Record<T, string>, test: (type: string) => boolean) {
  return (Object.keys(table) as T[]).filter((codec) => test(table[codec]));
}

function condition(
  type: ProfileConditionType,
  property: ProfileConditionValue,
  value: string,
): ProfileCondition {
  return { Condition: type, Property: property, Value: value, IsRequired: false };
}

/**
 * SDR only: a browser has no say over the display, and an HDR picture shown on an SDR screen comes
 * out washed. The server tone-maps it instead.
 */
const SDR = condition(ProfileConditionType.EqualsAny, ProfileConditionValue.VideoRangeType, "SDR");

/**
 * The device profile sent with every PlaybackInfo request: it is what the server reads to decide
 * between playing the file as is, remuxing it, or transcoding it.
 */
export function browserDeviceProfile(probe: MediaProbe): DeviceProfile {
  const video = supported(VIDEO, probe.file);
  const audio = supported(AUDIO, probe.file);
  const mp4Video = video.filter((codec) => codec !== "vp8");
  const mp4Audio = audio.filter((codec) => codec !== "vorbis");
  const webmVideo = video.filter((codec) => ["vp8", "vp9", "av1"].includes(codec));
  const webmAudio = audio.filter((codec) => ["opus", "vorbis"].includes(codec));

  const directPlay: DirectPlayProfile[] = [];
  if (mp4Video.length > 0) {
    directPlay.push({
      Container: "mp4,m4v",
      Type: DlnaProfileType.Video,
      VideoCodec: mp4Video.join(","),
      AudioCodec: mp4Audio.join(","),
    });
  }
  if (webmVideo.length > 0) {
    directPlay.push({
      Container: "webm",
      Type: DlnaProfileType.Video,
      VideoCodec: webmVideo.join(","),
      AudioCodec: webmAudio.join(","),
    });
  }

  // HLS in fragmented MP4: hls.js feeds it to Media Source, and Safari plays it natively. HEVC goes
  // first when it decodes, so a 4K HEVC file is remuxed rather than re-encoded.
  const hlsVideo = (["hevc", "h264"] as const).filter((codec) => probe.stream(VIDEO[codec]));
  const hlsAudio = (["aac", "mp3", "ac3", "eac3"] as const).filter((codec) =>
    probe.stream(AUDIO[codec]),
  );

  const codecProfiles: CodecProfile[] = [
    {
      Type: CodecType.Video,
      Codec: "h264",
      Conditions: [
        condition(
          ProfileConditionType.EqualsAny,
          ProfileConditionValue.VideoProfile,
          "high|main|baseline|constrained baseline",
        ),
        condition(ProfileConditionType.LessThanEqual, ProfileConditionValue.VideoLevel, "52"),
        // 10-bit H.264 (Hi10P) decodes nowhere in a browser.
        condition(ProfileConditionType.LessThanEqual, ProfileConditionValue.VideoBitDepth, "8"),
        SDR,
      ],
    },
    {
      Type: CodecType.Video,
      Codec: "hevc",
      Conditions: [
        condition(
          ProfileConditionType.EqualsAny,
          ProfileConditionValue.VideoProfile,
          "main|main 10",
        ),
        SDR,
      ],
    },
    { Type: CodecType.Video, Codec: "av1", Conditions: [SDR] },
    { Type: CodecType.Video, Codec: "vp9", Conditions: [SDR] },
  ];

  return {
    Name: "Orca'JP",
    MaxStreamingBitrate: MAX_BITRATE,
    MaxStaticBitrate: MAX_BITRATE,
    DirectPlayProfiles: directPlay,
    TranscodingProfiles: [
      {
        Container: "mp4",
        Type: DlnaProfileType.Video,
        VideoCodec: (hlsVideo.length > 0 ? hlsVideo : ["h264"]).join(","),
        AudioCodec: (hlsAudio.length > 0 ? hlsAudio : ["aac"]).join(","),
        Protocol: MediaStreamProtocol.Hls,
        Context: EncodingContext.Streaming,
        MaxAudioChannels: "2",
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: codecProfiles,
    SubtitleProfiles: [
      // Text subtitles of any format are converted to WebVTT and shown by the video element.
      { Format: "vtt", Method: SubtitleDeliveryMethod.External },
      // Picture subtitles can only be burned into a transcode.
      { Format: "pgssub", Method: SubtitleDeliveryMethod.Encode },
      { Format: "dvdsub", Method: SubtitleDeliveryMethod.Encode },
      { Format: "dvbsub", Method: SubtitleDeliveryMethod.Encode },
    ],
  };
}

/** The adapter for a browser: asks a throwaway video element and Media Source. */
export function browserProbe(): MediaProbe {
  const element = document.createElement("video");
  return {
    file: (type) => element.canPlayType(type) !== "",
    stream: (type) => typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(type),
  };
}
