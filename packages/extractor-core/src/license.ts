export type LicenseKind = "public-domain" | "cc0" | "cc-by" | "cc-by-sa" | "cc-other" | "unknown";

/** Shows from this year on are unlikely to be genuinely public domain, whatever the uploader tagged. */
export const LATEST_SAFE_YEAR = 1977;

/**
 * Uploaders set the license field themselves and are sometimes wrong, so a license that is unknown,
 * or a show with no year or newer than {@link LATEST_SAFE_YEAR}, needs an explicit "I have the right to download
 * this" confirmation before it is added.
 */
export function licenseNeedsAck(kind: LicenseKind, year: number | undefined): boolean {
  return kind === "unknown" || year === undefined || year > LATEST_SAFE_YEAR;
}
