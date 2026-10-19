import { ExtractorError } from "@orca/extractor-core";

const HOSTS = new Set(["archive.org", "www.archive.org"]);
const ID = /^[A-Za-z0-9._-]+$/;

export interface IaTarget {
  /** The item or collection identifier. */
  id: string;
  /** The file the URL pointed at, when it named one. */
  file?: string;
}

function parse(input: string): URL | null {
  try {
    return new URL(input.trim());
  } catch {
    return null;
  }
}

/** Pure: true for archive.org hosts (not the Wayback Machine), whatever the path. */
export function canHandleUrl(input: string): boolean {
  const url = parse(input);
  return url !== null && /^https?:$/.test(url.protocol) && HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Reads the item and, when present, the file out of a details, download or embed URL. The query
 * string and the hash are dropped. Anything else on archive.org (search, user pages, the Wayback
 * Machine) is rejected with a message the panel can show.
 */
export function parseIaUrl(input: string): IaTarget {
  const url = parse(input);
  if (!url || !canHandleUrl(input)) {
    throw new ExtractorError("unsupported-url", `Not an archive.org address: ${input.trim()}`);
  }

  const [kind, rawId, ...rest] = url.pathname.split("/").filter((segment) => segment !== "");
  if (kind !== "details" && kind !== "download" && kind !== "embed") {
    throw new ExtractorError(
      "unsupported-url",
      "Paste the address of an item or collection (archive.org/details/…), not a search or a page.",
    );
  }

  const id = rawId === undefined ? "" : decodeURIComponent(rawId);
  if (!ID.test(id)) {
    throw new ExtractorError(
      "unsupported-url",
      `Not an item or collection address: ${input.trim()}`,
    );
  }

  const file = rest.map((segment) => decodeURIComponent(segment)).join("/");
  return file === "" ? { id } : { id, file };
}
