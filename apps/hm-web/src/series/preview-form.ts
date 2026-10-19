import { needsLicenseAck } from "@orca/hm-contract/rules";
import type { CreateSeriesBody, ExtractorDto, PreviewDto, PreviewWarning } from "@orca/hm-contract";

/** What the person edits in the preview before adding the series. The year stays text while typed. */
export interface PreviewForm {
  title: string;
  year: string;
  /** Keys of the episodes to add. */
  included: string[];
  follow: boolean;
  downloadNow: boolean;
  licenseAck: boolean;
}

export function initialForm(preview: PreviewDto): PreviewForm {
  const only = preview.selectedKey;
  return {
    title: preview.series.title,
    year: preview.series.year === null ? "" : String(preview.series.year),
    included: only ? [only] : preview.episodes.map((episode) => episode.key),
    follow: false,
    downloadNow: true,
    licenseAck: false,
  };
}

const MIN_YEAR = 1800;
const MAX_YEAR = 2200;

/** A four-digit year, null for none, or "invalid" for anything else. */
export function parseYear(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{4}$/.test(trimmed)) return "invalid";
  const year = Number(trimmed);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : "invalid";
}

/**
 * Why the license box must be ticked, if it must: the same rule the server re-checks. An unreadable
 * year counts as no year, which is the cautious reading.
 */
export function ackReason(preview: PreviewDto, form: PreviewForm): "license" | "year" | null {
  if (preview.license.kind === "unknown") return "license";
  const parsed = parseYear(form.year);
  const year = parsed === "invalid" ? null : parsed;
  return needsLicenseAck({ license: preview.license.kind, year }) ? "year" : null;
}

export function canConfirm(preview: PreviewDto, form: PreviewForm): boolean {
  if (form.title.trim() === "") return false;
  if (form.included.length === 0) return false;
  if (parseYear(form.year) === "invalid") return false;
  return ackReason(preview, form) === null || form.licenseAck;
}

export function toCreateBody(preview: PreviewDto, form: PreviewForm): CreateSeriesBody {
  const year = parseYear(form.year);
  const chosen = new Set(form.included);
  return {
    previewId: preview.previewId,
    title: form.title.trim(),
    year: year === "invalid" ? null : year,
    episodeKeys: preview.episodes.map((e) => e.key).filter((key) => chosen.has(key)),
    follow: form.follow,
    downloadNow: form.downloadNow,
    licenseAck: ackReason(preview, form) !== null && form.licenseAck,
  };
}

export function toggleEpisode(form: PreviewForm, key: string): PreviewForm {
  return {
    ...form,
    included: form.included.includes(key)
      ? form.included.filter((item) => item !== key)
      : [...form.included, key],
  };
}

export function setAllIncluded(preview: PreviewDto, form: PreviewForm, on: boolean): PreviewForm {
  return { ...form, included: on ? preview.episodes.map((episode) => episode.key) : [] };
}

export function warningsByEpisode(preview: PreviewDto): Map<string, PreviewWarning[]> {
  const map = new Map<string, PreviewWarning[]>();
  for (const warning of preview.warnings) {
    for (const key of warning.keys ?? []) map.set(key, [...(map.get(key) ?? []), warning]);
  }
  return map;
}

export function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

/** Which extractor reads this address, judging by host only (the server has the last word). */
export function matchExtractor(
  address: string,
  extractors: readonly ExtractorDto[],
): ExtractorDto | null {
  const text = address.trim();
  if (text === "") return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase();
  if (!host.includes(".")) return null;
  return (
    extractors.find((extractor) =>
      extractor.hosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`)),
    ) ?? null
  );
}
