import { readFileSync } from "node:fs";
import { ExtractorError, type Extraction, type SiteExtractor } from "@orca/extractor-core";

const SHOW = "bevhill-s01e01-36";
const ORIGIN = "https://archive.org";
const SHOW_URL = `${ORIGIN}/details/${SHOW}`;

/** One show as a real extractor once read it, kept as data so the tests need no site's code. */
const recorded = JSON.parse(
  readFileSync(new URL("../fixtures/bevhill.extraction.json", import.meta.url), "utf8"),
) as Extraction;

function find(url: string): Extraction {
  const path = new URL(url).pathname;
  if (!path.startsWith("/details/")) {
    throw new ExtractorError("unsupported-url", "Paste the address of a show, not a search.");
  }
  if (url !== SHOW_URL) throw new ExtractorError("not-found", `Nothing recorded under ${url}`);
  return structuredClone(recorded);
}

/** A site that answers only the one show it recorded, with what it read then. */
export function createRecordedExtractor(): SiteExtractor {
  return {
    id: "internet-archive",
    name: "Internet Archive",
    hosts: ["archive.org"],
    example: SHOW_URL,
    limits: { metadataPerSec: 1, downloadsPerHost: 1, connectionsPerDownload: 1 },
    canHandle: (url) => {
      try {
        const host = new URL(url).hostname;
        return host === "archive.org" || host.endsWith(".archive.org");
      } catch {
        return false;
      }
    },
    extract: async (url) => find(url),
    remoteMarker: async (url) => find(url).series.remoteMarker ?? "",
  };
}
