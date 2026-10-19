import {
  MediaProbeError,
  type ProbeResult,
  type ProbeStream,
  type SelectionPrefs,
  type StreamSelection,
} from "./types.ts";

/** ffmpeg input the `-map` arguments refer to. */
const INPUT = "0";

/** Subtitle codecs made of text. Bitmap ones (PGS, DVD, DVB) cannot become srt and are dropped. */
const TEXT_SUBTITLE_CODECS: ReadonlySet<string> = new Set([
  "subrip",
  "srt",
  "ass",
  "ssa",
  "webvtt",
  "mov_text",
  "text",
  "subviewer",
]);

/** Text codecs Matroska stores unchanged. Anything else is converted to srt. */
const MATROSKA_TEXT_CODECS: ReadonlySet<string> = new Set(["subrip", "srt", "ass", "ssa"]);

const norm = (value: string | undefined) => value?.trim().toLowerCase() ?? "";

function tag(stream: ProbeStream, name: string): string {
  const found = Object.entries(stream.tags ?? {}).find(([key]) => key.toLowerCase() === name);
  return norm(found?.[1]);
}

const language = (stream: ProbeStream) => tag(stream, "language");
const flagged = (stream: ProbeStream, name: string) => (stream.disposition?.[name] ?? 0) === 1;

function pickVideo(streams: readonly ProbeStream[], maxHeight: number | undefined): ProbeStream {
  const videos = streams.filter((s) => s.codec_type === "video" && !flagged(s, "attached_pic"));
  if (videos.length === 0) throw new MediaProbeError("no-video", "The stream has no video track");

  const height = (s: ProbeStream) => s.height ?? 0;
  const bitrate = (s: ProbeStream) => Number(s.bit_rate ?? 0) || 0;
  const fitting = maxHeight === undefined ? videos : videos.filter((s) => height(s) <= maxHeight);
  // Nothing fits: take the shortest ones rather than fail.
  const shortest = Math.min(...videos.map(height));
  const pool = fitting.length > 0 ? fitting : videos.filter((s) => height(s) === shortest);
  return pool.reduce((best, s) =>
    height(s) > height(best) || (height(s) === height(best) && bitrate(s) > bitrate(best))
      ? s
      : best,
  );
}

function orderAudio(
  audio: ProbeStream[],
  prefs: SelectionPrefs,
  warnings: string[],
): ProbeStream[] {
  let kept = audio;
  if (prefs.audioLangs !== undefined) {
    const wanted = new Set(prefs.audioLangs.map(norm));
    const matching = audio.filter((s) => wanted.has(language(s)));
    if (matching.length > 0) kept = matching;
    else if (audio.length > 0) {
      warnings.push(`No audio track matches "${prefs.audioLangs.join(", ")}"; keeping all of them`);
    }
  }
  const original =
    kept.find(
      (s) => prefs.originalLanguage !== undefined && language(s) === norm(prefs.originalLanguage),
    ) ??
    kept.find((s) => flagged(s, "original")) ??
    kept.find((s) => flagged(s, "default")) ??
    kept[0];
  return original ? [original, ...kept.filter((s) => s !== original)] : kept;
}

/**
 * Chooses which tracks of a probed stream ffmpeg keeps (plan F5.5). Pure.
 *
 * HLS probes list one program per rendition; audio and subtitles come from the chosen video's
 * program when it has any, so renditions that carry their own audio are not mixed up.
 */
export function selectStreams(probe: ProbeResult, prefs: SelectionPrefs): StreamSelection {
  const warnings: string[] = [];
  const video = pickVideo(probe.streams, prefs.maxHeight);

  const program = probe.programs?.find((p) => p.streams?.some((s) => s.index === video.index));
  const scope = program?.streams?.length ? program.streams : probe.streams;

  const audio = orderAudio(
    scope.filter((s) => s.codec_type === "audio"),
    prefs,
    warnings,
  );

  const wantedSubs =
    prefs.subtitleLangs === undefined ? undefined : new Set(prefs.subtitleLangs.map(norm));
  const subtitles = scope.filter(
    (s) =>
      s.codec_type === "subtitle" &&
      TEXT_SUBTITLE_CODECS.has(norm(s.codec_name)) &&
      (wantedSubs === undefined || wantedSubs.has(language(s))),
  );

  const container = audio.length > 1 || subtitles.length > 0 ? "mkv" : "mp4";
  const subtitleArgs = subtitles.flatMap((s, i) => [
    `-c:s:${i}`,
    MATROSKA_TEXT_CODECS.has(norm(s.codec_name)) ? "copy" : "srt",
  ]);

  return {
    video,
    audio,
    subtitles,
    maps: [video, ...audio, ...subtitles].flatMap((s) => ["-map", `${INPUT}:${s.index}`]),
    subtitleArgs,
    container,
    warnings,
  };
}
