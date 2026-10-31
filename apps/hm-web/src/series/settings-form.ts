import type { SeriesDto, SeriesPatch } from "@/api/types";
import { isInvalidImdbId, isInvalidTmdbId, parseImdbId, parseTmdbId } from "./preview-form";
import { formState, parseLangs, toTrackPatch, type TrackForm } from "./track-prefs";

/** The longest a followed series may wait between checks: a month. */
export const MAX_CHECK_HOURS = 24 * 30;

/** Everything the series' bar edits, as text while it is typed; one Save sends what changed. */
export interface SettingsForm extends TrackForm {
  follow: boolean;
  interval: string;
  tmdbId: string;
  imdbId: string;
}

export type SettingsField = "interval" | "tmdbId" | "imdbId" | "audio" | "subtitles";

export function settingsOf(series: SeriesDto): SettingsForm {
  return {
    follow: series.follow,
    interval: String(series.checkIntervalHours),
    tmdbId: series.tmdbId ?? "",
    imdbId: series.imdbId ?? "",
    ...formState(series),
  };
}

function parseInterval(text: string): number | "invalid" {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const hours = Number(trimmed);
  return hours >= 1 && hours <= MAX_CHECK_HOURS ? hours : "invalid";
}

/** The fields that can't be sent as they are; the bar marks each one. */
export function invalidSettings(form: SettingsForm): Set<SettingsField> {
  const invalid = new Set<SettingsField>();
  if (parseInterval(form.interval) === "invalid") invalid.add("interval");
  if (isInvalidTmdbId(form.tmdbId)) invalid.add("tmdbId");
  if (isInvalidImdbId(form.imdbId)) invalid.add("imdbId");
  if (parseLangs(form.audio) === "invalid") invalid.add("audio");
  if (!form.noSubtitles && parseLangs(form.subtitles) === "invalid") invalid.add("subtitles");
  return invalid;
}

/** The PATCH for what changed since the series was loaded; empty when nothing did. */
export function toSettingsPatch(form: SettingsForm, series: SeriesDto): SeriesPatch | "invalid" {
  const interval = parseInterval(form.interval);
  const tracks = toTrackPatch(form, series);
  if (interval === "invalid" || tracks === "invalid" || invalidSettings(form).size > 0)
    return "invalid";
  const tmdbId = parseTmdbId(form.tmdbId);
  const imdbId = parseImdbId(form.imdbId);
  return {
    ...(form.follow !== series.follow ? { follow: form.follow } : {}),
    ...(interval !== series.checkIntervalHours ? { checkIntervalHours: interval } : {}),
    ...(tmdbId !== series.tmdbId ? { tmdbId } : {}),
    ...(imdbId !== series.imdbId ? { imdbId } : {}),
    ...tracks,
  };
}

/** The heights worth offering; a height set another way still shows up as its own option. */
export const COMMON_HEIGHTS = [2160, 1440, 1080, 720, 480, 360] as const;

/** The languages every list offers; a code the series already has is offered after them. */
export const COMMON_LANGUAGES = [
  "spa",
  "eng",
  "jpn",
  "por",
  "fre",
  "ger",
  "ita",
  "kor",
  "chi",
  "rus",
  "ara",
  "hin",
] as const;
/** The choice of a language list that stands for every track: nothing picked. */
export const ALL_LANGUAGES = "*";
/** The choice of the subtitles list that keeps none of them. */
export const NO_SUBTITLES = "-";

/** The codes of a comma-separated text, in its order. */
export function codesOf(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
}

/** What a language list shows as picked: the codes, or the one choice standing for all (or none). */
export function pickedLanguages(text: string, none = false): string[] {
  if (none) return [NO_SUBTITLES];
  const codes = codesOf(text);
  return codes.length > 0 ? codes : [ALL_LANGUAGES];
}

/**
 * A language list's picks after a click: "all" or "none", when just picked, clear the rest; a code
 * picked after them takes their place; nothing left picked means all.
 */
export function applyLanguagePick(
  previous: readonly string[],
  next: readonly string[],
): { codes: string; none: boolean } {
  const added = next.find((value) => !previous.includes(value));
  if (added === ALL_LANGUAGES) return { codes: "", none: false };
  if (added === NO_SUBTITLES) return { codes: "", none: true };
  const codes = next.filter((value) => value !== ALL_LANGUAGES && value !== NO_SUBTITLES);
  if (codes.length > 0) return { codes: codes.join(", "), none: false };
  return { codes: "", none: next.includes(NO_SUBTITLES) };
}
