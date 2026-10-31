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

/**
 * One site whose JSON API answers the show, its seasons, their episodes and each episode's players.
 * The code knows the shape of the answers; where the site is, and how it is reached, lives only here.
 */
export const ShowApiSite = z.object({
  /** Stable: series remember the extractor they were added with by this id. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Lower-case letters, digits and dashes"),
  /** What the panel shows. */
  name: z.string().min(1).max(60),
  /** The hosts the site's pages are on (a host covers its subdomains). */
  hosts: z.array(Host).min(1),
  /** An address to show as an example in the panel. */
  example: z.url(),
  /** The path of a show's address; its first group is the show's slug. */
  showPath: Pattern.refine((source) => new RegExp(`${source}|`).exec("")!.length > 1, {
    message: "Needs a group that captures the show's slug",
  }),
  /** Where the API answers, without a trailing slash (`https://site.example/api/v1`). */
  api: z.url().transform((url) => url.replace(/\/+$/, "")),
  /** Sent with every request instead of this server's own User-Agent. */
  userAgent: z.string().min(1).optional(),
  /**
   * The audio languages to keep, as the site names them (`Latino`), best first. A dual audio player
   * (`Latino - Inglés`) counts as any of its tracks. Absent: every player, in the site's order.
   */
  languages: z.array(z.string().min(1)).min(1).optional(),
  limits: z
    .object({
      metadataPerSec: z.number().positive().max(100),
      downloadsPerHost: z.number().int().min(1).max(32),
    })
    .optional(),
});
export type ShowApiSite = z.infer<typeof ShowApiSite>;

export const ShowApiFile = z
  .object({ sites: z.array(ShowApiSite) })
  .refine((file) => new Set(file.sites.map((site) => site.id)).size === file.sites.length, {
    message: "Two sites have the same id",
  });
export type ShowApiFile = z.infer<typeof ShowApiFile>;

export class ShowApiFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ShowApiFileError";
  }
}

/** Validates the JSON of a show-API sites file, with every problem listed by where it is. */
export function parseShowApiFile(json: string): ShowApiFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new ShowApiFileError(`The show API file is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const parsed = ShowApiFile.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(file)"}: ${issue.message}`,
    );
    throw new ShowApiFileError(`The show API file is not valid:\n${lines.join("\n")}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}
