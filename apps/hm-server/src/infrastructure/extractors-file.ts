import type { SiteConfig } from "@orca/extractor-html";
import type { ShowApiSite } from "@orca/extractor-show-api";
import { checkExtractorsFile } from "@orca/hm-contract/extractors-file";

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
  const checked = checkExtractorsFile(json);
  if (!checked.ok) {
    const { problem } = checked;
    if (problem.kind === "json") {
      throw new ExtractorsFileError(`The extractors file is not valid JSON: ${problem.message}`);
    }
    const lines = problem.issues.map((issue) => `  ${issue.path}: ${issue.message}`);
    throw new ExtractorsFileError(`The extractors file is not valid:\n${lines.join("\n")}`);
  }
  const extractors: Extractors = { pages: [], apis: [] };
  for (const [id, entry] of Object.entries(checked.file)) {
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
