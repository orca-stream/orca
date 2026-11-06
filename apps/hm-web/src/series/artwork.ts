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
