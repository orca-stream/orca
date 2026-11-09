import type { ArtworkKind, SeriesDto, ShowLookupDto } from "@orca/hm-contract";
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
