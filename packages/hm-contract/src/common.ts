import * as z from "zod";
import type { LicenseKind } from "@orca/extractor-core";

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
 * What an entry is: a show (seasons of episodes, in the series folder) or a movie (one video, in
 * the movies folder). A show's specials are a show's episodes in season 0.
 */
export const MediaKind = z.enum(["show", "movie"]);
export type MediaKind = z.infer<typeof MediaKind>;
