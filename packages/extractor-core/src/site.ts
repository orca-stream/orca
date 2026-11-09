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
});
export type SiteBase = z.infer<typeof SiteBase>;
