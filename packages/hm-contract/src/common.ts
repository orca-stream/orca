import * as z from "zod";
import { licenseNeedsAck, type LicenseKind } from "@orca/extractor-core";

export const ApiErrorBody = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
export type Page<T> = { items: T[]; nextCursor: string | null };

export const LICENSE_KINDS = [
  "public-domain",
  "cc0",
  "cc-by",
  "cc-by-sa",
  "cc-other",
  "unknown",
] as const satisfies readonly LicenseKind[];
export const LicenseKindSchema = z.enum(LICENSE_KINDS);

/**
 * Whether adding a series needs the "I have the right to download this" confirmation: an unknown
 * license, a show newer than 1977, or no year at all. The server re-checks it; the panel uses it to
 * decide whether to show the box.
 */
export function needsLicenseAck(input: {
  license: LicenseKind;
  year: number | null | undefined;
}): boolean {
  return licenseNeedsAck(input.license, input.year ?? undefined);
}
