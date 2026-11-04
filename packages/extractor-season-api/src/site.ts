import * as z from "zod";

/** A regular expression written as a string in the file; refused at load time when it won't compile. */
const Pattern = z.string().refine(
  (source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Not a valid regular expression" },
);

const Host = z
  .string()
  .min(1)
  .regex(/^[a-z0-9.-]+$/, "A host name in lower case, without scheme or path (site.example)");

/** The audio tracks the API offers each episode in: `sub` (original audio) and `dub`. */
export const Track = z.enum(["sub", "dub"]);
export type Track = z.infer<typeof Track>;

/**
 * One site whose JSON API answers a whole season at once — its details, every episode and each
 * episode's players — under one address per season. The code knows the shape of the answer; where
 * the site is, and how it is reached, lives only here.
 */
export const SeasonApiSite = z.object({
  /** Stable: series remember the extractor they were added with by this id. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Lower-case letters, digits and dashes"),
  /** What the panel shows. */
  name: z.string().min(1).max(60),
  /** The hosts the site's pages are on (a host covers its subdomains). */
  hosts: z.array(Host).min(1),
  /** An address to show as an example in the panel. */
  example: z.url(),
  /** The path of a season's address; its first group is the season's id in the API. */
  seasonPath: Pattern.refine((source) => new RegExp(`${source}|`).exec("")!.length > 1, {
    message: "Needs a group that captures the season's id",
  }),
  /** Where the API answers, without a trailing slash (`https://site.example/api/v1`). */
  api: z.url().transform((url) => url.replace(/\/+$/, "")),
  /** Sent with every request instead of this server's own User-Agent. */
  userAgent: z.string().min(1).optional(),
  /**
   * The audio tracks to keep, best first: the first one an episode has is tried first, the next one
   * when its player fails. Absent: both, original audio first.
   */
  tracks: z.array(Track).min(1).optional(),
  limits: z
    .object({
      metadataPerSec: z.number().positive().max(100),
      downloadsPerHost: z.number().int().min(1).max(32),
    })
    .optional(),
});
export type SeasonApiSite = z.infer<typeof SeasonApiSite>;
