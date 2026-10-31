import type { ExtractorLimits } from "@orca/extractor-core";
import type { StreamPrefs } from "../application/ports.ts";
import * as z from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");
const count = (fallback: number) => z.coerce.number().int().min(1).max(32).default(fallback);

/** Required once the browser is on (generic detector, a sites or show API file); no default fits every site. */
const positive = z.coerce.number().int().min(1);
const DetectorEnv = z.object({
  HM_DETECTOR_MAX_CONCURRENT: positive.max(8),
  HM_DETECTOR_TIMEOUT_MS: positive,
  HM_DETECTOR_SETTLE_MS: z.coerce.number().int().min(0),
  HM_DETECTOR_USER_AGENT: z.string().min(1).optional(),
  HM_CHROMIUM_PATH: z.string().min(1).optional(),
  HM_CHROMIUM_NO_SANDBOX: bool.default(false),
});

/** `spa, eng` as ["spa", "eng"]; an empty string is an empty list. */
const languageList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== ""),
  )
  .pipe(
    z.array(z.string().regex(/^[a-z]{3}$/, "use ISO 639-2 codes such as eng, spa, jpn")).max(10),
  );

/** `player.example, other.example` as ["player.example", "other.example"]; an empty string is an empty list. */
const hostList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part !== ""),
  )
  .pipe(
    z
      .array(
        z.string().regex(/^[a-z0-9.-]+$/, "host names without scheme or path, such as player.example"),
      )
      .max(50),
  );

const Env = z.object({
  DEFAULT_MAX_HEIGHT: z.coerce.number().int().min(144).max(4320).optional(),
  DEFAULT_AUDIO_LANGS: languageList.optional(),
  DEFAULT_SUBTITLE_LANGS: languageList.optional(),
  SUBTITLES_EXTERNAL: bool.default(false),
  HM_GENERIC_DETECTOR: bool.default(false),
  /** A JSON file describing sites by their selectors; their players need the browser too. */
  HM_SITES_FILE: z.string().min(1).optional(),
  /** A JSON file describing sites whose JSON API lists a show; their players need the browser too. */
  HM_SHOW_API_FILE: z.string().min(1).optional(),
  DB_FILE: z.string().min(1),
  MEDIA_ROOT: z.string().min(1),
  JELLYFIN_URL: z.url(),
  JELLYFIN_API_KEY: z.string().min(1),
  JELLYFIN_MEDIA_ROOT: z.string().min(1),
  /** Lists a show's seasons and episodes when adding one; without it they are typed by hand. */
  TMDB_API_KEY: z.string().trim().min(1).optional(),
  PORT: z.coerce.number().int().min(1).max(65535),
  HOST: z.string().min(1),
  WEB_ROOT: z.string().min(1).optional(),
  DEVICE_ID: z.string().min(1).optional(),
  CONTACT_EMAIL: z.email().optional(),
  SECURE_COOKIES: bool.default(false),
  DOWNLOAD_CONCURRENCY: count(2),
  FFMPEG_CONCURRENCY: count(1),
  BROWSER_CONCURRENCY: count(1),
  /** One episode at a time, its players in the page's order; failing them all fails the episode. */
  SEQUENTIAL_DOWNLOADS: bool.default(false),
  /** Players never tried, by host (a host covers its subdomains): those no download can come from. */
  SKIP_PLAYERS: hostList.optional(),
  // Overrides of what each extractor declares for its hosts; absent means "use the declaration".
  DOWNLOADS_PER_HOST: z.coerce.number().int().min(1).max(32).optional(),
  METADATA_PER_SEC: z.coerce.number().positive().max(100).optional(),
  /** Connections one direct file is fetched over, for hosts whose extractor does not say. */
  DOWNLOAD_CONNECTIONS: z.coerce.number().int().min(1).max(16).default(1),
  /**
   * How long ffprobe may read a stream over the network before the player counts as failed. A copied
   * HLS stream is read from disk instead; this is for what cannot be copied, on slow players.
   */
  PROBE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(180_000),
});

export interface DetectorConfig {
  maxConcurrent: number;
  timeoutMs: number;
  settleMs: number;
  userAgent: string | undefined;
  chromiumPath: string | undefined;
  /** For Chromium in a container that cannot give it a user-namespace sandbox. */
  noSandbox: boolean;
}

export interface Config {
  /** What a series without its own track choices gets; empty means the best quality and every track. */
  streamDefaults: StreamPrefs;
  /** Write text subtitles as files beside the video instead of inside it. */
  externalSubtitles: boolean;
  /** Null while neither HM_GENERIC_DETECTOR nor HM_SITES_FILE asks for it: no browser. */
  detector: DetectorConfig | null;
  /** One episode at a time, its players in order (SEQUENTIAL_DOWNLOADS). */
  sequentialDownloads: boolean;
  /** Hosts of players never tried (SKIP_PLAYERS); empty when the environment names none. */
  skipPlayers: string[];
  /** Offer the "Generic page" extractor (HM_GENERIC_DETECTOR). */
  genericExtractor: boolean;
  /** Where the sites described by selectors are (HM_SITES_FILE). */
  sitesFile: string | undefined;
  /** Where the sites read through their JSON API are (HM_SHOW_API_FILE). */
  showApiFile: string | undefined;
  dbFile: string;
  mediaRoot: string;
  jellyfinUrl: string;
  jellyfinApiKey: string;
  /** The media root as Jellyfin sees it. */
  jellyfinMediaRoot: string;
  /** TMDB_API_KEY: a v3 key or a v4 read token; undefined turns the episode guide off. */
  tmdbApiKey: string | undefined;
  port: number;
  host: string;
  webRoot: string | undefined;
  /** Only set when the environment overrides the id generated and stored in the database. */
  deviceId: string | undefined;
  /** Put in the User-Agent so a site's operators know who to write to. */
  contactEmail: string | undefined;
  secureCookies: boolean;
  concurrency: { download: number; ffmpeg: number; browser: number; none: number };
  /** Overrides of the per-host limits the extractors declare; empty when the environment says nothing. */
  hostLimits: Partial<ExtractorLimits>;
  /** Connections one direct file is fetched over when its host's extractor does not say. */
  downloadConnections: number;
  /** How long ffprobe may read a stream over the network. */
  probeTimeoutMs: number;
}

export class ConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

/** Reads and validates the environment once, at boot, so a typo fails loudly and early. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = Env.safeParse(env);
  const detectorOn =
    parsed.success &&
    (parsed.data.HM_GENERIC_DETECTOR ||
      parsed.data.HM_SITES_FILE !== undefined ||
      parsed.data.HM_SHOW_API_FILE !== undefined);
  const detectorParsed = detectorOn ? DetectorEnv.safeParse(env) : null;
  const issues = [
    ...(parsed.success ? [] : parsed.error.issues),
    ...(detectorParsed && !detectorParsed.success ? detectorParsed.error.issues : []),
  ];
  if (!parsed.success || (detectorParsed && !detectorParsed.success)) {
    const lines = issues.map((issue) => `  ${issue.path.join(".") || "(env)"}: ${issue.message}`);
    throw new ConfigError(
      `Invalid configuration (set these in the environment or in a profile picked with HM_PROFILE, see profiles/.env.example):\n${lines.join("\n")}`,
      { cause: parsed.success ? (detectorParsed as { error: unknown }).error : parsed.error },
    );
  }
  const e = parsed.data;
  const d = detectorParsed?.success ? detectorParsed.data : null;
  return {
    streamDefaults: {
      ...(e.DEFAULT_MAX_HEIGHT !== undefined ? { maxHeight: e.DEFAULT_MAX_HEIGHT } : {}),
      ...(e.DEFAULT_AUDIO_LANGS !== undefined ? { audioLangs: e.DEFAULT_AUDIO_LANGS } : {}),
      ...(e.DEFAULT_SUBTITLE_LANGS !== undefined
        ? { subtitleLangs: e.DEFAULT_SUBTITLE_LANGS }
        : {}),
    },
    externalSubtitles: e.SUBTITLES_EXTERNAL,
    detector: d
      ? {
          maxConcurrent: d.HM_DETECTOR_MAX_CONCURRENT,
          timeoutMs: d.HM_DETECTOR_TIMEOUT_MS,
          settleMs: d.HM_DETECTOR_SETTLE_MS,
          userAgent: d.HM_DETECTOR_USER_AGENT,
          chromiumPath: d.HM_CHROMIUM_PATH,
          noSandbox: d.HM_CHROMIUM_NO_SANDBOX,
        }
      : null,
    genericExtractor: e.HM_GENERIC_DETECTOR,
    sitesFile: e.HM_SITES_FILE,
    showApiFile: e.HM_SHOW_API_FILE,
    dbFile: e.DB_FILE,
    mediaRoot: e.MEDIA_ROOT,
    jellyfinUrl: e.JELLYFIN_URL.replace(/\/+$/, ""),
    jellyfinApiKey: e.JELLYFIN_API_KEY,
    jellyfinMediaRoot: e.JELLYFIN_MEDIA_ROOT,
    tmdbApiKey: e.TMDB_API_KEY,
    port: e.PORT,
    host: e.HOST,
    webRoot: e.WEB_ROOT,
    deviceId: e.DEVICE_ID,
    contactEmail: e.CONTACT_EMAIL,
    secureCookies: e.SECURE_COOKIES,
    sequentialDownloads: e.SEQUENTIAL_DOWNLOADS,
    skipPlayers: e.SKIP_PLAYERS ?? [],
    concurrency: {
      download: e.DOWNLOAD_CONCURRENCY,
      ffmpeg: e.FFMPEG_CONCURRENCY,
      browser: e.BROWSER_CONCURRENCY,
      none: 4,
    },
    hostLimits: {
      ...(e.DOWNLOADS_PER_HOST !== undefined ? { downloadsPerHost: e.DOWNLOADS_PER_HOST } : {}),
      ...(e.METADATA_PER_SEC !== undefined ? { metadataPerSec: e.METADATA_PER_SEC } : {}),
    },
    downloadConnections: e.DOWNLOAD_CONNECTIONS,
    probeTimeoutMs: e.PROBE_TIMEOUT_MS,
  };
}

/** What this server calls itself when it fetches from other sites. */
export function userAgent(version: string, contactEmail: string | undefined): string {
  return contactEmail ? `OrcaHM/${version} (+contact: ${contactEmail})` : `OrcaHM/${version}`;
}

/** Variables that used to do something and now are ignored, so a deployment is told rather than surprised. */
export function deprecatedEnvWarnings(env: Record<string, string | undefined>): string[] {
  const warnings: string[] = [];
  if (env["IA_HOST_CONCURRENCY"] !== undefined) {
    warnings.push(
      "IA_HOST_CONCURRENCY is ignored now: each extractor declares its own limits, and DOWNLOADS_PER_HOST / METADATA_PER_SEC override them.",
    );
  }
  return warnings;
}
