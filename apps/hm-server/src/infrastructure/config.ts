import type { ExtractorLimits } from "@orca/extractor-core";
import { Settings } from "@orca/hm-contract";
import type { StreamPrefs } from "../application/ports.ts";
import * as z from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");
const count = (fallback: number) => z.coerce.number().int().min(1).max(32).default(fallback);

/** Required once the browser is on (generic detector or an extractors file); no default fits every site. */
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

/** What the server needs before it can open its database: the only part left in the environment. */
const BootEnv = z.object({
  DB_FILE: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535),
  HOST: z.string().min(1),
  /** Where the built panel is, when this server serves it. */
  WEB_ROOT: z.string().min(1).optional(),
  /** `Secure` on the session cookie: only behind HTTPS. */
  SECURE_COOKIES: bool.default(false),
  /** Overrides the device id generated once and kept in the database. */
  DEVICE_ID: z.string().min(1).optional(),
});

/**
 * Everything else, as it was read from the environment before it moved to the database. Only read
 * once, to carry an existing setup over (see `settingsFromEnv`).
 */
const LegacyEnv = z.object({
  DEFAULT_MAX_HEIGHT: z.coerce.number().int().min(144).max(4320).optional(),
  DEFAULT_AUDIO_LANGS: languageList.optional(),
  DEFAULT_SUBTITLE_LANGS: languageList.optional(),
  SUBTITLES_EXTERNAL: bool.default(false),
  HM_GENERIC_DETECTOR: bool.default(false),
  /** A JSON file describing the sites H&M reads; their players need the browser too. */
  HM_EXTRACTORS_FILE: z.string().min(1).optional(),
  MEDIA_ROOT: z.string().min(1),
  JELLYFIN_URL: z.url(),
  JELLYFIN_API_KEY: z.string().min(1),
  JELLYFIN_MEDIA_ROOT: z.string().min(1),
  /** Lists a show's seasons and episodes when adding one; without it they are typed by hand. */
  TMDB_API_KEY: z.string().trim().min(1).optional(),
  CONTACT_EMAIL: z.email().optional(),
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

/** Where the server listens and keeps its database: read from the environment, before anything else. */
export interface BootConfig {
  dbFile: string;
  port: number;
  host: string;
  webRoot: string | undefined;
  /** Only set when the environment overrides the id generated and stored in the database. */
  deviceId: string | undefined;
  secureCookies: boolean;
}

/** What the server runs with, made from the settings in its database (see `configFrom`). */
export interface Config {
  /** What a series without its own track choices gets; empty means the best quality and every track. */
  streamDefaults: StreamPrefs;
  /** Write text subtitles as files beside the video instead of inside it. */
  externalSubtitles: boolean;
  /** Null while neither the generic detector nor a site of the extractors asks for it: no browser. */
  detector: DetectorConfig | null;
  /** One episode at a time, its players in order. */
  sequentialDownloads: boolean;
  /** Hosts of players never tried. */
  skipPlayers: string[];
  /** Offer the "Generic page" extractor. */
  genericExtractor: boolean;
  mediaRoot: string;
  jellyfinUrl: string;
  jellyfinApiKey: string;
  /** The media root as Jellyfin sees it. */
  jellyfinMediaRoot: string;
  /** A v3 key or a v4 read token; undefined turns the episode guide off. */
  tmdbApiKey: string | undefined;
  /** Put in the User-Agent so a site's operators know who to write to. */
  contactEmail: string | undefined;
  concurrency: { download: number; ffmpeg: number; browser: number; none: number };
  /** Overrides of the per-host limits the extractors declare; empty when the settings say nothing. */
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

function issuesOf(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "(env)"}: ${issue.message}`)
    .join("\n");
}

/** Reads where to listen and where the database is, once, at boot, so a typo fails loudly and early. */
export function loadBootConfig(env: Record<string, string | undefined>): BootConfig {
  const parsed = BootEnv.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      `Invalid configuration (set these in the environment, or run \`pnpm setup:hm\` to write a profile):\n${issuesOf(parsed.error)}`,
      { cause: parsed.error },
    );
  }
  const e = parsed.data;
  return {
    dbFile: e.DB_FILE,
    port: e.PORT,
    host: e.HOST,
    webRoot: e.WEB_ROOT,
    deviceId: e.DEVICE_ID,
    secureCookies: e.SECURE_COOKIES,
  };
}

/** The settings an environment of the old kind described, and the extractors file it named. */
export interface LegacySetup {
  settings: Settings;
  extractorsFile: string | undefined;
}

/**
 * Carries a setup made in the environment over to the database: null when the environment holds none
 * (no JELLYFIN_URL). Read only while the database has no settings yet; after that the panel rules.
 */
export function settingsFromEnv(env: Record<string, string | undefined>): LegacySetup | null {
  if (env["JELLYFIN_URL"] === undefined) return null;
  const parsed = LegacyEnv.safeParse(env);
  const detectorOn =
    parsed.success &&
    (parsed.data.HM_GENERIC_DETECTOR || parsed.data.HM_EXTRACTORS_FILE !== undefined);
  const detectorParsed = detectorOn ? DetectorEnv.safeParse(env) : null;
  if (!parsed.success || (detectorParsed && !detectorParsed.success)) {
    const issues = [
      ...(parsed.success ? [] : parsed.error.issues),
      ...(detectorParsed && !detectorParsed.success ? detectorParsed.error.issues : []),
    ];
    throw new ConfigError(
      `The environment holds a setup this server cannot carry over (fix it, or remove it and set the server up from the panel):\n${issuesOf(new z.ZodError(issues))}`,
      { cause: parsed.success ? (detectorParsed as { error: unknown }).error : parsed.error },
    );
  }
  const e = parsed.data;
  const d = detectorParsed?.success ? detectorParsed.data : null;
  const settings = Settings.parse({
    jellyfin: {
      url: e.JELLYFIN_URL,
      apiKey: e.JELLYFIN_API_KEY,
      mediaRoot: e.MEDIA_ROOT,
      jellyfinMediaRoot: e.JELLYFIN_MEDIA_ROOT,
    },
    tmdbApiKey: e.TMDB_API_KEY,
    contactEmail: e.CONTACT_EMAIL,
    downloads: {
      concurrency: e.DOWNLOAD_CONCURRENCY,
      ffmpegConcurrency: e.FFMPEG_CONCURRENCY,
      browserConcurrency: e.BROWSER_CONCURRENCY,
      sequential: e.SEQUENTIAL_DOWNLOADS,
      skipPlayers: e.SKIP_PLAYERS ?? [],
      connections: e.DOWNLOAD_CONNECTIONS,
      downloadsPerHost: e.DOWNLOADS_PER_HOST,
      metadataPerSec: e.METADATA_PER_SEC,
      probeTimeoutMs: e.PROBE_TIMEOUT_MS,
    },
    tracks: {
      maxHeight: e.DEFAULT_MAX_HEIGHT,
      audioLangs: e.DEFAULT_AUDIO_LANGS,
      subtitleLangs: e.DEFAULT_SUBTITLE_LANGS,
      externalSubtitles: e.SUBTITLES_EXTERNAL,
    },
    browser: d
      ? {
          genericDetector: e.HM_GENERIC_DETECTOR,
          maxConcurrent: d.HM_DETECTOR_MAX_CONCURRENT,
          timeoutMs: d.HM_DETECTOR_TIMEOUT_MS,
          settleMs: d.HM_DETECTOR_SETTLE_MS,
          userAgent: d.HM_DETECTOR_USER_AGENT,
          chromiumPath: d.HM_CHROMIUM_PATH,
          noSandbox: d.HM_CHROMIUM_NO_SANDBOX,
        }
      : undefined,
  });
  return { settings, extractorsFile: e.HM_EXTRACTORS_FILE };
}

/**
 * What the server runs with. `hasSites` says whether the extractors describe any site: their players
 * need the browser, as the generic detector does.
 */
export function configFrom(settings: Settings, hasSites: boolean): Config {
  const { jellyfin, downloads, tracks, browser } = settings;
  const detectorOn = browser !== undefined && (browser.genericDetector || hasSites);
  return {
    streamDefaults: {
      ...(tracks.maxHeight !== undefined ? { maxHeight: tracks.maxHeight } : {}),
      ...(tracks.audioLangs !== undefined ? { audioLangs: tracks.audioLangs } : {}),
      ...(tracks.subtitleLangs !== undefined ? { subtitleLangs: tracks.subtitleLangs } : {}),
    },
    externalSubtitles: tracks.externalSubtitles,
    detector: detectorOn
      ? {
          maxConcurrent: browser.maxConcurrent,
          timeoutMs: browser.timeoutMs,
          settleMs: browser.settleMs,
          userAgent: browser.userAgent,
          chromiumPath: browser.chromiumPath,
          noSandbox: browser.noSandbox,
        }
      : null,
    genericExtractor: detectorOn && browser.genericDetector,
    mediaRoot: jellyfin.mediaRoot,
    jellyfinUrl: jellyfin.url,
    jellyfinApiKey: jellyfin.apiKey,
    jellyfinMediaRoot: jellyfin.jellyfinMediaRoot,
    tmdbApiKey: settings.tmdbApiKey,
    contactEmail: settings.contactEmail,
    sequentialDownloads: downloads.sequential,
    skipPlayers: downloads.skipPlayers,
    concurrency: {
      download: downloads.concurrency,
      ffmpeg: downloads.ffmpegConcurrency,
      browser: downloads.browserConcurrency,
      none: 4,
    },
    hostLimits: {
      ...(downloads.downloadsPerHost !== undefined
        ? { downloadsPerHost: downloads.downloadsPerHost }
        : {}),
      ...(downloads.metadataPerSec !== undefined
        ? { metadataPerSec: downloads.metadataPerSec }
        : {}),
    },
    downloadConnections: downloads.connections,
    probeTimeoutMs: downloads.probeTimeoutMs,
  };
}

/** What this server calls itself when it fetches from other sites. */
export function userAgent(version: string, contactEmail: string | undefined): string {
  return contactEmail ? `OrcaHM/${version} (+contact: ${contactEmail})` : `OrcaHM/${version}`;
}

/** Everything the environment may still say that is now changed from the panel. */
const MOVED_TO_PANEL = [...Object.keys(LegacyEnv.shape), ...Object.keys(DetectorEnv.shape)];

/**
 * Variables that used to do something and now are ignored, so a deployment is told rather than
 * surprised. `carried` is true on the boot that copied the environment's setup into the database.
 */
export function deprecatedEnvWarnings(
  env: Record<string, string | undefined>,
  carried = false,
): string[] {
  const warnings: string[] = [];
  const moved = MOVED_TO_PANEL.filter((name) => env[name] !== undefined);
  if (moved.length > 0 && !carried) {
    warnings.push(
      `Ignored, the panel's settings rule now (remove them from the environment): ${moved.join(", ")}.`,
    );
  }
  for (const name of ["HM_SITES_FILE", "HM_SHOW_API_FILE"]) {
    if (env[name] !== undefined) {
      warnings.push(
        `${name} is ignored now: both kinds of site live in one extractors file, set from the panel (see extractors.example.json).`,
      );
    }
  }
  if (env["IA_HOST_CONCURRENCY"] !== undefined) {
    warnings.push(
      "IA_HOST_CONCURRENCY is ignored now: each extractor declares its own limits, and the panel's download settings override them.",
    );
  }
  return warnings;
}
