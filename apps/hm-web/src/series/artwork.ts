import type { ArtworkKind, ArtworkOptionDto, SeriesDto, ShowLookupDto } from "@orca/hm-contract";
import { artworkUrl } from "@/api/queries";

/** The series field that says it has artwork of that kind of its own. */
export const OWN: Record<ArtworkKind, "hasPoster" | "hasBackdrop" | "hasLogo"> = {
  poster: "hasPoster",
  backdrop: "hasBackdrop",
  logo: "hasLogo",
};

/** Where the TMDB lookup has its pick of each kind. */
export const TMDB_DEFAULT: Record<ArtworkKind, "posterUrl" | "backdropUrl" | "logoUrl"> = {
  poster: "posterUrl",
  backdrop: "backdropUrl",
  logo: "logoUrl",
};

/** The file name of a TMDB image, which is the same at every size it is served. */
export const fileOf = (url: string | null | undefined) => url?.split("/").at(-1) ?? null;

/** What the series shows now for a kind: its own, else TMDB's. */
export function currentArtwork(
  series: SeriesDto,
  tmdb: ShowLookupDto | null,
  kind: ArtworkKind,
): string | null {
  return series[OWN[kind]] ? artworkUrl(series, kind) : (tmdb?.[TMDB_DEFAULT[kind]] ?? null);
}

/** An image chosen for a show being added: one of TMDB's, or a file of one's own to upload. */
export type DraftArtwork = { url: string; previewUrl: string } | { file: File; previewUrl: string };

/** The choices for a show being added, by kind; a kind left out is TMDB's choice. */
export type DraftArtworks = Partial<Record<ArtworkKind, DraftArtwork>>;

/** What a show being added shows of a kind: the image picked for it, else TMDB's choice. */
export function draftArtwork(
  tmdb: ShowLookupDto,
  chosen: DraftArtworks,
  kind: ArtworkKind,
): string | null {
  return chosen[kind]?.previewUrl ?? tmdb[TMDB_DEFAULT[kind]];
}

/** A filter of a kind's images: every one, those in a language (its code), or those with no text. */
export type LanguageFilter = "all" | "none" | `lang:${string}`;

/** The filter an image falls under, besides "all". */
export const filterOf = (option: Pick<ArtworkOptionDto, "language">): LanguageFilter =>
  option.language === null ? "none" : `lang:${option.language}`;

/**
 * The filters a kind's images allow, with how many each keeps: the languages in the order TMDB
 * lists them (the one asked for first), and those with no text last. Empty when there is only one,
 * as there is nothing to filter then.
 */
export function languageFilters(
  options: readonly Pick<ArtworkOptionDto, "language">[],
): { filter: LanguageFilter; language: string | null; count: number }[] {
  const counts = new Map<LanguageFilter, { language: string | null; count: number }>();
  for (const option of options) {
    const filter = filterOf(option);
    const entry = counts.get(filter);
    if (entry) entry.count += 1;
    else counts.set(filter, { language: option.language, count: 1 });
  }
  if (counts.size < 2) return [];
  const listed = [...counts].map(([filter, entry]) => ({ filter, ...entry }));
  return [
    ...listed.filter((entry) => entry.filter !== "none"),
    ...listed.filter((entry) => entry.filter === "none"),
  ];
}

/** The images a filter keeps; one no longer offered keeps them all. */
export function filterOptions<T extends Pick<ArtworkOptionDto, "language">>(
  options: readonly T[],
  filter: LanguageFilter,
): readonly T[] {
  if (filter === "all" || !options.some((option) => filterOf(option) === filter)) return options;
  return options.filter((option) => filterOf(option) === filter);
}
