/** How the file will be handed to the downloader. Same shape hm-server's `DetectedStream.kind`. */
export type StreamKind = "hls" | "dash" | "direct";

/** What an HLS playlist turned out to be once its body was read. */
export type PlaylistRole = "master" | "variant" | "unknown";

export interface Candidate {
  url: string;
  kind: StreamKind;
  playlist: PlaylistRole;
  headers: Record<string, string>;
}

export interface RequestInfo {
  url: string;
  /** Playwright's `request.resourceType()`: "media", "xhr", "fetch", "document"… */
  resourceType?: string;
  /** The response `Content-Type`, when the response is already known. */
  contentType?: string;
}

const EXTENSION_KIND: Readonly<Record<string, StreamKind>> = {
  m3u8: "hls",
  mpd: "dash",
  mp4: "direct",
};

/** Pieces of a stream, never the stream itself. */
const SEGMENT_EXTENSIONS: ReadonlySet<string> = new Set(["ts", "m4s", "cmfv", "cmfa", "aac"]);

/** Resource types whose response `Content-Type` is trusted to identify a stream. */
const CONTENT_TYPE_RESOURCES: ReadonlySet<string> = new Set(["media", "xhr", "fetch", "other"]);

const CONTENT_TYPE_KIND: ReadonlyArray<readonly [RegExp, StreamKind]> = [
  [/^application\/(vnd\.apple\.mpegurl|x-mpegurl)$/i, "hls"],
  [/^application\/dash\+xml$/i, "dash"],
  [/^video\/mp4$/i, "direct"],
];

const MASTER_TAG = "#EXT-X-STREAM-INF";
const MEDIA_TAG = "#EXTINF";

function extensionOf(url: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const dot = pathname.lastIndexOf(".");
  if (dot === -1 || dot < pathname.lastIndexOf("/")) return null;
  return pathname.slice(dot + 1).toLowerCase();
}

/** Decides whether a request is a stream worth downloading, and of which kind. Pure. */
export function classifyRequest(request: RequestInfo): StreamKind | null {
  const extension = extensionOf(request.url);
  if (extension === null && !URL.canParse(request.url)) return null;
  if (extension !== null && SEGMENT_EXTENSIONS.has(extension)) return null;
  if (extension !== null && extension in EXTENSION_KIND) return EXTENSION_KIND[extension]!;

  if (
    request.contentType !== undefined &&
    request.resourceType !== undefined &&
    CONTENT_TYPE_RESOURCES.has(request.resourceType)
  ) {
    const mime = request.contentType.split(";")[0]!.trim();
    for (const [pattern, kind] of CONTENT_TYPE_KIND) if (pattern.test(mime)) return kind;
  }
  return null;
}

/** A master playlist lists renditions; a media playlist lists segments. */
export function classifyPlaylistBody(body: string): PlaylistRole {
  if (body.includes(MASTER_TAG)) return "master";
  if (body.includes(MEDIA_TAG)) return "variant";
  return "unknown";
}

function rank(candidate: Candidate): number {
  if (candidate.kind === "dash") return 0;
  if (candidate.kind === "hls" && candidate.playlist === "master") return 0;
  if (candidate.kind === "direct") return 1;
  if (candidate.kind === "hls" && candidate.playlist === "variant") return 3;
  return 2;
}

/** Best first: a master playlist or MPD, a direct file, a bare playlist, a single variant. Stable. */
export function pickBest(candidates: readonly Candidate[]): Candidate[] {
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => rank(a.candidate) - rank(b.candidate) || a.index - b.index)
    .map(({ candidate }) => candidate);
}

/** A video ad's description (VAST) or its schedule (VMAP); either names the ad's files. */
const AD_DOCUMENT = /<(?:[\w-]+:)?(?:VAST|VMAP)[\s>]/;
const MEDIA_FILE =
  /<MediaFile\b[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/MediaFile>/g;

/**
 * The video files a VAST or VMAP document plays as ads: players fetch one before the episode and
 * then the ad itself, which would otherwise look like the stream. Empty for anything else. Pure.
 */
export function adMediaUrls(body: string): string[] {
  if (!AD_DOCUMENT.test(body)) return [];
  return [...body.matchAll(MEDIA_FILE)].map((match) =>
    (match[1] as string).replaceAll("&amp;", "&").trim(),
  );
}

/** Responses worth reading for ads: an XML document, by its type or its name. Pure. */
export function mayDescribeAds(url: string, contentType: string | undefined): boolean {
  if (contentType !== undefined && /\bxml\b/i.test(contentType)) {
    return !/dash\+xml/i.test(contentType);
  }
  return extensionOf(url) === "xml";
}
