import * as z from "zod";

/** A regular expression written as a string in the file; refused at load time when it won't compile. */
export const Pattern = z.string().refine(
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

/** A pattern whose first group captures something the reader needs (`what`: "the show's slug"). */
export const CapturingPattern = (what: string) =>
  Pattern.refine((source) => new RegExp(`${source}|`).exec("")!.length > 1, {
    message: `Needs a group that captures ${what}`,
  });

export const Host = z
  .string()
  .min(1)
  .regex(/^[a-z0-9.-]+$/, "A host name in lower case, without scheme or path (site.example)");

/** Stable: series remember the extractor they were added with by this id. */
export const ExtractorId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Lower-case letters, digits and dashes");

/**
 * A text with `{path.to.field}` slots, filled in from one item of an answer (`/series/{slug}`,
 * `{images.poster}`). A slot whose field is missing or empty leaves the whole text out.
 */
export const Template = z.string().min(1);

/**
 * How a site is searched through its JSON API: where to ask, where the answer lists what it found,
 * and how each item becomes a result. `{query}` in `url` is what was typed.
 */
export const JsonSearch = z.object({
  reads: z.literal("json"),
  url: z.url().includes("{query}", { message: "Needs {query} where the search goes" }),
  /** Where the answer lists the items (`data.posts`). Absent: the answer is the list. */
  items: z.string().min(1).optional(),
  /**
   * What each item is: `from` reads the site's word for it, and the lists say which words are a
   * series and which a movie. An item whose word is in neither is left out. Absent: every item is a
   * series.
   */
  type: z
    .object({
      from: Template,
      series: z.array(z.string().min(1)).min(1),
      movie: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  result: z.object({
    /**
     * The address of each item, by what it is; relative ones are on the site's origin. A kind with
     * no address here is left out.
     */
    url: z.object({ series: Template, movie: Template.optional() }),
    title: Template,
    originalTitle: Template.optional(),
    /** The first four digits in a row are the year (`{release_date}` works as it is). */
    year: Template.optional(),
    plot: Template.optional(),
    /** An absolute address, or one on the site's origin. */
    poster: Template.optional(),
  }),
});
export type JsonSearch = z.infer<typeof JsonSearch>;

/** How a site is searched by name; one kind per way its search answers. */
export const SiteSearch = z.discriminatedUnion("reads", [JsonSearch]);
export type SiteSearch = z.infer<typeof SiteSearch>;

/** What every site has, however it is read. Each reader extends it with its own description. */
export const SiteBase = z.object({
  id: ExtractorId,
  /** What the panel shows. */
  name: z.string().min(1).max(60),
  /** The hosts the site's pages are on (a host covers its subdomains). */
  hosts: z.array(Host).min(1),
  /** An address to show as an example in the panel. */
  example: z.url(),
  /** Sent with every request instead of this server's own User-Agent. */
  userAgent: z.string().min(1).optional(),
  limits: z
    .object({
      metadataPerSec: z.number().positive().max(100),
      downloadsPerHost: z.number().int().min(1).max(32),
    })
    .optional(),
  /** How to find a show by its name on the site. Absent: addresses are pasted. */
  search: SiteSearch.optional(),
});
export type SiteBase = z.infer<typeof SiteBase>;
