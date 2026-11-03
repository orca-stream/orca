import * as z from "zod";

/** Something read from a page: the element(s) `selector` finds, then their `attribute` or their text. */
const Pick = z.object({
  selector: z.string().min(1),
  /** Absent: the element's text. */
  attribute: z.string().min(1).optional(),
});
export type Pick = z.infer<typeof Pick>;

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

/**
 * One site, described rather than programmed: where its pages list the episodes and where an episode
 * page lists its players. Nothing about a site lives in the code; this file is the site.
 */
export const SiteConfig = z.object({
  /** Stable: series remember the extractor they were added with by this id. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Lower-case letters, digits and dashes"),
  /** What the panel shows. */
  name: z.string().min(1).max(60),
  /** The hosts the site's pages are on (a host covers its subdomains). */
  hosts: z.array(Host).min(1),
  /** An address to show as an example in the panel. */
  example: z.url(),
  /** The path of an address this site can read (one season, or a part of one). Absent: any path. */
  seasonPath: Pattern.optional(),
  /** Sent with every page request instead of this server's own User-Agent. */
  userAgent: z.string().min(1).optional(),
  limits: z
    .object({
      metadataPerSec: z.number().positive().max(100),
      downloadsPerHost: z.number().int().min(1).max(32),
    })
    .optional(),
  /** The show's name on the season page, to start the form with. Absent: taken from the address. */
  title: Pick.optional(),
  listing: z.object({
    /**
     * When the season's episodes are spread over several pages: what lists them on the season page,
     * and the address of each, `{url}` being the season's address and `{value}` what `pages` read.
     * Absent: the season page lists every episode itself.
     */
    pages: Pick.extend({ path: z.string().includes("{value}") }).optional(),
    /** The link of each episode, on the season page or on each of its pages. */
    episodes: Pick.extend({
      attribute: z.string().min(1).default("href"),
      /** The episode's title, looked for inside the link's element. Absent: `Episode N`. */
      title: Pick.optional(),
    }),
    /** Finds the episode number in its address; the first group is the number. Absent: its last number. */
    number: Pattern.optional(),
  }),
  /**
   * When the site groups a show's seasons on a page of their own: how to reach it from a season and
   * read the seasons it lists. Lets a pasted show address stand for its first season, lets a followed
   * series find the seasons none of its sources reads yet, and suggests the next season to add.
   * Absent: every season is a page on its own, and nothing about the others is known.
   */
  seasons: z
    .object({
      /** The path of a show's address. Pasted, it reads the first season the show lists. */
      showPath: Pattern,
      /**
       * The show's address from a season's: `from` matches the season's path and `to` is the show's,
       * `{1}`, `{2}`… being its groups.
       */
      show: z.object({ from: Pattern, to: z.string().min(1) }),
      /** The link of each season, on the show page. */
      links: Pick.extend({ attribute: z.string().min(1).default("href") }),
      /** Finds the season number in its address; the first group is the number. Absent: its last number. */
      number: Pattern.optional(),
    })
    .optional(),
  /** On an episode page: each player's address. */
  mirrors: Pick.extend({
    attribute: z.string().min(1),
    /** How the attribute is written when it is not the address itself. */
    decode: z.enum(["base64"]).optional(),
    /**
     * A query parameter that carries the player inside a wrapper's address (`?url=`): when present,
     * the address it holds is the player. Absent: every address is taken as it is.
     */
    unwrap: z.string().min(1).optional(),
  }),
});
export type SiteConfig = z.infer<typeof SiteConfig>;
