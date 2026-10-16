import type { PlaybackChoice, PlaybackSource, Track } from "../jellyfin/playback";

/** One of the TV player's audio-and-subtitle chips: "Español", "Japonés con subtítulos". */
export interface TrackPreset {
  label: string;
  audioIndex: number;
  /** -1 for no subtitles. */
  subtitleIndex: number;
  active: boolean;
}

/** Netflix shows a handful; the rest are behind "Other…". */
const MAX_PRESETS = 4;

/** Codes that say there is no language: undetermined, uncoded, several, none. */
const NO_LANGUAGE = new Set(["und", "mis", "mul", "zxx"]);

/** "jpn" → "Japonés", in the app's language; the track's own label when it has no language. */
export function languageName(track: Track, locale: string): string {
  if (!track.language || NO_LANGUAGE.has(track.language)) return track.label;
  try {
    const name = new Intl.DisplayNames([locale], { type: "language", fallback: "none" }).of(
      track.language,
    );
    if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    // Not a language code Intl knows ("und", "mis"…).
  }
  return track.label;
}

/** Whether a track's language is the app's: "spa", "es" and "es-419" all are Spanish. */
function speaks(track: Track, locale: string): boolean {
  if (!track.language) return false;
  try {
    const base = (tag: string) => new Intl.Locale(tag).maximize().language;
    return base(track.language) === base(locale);
  } catch {
    return false;
  }
}

/**
 * The chips Netflix's TV player lays under the timeline: the audio in the app's language on its
 * own, every other language with subtitles in the app's language, and the app's language with its
 * own subtitles. One audio per language; a full subtitle track over a forced one.
 */
export function trackPresets(
  source: PlaybackSource,
  locale: string,
  withSubtitles: (language: string) => string,
): TrackPreset[] {
  const seen = new Set<string>();
  const audios = source.audioTracks.filter((track) => {
    const key = track.language ?? `#${track.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const own = source.subtitleTracks.filter((track) => speaks(track, locale));
  const subtitle = own.find((track) => !track.forced) ?? own[0];

  const presets: Omit<TrackPreset, "active">[] = [];
  const native = audios.filter((track) => speaks(track, locale));
  const foreign = audios.filter((track) => !speaks(track, locale));
  for (const audio of native) {
    presets.push({
      label: languageName(audio, locale),
      audioIndex: audio.index,
      subtitleIndex: -1,
    });
  }
  for (const audio of foreign) {
    const name = languageName(audio, locale);
    presets.push(
      subtitle
        ? { label: withSubtitles(name), audioIndex: audio.index, subtitleIndex: subtitle.index }
        : { label: name, audioIndex: audio.index, subtitleIndex: -1 },
    );
  }
  if (subtitle) {
    for (const audio of native) {
      presets.push({
        label: withSubtitles(languageName(audio, locale)),
        audioIndex: audio.index,
        subtitleIndex: subtitle.index,
      });
    }
  }

  const audioIndex = source.audioIndex ?? source.audioTracks.find((track) => track.default)?.index;
  const subtitleIndex = source.subtitleIndex ?? -1;
  return presets.slice(0, MAX_PRESETS).map((preset) => ({
    ...preset,
    active: preset.audioIndex === audioIndex && preset.subtitleIndex === subtitleIndex,
  }));
}

/** What picking a chip asks of the player: same audio switches subtitles without a new stream. */
export function presetChoice(source: PlaybackSource, preset: TrackPreset): PlaybackChoice {
  return {
    ...(preset.audioIndex !== source.audioIndex ? { audioIndex: preset.audioIndex } : {}),
    subtitleIndex: preset.subtitleIndex,
  };
}
