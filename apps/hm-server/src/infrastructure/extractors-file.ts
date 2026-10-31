import { SiteConfig } from "@orca/extractor-html";
import { ShowApiSite } from "@orca/extractor-show-api";
import * as z from "zod";

/** Stable: series remember the extractor they were added with by this id, the entry's key. */
const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Lower-case letters, digits and dashes");

/**
 * One entry per site, under the name its owner gives it, saying how the site is read: `page` reads
 * its pages with selectors, `api` asks its JSON API. What follows is that reader's description of it.
 */
const Entry = z.discriminatedUnion("reads", [
  SiteConfig.omit({ id: true, name: true }).extend({
    reads: z.literal("page"),
    /** What the panel shows. Absent: the entry's name. */
    name: z.string().min(1).max(60).optional(),
  }),
  ShowApiSite.omit({ id: true, name: true }).extend({
    reads: z.literal("api"),
    name: z.string().min(1).max(60).optional(),
  }),
]);

const ExtractorsFile = z.record(Id, Entry);

export interface Extractors {
  /** Sites read through their pages (`reads: "page"`). */
  pages: SiteConfig[];
  /** Sites read through their JSON API (`reads: "api"`). */
  apis: ShowApiSite[];
}

export class ExtractorsFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtractorsFileError";
  }
}

/**
 * Validates the JSON of an extractors file, with every problem listed by where it is. The file names
 * the sites, so it lives with whoever runs the server and never in the repository.
 */
export function parseExtractorsFile(json: string): Extractors {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw new ExtractorsFileError(
      `The extractors file is not valid JSON: ${(error as Error).message}`,
      { cause: error },
    );
  }
  const parsed = ExtractorsFile.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  ${issue.path.join(".") || "(file)"}: ${issue.message}`,
    );
    throw new ExtractorsFileError(`The extractors file is not valid:\n${lines.join("\n")}`, {
      cause: parsed.error,
    });
  }
  const extractors: Extractors = { pages: [], apis: [] };
  for (const [id, entry] of Object.entries(parsed.data)) {
    if (entry.reads === "page") {
      const { reads: _, name, ...site } = entry;
      extractors.pages.push({ ...site, id, name: name ?? id });
    } else {
      const { reads: _, name, ...site } = entry;
      extractors.apis.push({ ...site, id, name: name ?? id });
    }
  }
  return extractors;
}
