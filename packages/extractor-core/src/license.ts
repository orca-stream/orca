export type LicenseKind = "public-domain" | "cc0" | "cc-by" | "cc-by-sa" | "cc-other" | "unknown";

/** Shows from this year on are unlikely to be genuinely public domain, whatever the uploader tagged. */
export const LATEST_SAFE_YEAR = 1977;
