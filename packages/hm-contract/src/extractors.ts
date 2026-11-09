import * as z from "zod";
import { MIN_SITE_SEARCH_LENGTH } from "./rules.ts";

export const ExtractorDto = z.object({
  id: z.string(),
  name: z.string(),
  hosts: z.array(z.string()),
  example: z.string(),
  /** Never matched from an address: the panel offers it as a choice. */
  explicit: z.boolean(),
  /** The site can be searched by name, not only pasted from. */
  searchable: z.boolean(),
});
export type ExtractorDto = z.infer<typeof ExtractorDto>;

const MAX_SITE_SEARCH_LENGTH = 100;

/** A name searched on every site that can be searched. */
export const SiteSearchQuery = z.object({
  q: z.string().trim().min(MIN_SITE_SEARCH_LENGTH).max(MAX_SITE_SEARCH_LENGTH),
});
export type SiteSearchQuery = z.infer<typeof SiteSearchQuery>;

/** A series a site found by name: picking it reads its address the way a pasted one is. */
export const SiteSearchResultDto = z.object({
  url: z.string(),
  title: z.string(),
  originalTitle: z.string().nullable(),
  year: z.number().int().nullable(),
  plot: z.string().nullable(),
  /** Through this server (`/api/search/poster?…`), which fetches it from the site; else null. */
  posterUrl: z.string().nullable(),
});
export type SiteSearchResultDto = z.infer<typeof SiteSearchResultDto>;

/** What one site found, best match first; `failed` when it could not be asked. */
export const SiteSearchDto = z.object({
  extractorId: z.string(),
  results: z.array(SiteSearchResultDto),
  failed: z.boolean(),
});
export type SiteSearchDto = z.infer<typeof SiteSearchDto>;

/** The poster of a search result, on one of its extractor's hosts. */
export const SiteSearchPosterQuery = z.object({
  extractor: z.string().min(1),
  url: z.url(),
});
export type SiteSearchPosterQuery = z.infer<typeof SiteSearchPosterQuery>;
