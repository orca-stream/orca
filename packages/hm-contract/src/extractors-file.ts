import { SiteConfig } from "@orca/extractor-html/site";
import { ShowApiSite } from "@orca/extractor-show-api/site";
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

/**
 * The extractors file. It names the sites, so it lives with whoever runs the server and never in
 * the repository; the server checks it when it is saved and the panel when it is picked.
 */
export const ExtractorsFile = z.record(Id, Entry);
export type ExtractorsFile = z.infer<typeof ExtractorsFile>;

/** Why a file is not an extractors file: its JSON, or each problem by where it is. */
export type ExtractorsFileProblem =
  | { kind: "json"; message: string }
  | { kind: "schema"; issues: { path: string; message: string }[] };

/** Reads an extractors file's text, or says what is wrong with it. */
export function checkExtractorsFile(
  json: string,
): { ok: true; file: ExtractorsFile } | { ok: false; problem: ExtractorsFileProblem } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return { ok: false, problem: { kind: "json", message: (error as Error).message } };
  }
  const parsed = ExtractorsFile.safeParse(raw);
  if (parsed.success) return { ok: true, file: parsed.data };
  return {
    ok: false,
    problem: {
      kind: "schema",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(file)",
        message: issue.message,
      })),
    },
  };
}
