import { CapturingPattern, SiteBase } from "@orca/extractor-core/site";
import * as z from "zod";

/**
 * One site whose JSON API answers the show, its seasons, their episodes and each episode's players.
 * The code knows the shape of the answers; where the site is, and how it is reached, lives only here.
 */
export const ShowApiSite = SiteBase.extend({
  /** The path of a show's address; its first group is the show's slug. */
  showPath: CapturingPattern("the show's slug"),
  /**
   * The path of a movie's address; its first group is the movie's slug. A movie is read as one video.
   * Absent: the site's movies are not read.
   */
  moviePath: CapturingPattern("the movie's slug").optional(),
  /** Where the API answers, without a trailing slash (`https://site.example/api/v1`). */
  api: z.url().transform((url) => url.replace(/\/+$/, "")),
  /**
   * Where the paths of the site's images are served from (`https://site.example/uploads`), when that
   * is not the site's origin.
   */
  images: z
    .url()
    .transform((url) => url.replace(/\/+$/, ""))
    .optional(),
  /**
   * The audio languages to keep, as the site names them (`Latino`), best first. A dual audio player
   * (`Latino - Inglés`) counts as any of its tracks. Absent: every player, in the site's order.
   */
  languages: z.array(z.string().min(1)).min(1).optional(),
});
export type ShowApiSite = z.infer<typeof ShowApiSite>;
