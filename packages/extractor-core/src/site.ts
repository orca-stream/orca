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
 * `{images.poster}`). A slot may name several fields, `|` between them, and takes the first that has
 * something (`{title.english|title.romaji}`); one of them may be a word in quotes, written as it is
 * (`{title|'show'}`). `:slug` at the end of a slot writes it as an address does (lower case, accents
 * off, a dash for anything else; `:slug(60)`, cut to that length). A slot that has nothing leaves
 * the whole text out.
 */
export const Template = z.string().min(1);

/**
 * How a site is searched through its JSON API: where to ask, where the answer lists what it found,
 * and how each item becomes a result. `{query}` in `url` is what was typed.
 */
export const JsonSearch = z
  .object({
    reads: z.literal("json"),
    /**
     * With `{page}` too, the answer comes in pages: they are read in order, from 1. Needs `{query}`
     * where the search goes, here or in `body`.
     */
    url: z.url(),
    /**
     * Sent as JSON, by POST, when the site is asked that way (a GraphQL query and its variables). A
     * text that is just `{query}` or `{page}` becomes what was typed or the page's number; `{query}`
     * inside a longer text is replaced too. Absent: the search is a GET of `url`.
     */
    body: z.record(z.string(), z.json()).optional(),
    /** Where the answer lists the items (`data.posts`). Absent: the answer is the list. */
    items: z.string().min(1).optional(),
    /**
     * Where a paged answer says the number of its last page (`data.pagination.last_page`). Absent:
     * pages are read until one comes empty.
     */
    lastPage: z.string().min(1).optional(),
    /**
     * Where a paged answer says whether another page follows (`data.Page.pageInfo.hasNextPage`): the
     * next one is read only when it is `true`.
     */
    nextPage: z.string().min(1).optional(),
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
    /**
     * The hosts the results' posters may come from besides the site's own (an images server of the
     * search's): no other host is ever fetched.
     */
    posterHosts: z.array(Host).min(1).optional(),
  })
  .refine(
    (search) =>
      search.url.includes("{query}") || JSON.stringify(search.body ?? {}).includes("{query}"),
    { message: "Needs {query} where the search goes, in url or body", path: ["url"] },
  );
export type JsonSearch = z.infer<typeof JsonSearch>;

/** Something read inside one result of a search page: what `selector` finds, then its `attribute` or its text. */
const ItemPick = z.object({
  selector: z.string().min(1),
  /** Absent: the element's text. */
  attribute: z.string().min(1).optional(),
});

/**
 * How a site is searched through its own search page, the results written in its HTML. `{query}` in
 * `url` is what was typed. Every result is a series; one the extractor would not read (a movie's
 * page) is left out.
 */
export const HtmlSearch = z.object({
  reads: z.literal("html"),
  /**
   * The search page, `{query}` where the name goes and, when the site answers in pages, `{page}`
   * where its number goes: pages are then read one after another until one comes short.
   */
  url: z.url().refine((url) => url.includes("{query}"), {
    message: "Needs {query} where the search goes",
  }),
  /** Each result on the page (`div.movie-item`); the picks below look inside it. */
  items: z.string().min(1),
  /**
   * What each result is, when the page says it: the words (as written there) of what is a series.
   * A result whose word is none of them is left out. Absent: every result is a series.
   */
  type: ItemPick.extend({ series: z.array(z.string().min(1)).min(1) }).optional(),
  result: z.object({
    /** Relative addresses are on the site's origin. */
    url: ItemPick.extend({ attribute: z.string().min(1).default("href") }),
    title: ItemPick,
    originalTitle: ItemPick.optional(),
    /** The first four digits in a row are the year. */
    year: ItemPick.optional(),
    plot: ItemPick.optional(),
    /** An absolute address, or one on the site's origin. */
    poster: ItemPick.optional(),
  }),
  /** As in a JSON search: other hosts the posters may come from. */
  posterHosts: z.array(Host).min(1).optional(),
});
export type HtmlSearch = z.infer<typeof HtmlSearch>;

/** How a site is searched by name; one kind per way its search answers. */
export const SiteSearch = z.discriminatedUnion("reads", [JsonSearch, HtmlSearch]);
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
