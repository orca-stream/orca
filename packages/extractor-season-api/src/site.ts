import { CapturingPattern, SiteBase } from "@orca/extractor-core/site";
import * as z from "zod";

/** The audio tracks the API offers each episode in: `sub` (original audio) and `dub`. */
export const Track = z.enum(["sub", "dub"]);
export type Track = z.infer<typeof Track>;

/**
 * One site whose JSON API answers a whole season at once — its details, every episode and each
 * episode's players — under one address per season. The code knows the shape of the answer; where
 * the site is, and how it is reached, lives only here.
 */
export const SeasonApiSite = SiteBase.extend({
  /** The path of a season's address; its first group is the season's id in the API. */
  seasonPath: CapturingPattern("the season's id"),
  /** Where the API answers, without a trailing slash (`https://site.example/api/v1`). */
  api: z.url().transform((url) => url.replace(/\/+$/, "")),
  /**
   * The audio tracks to keep, best first: the first one an episode has is tried first, the next one
   * when its player fails. Absent: both, original audio first.
   */
  tracks: z.array(Track).min(1).optional(),
});
export type SeasonApiSite = z.infer<typeof SeasonApiSite>;
