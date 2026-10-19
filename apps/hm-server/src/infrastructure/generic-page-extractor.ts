import {
  ExtractorError,
  type Extraction,
  type ExtractionWarning,
  type SiteExtractor,
} from "@orca/extractor-core";

/** Placeholder: the real name comes from the stream the browser finds. */
const PLACEHOLDER_FILE_NAME = "video";

function parseWebUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ExtractorError("unsupported-url", `Not a web address: ${input.trim()}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ExtractorError("unsupported-url", "Only http and https addresses can be opened");
  }
  return url;
}

/** A readable name from the last piece of the path, or the host when the path says nothing. */
function titleOf(url: URL): string {
  const last =
    url.pathname
      .split("/")
      .filter((part) => part !== "")
      .at(-1) ?? "";
  const name = decodeURIComponent(last)
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_.+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name === "" ? url.host : name;
}

/**
 * Any web page that plays a video: one page is one series with one episode, and the stream is found
 * with a browser when it is downloaded. It never claims an address by itself, so it only runs when
 * the user picks it, and the license confirmation is always required. Off unless the server enables
 * the generic detector.
 */
export class GenericPageExtractor implements SiteExtractor {
  readonly id = "generic";
  readonly name = "Generic page (browser)";
  readonly hosts: string[] = [];
  readonly example = "https://example.com/watch/my-video";
  readonly explicitOnly = true;

  canHandle(_url: string): boolean {
    return false;
  }

  async extract(input: string): Promise<Extraction> {
    const url = parseWebUrl(input);
    const address = url.href;
    const warnings: ExtractionWarning[] = [
      {
        code: "license-unknown",
        message:
          "The license of an arbitrary page is not known: confirm you have the right to download this",
      },
      {
        code: "year-missing",
        message: "No year for a generic page: fill it in before adding, it names the folder",
      },
    ];
    return {
      series: { externalId: address, sourceUrl: address, title: titleOf(url) },
      seasons: [{ number: 1, episodeCount: 1 }],
      episodes: [
        {
          season: 1,
          episode: 1,
          title: titleOf(url),
          inferred: false,
          sourceRef: address,
          media: { kind: "page", url: address, fileName: PLACEHOLDER_FILE_NAME },
        },
      ],
      license: { kind: "unknown", requiresAck: true },
      warnings,
    };
  }
}
