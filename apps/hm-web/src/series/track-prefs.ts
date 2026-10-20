import { LANGUAGE_CODE_PATTERN, MAX_MAX_HEIGHT, MIN_MAX_HEIGHT } from "@orca/hm-contract/rules";
import type { SeriesDto, SeriesPatch } from "@/api/types";

const MAX_LANGUAGES = 10;

/** What the "Quality and tracks" form holds. Everything is text while it is typed. */
export interface TrackForm {
  maxHeight: string;
  /** ISO 639-2 codes, comma separated. */
  audio: string;
  subtitles: string;
  noSubtitles: boolean;
}

/** Codes from a comma-separated text: null for nothing (the server's default), "invalid" for the rest. */
export function parseLangs(text: string): string[] | null | "invalid" {
  const parts = text
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
  if (parts.length === 0) return null;
  if (!parts.every((part) => LANGUAGE_CODE_PATTERN.test(part))) return "invalid";
  const unique = [...new Set(parts)];
  return unique.length > MAX_LANGUAGES ? "invalid" : unique;
}

export function formState(series: SeriesDto): TrackForm {
  return {
    maxHeight: series.maxHeight === null ? "" : String(series.maxHeight),
    audio: (series.audioLangs ?? []).join(", "),
    subtitles: (series.subtitleLangs ?? []).join(", "),
    noSubtitles: series.subtitleLangs !== null && series.subtitleLangs.length === 0,
  };
}

function parseHeight(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  const height = Number(trimmed);
  return height >= MIN_MAX_HEIGHT && height <= MAX_MAX_HEIGHT ? height : "invalid";
}

const same = (a: readonly string[] | null, b: readonly string[] | null) =>
  a === b || (a !== null && b !== null && a.length === b.length && a.every((x, i) => x === b[i]));

/** The PATCH for what changed since the series was loaded, or "invalid" when a field cannot be sent. */
export function toTrackPatch(form: TrackForm, current: SeriesDto): SeriesPatch | "invalid" {
  const maxHeight = parseHeight(form.maxHeight);
  const audio = parseLangs(form.audio);
  const subtitles = form.noSubtitles ? [] : parseLangs(form.subtitles);
  if (maxHeight === "invalid" || audio === "invalid" || subtitles === "invalid") return "invalid";
  return {
    ...(maxHeight !== current.maxHeight ? { maxHeight } : {}),
    ...(!same(audio, current.audioLangs) ? { audioLangs: audio } : {}),
    ...(!same(subtitles, current.subtitleLangs) ? { subtitleLangs: subtitles } : {}),
  };
}
