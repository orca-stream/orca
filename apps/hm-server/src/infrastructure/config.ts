import type { ExtractorLimits } from "@orca/extractor-core";
import type { StreamPrefs } from "../application/ports.ts";
import * as z from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");
const count = (fallback: number) => z.coerce.number().int().min(1).max(32).default(fallback);

/** Required once the browser is on (generic detector or a sites file); no default fits every site. */
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

const Env = z.object({
  DEFAULT_MAX_HEIGHT: z.coerce.number().int().min(144).max(4320).optional(),
  DEFAULT_AUDIO_LANGS: languageList.optional(),
  DEFAULT_SUBTITLE_LANGS: languageList.optional(),
  SUBTITLES_EXTERNAL: bool.default(false),
  HM_GENERIC_DETECTOR: bool.default(false),
  /** A JSON file describing sites by their selectors; their players need the browser too. */
  HM_SITES_FILE: z.string().min(1).optional(),
  DB_FILE: z.string().min(1),
  MEDIA_ROOT: z.string().min(1),
  JELLYFIN_URL: z.url(),
  JELLYFIN_API_KEY: z.string().min(1),
  JELLYFIN_MEDIA_ROOT: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535),
  HOST: z.string().min(1),
  WEB_ROOT: z.string().min(1).optional(),
  DEVICE_ID: z.string().min(1).optional(),
  CONTACT_EMAIL: z.email().optional(),
  SECURE_COOKIES: bool.default(false),
  DOWNLOAD_CONCURRENCY: count(2),
  FFMPEG_CONCURRENCY: count(1),
  BROWSER_CONCURRENCY: count(1),
  // Overrides of what each extractor declares for its hosts; absent means "use the declaration".
  DOWNLOADS_PER_HOST: z.coerce.number().int().min(1).max(32).optional(),
  METADATA_PER_SEC: z.coerce.number().positive().max(100).optional(),
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
  /** Offer the "Generic page" extractor (HM_GENERIC_DETECTOR). */
  genericExtractor: boolean;
  /** Where the sites described by selectors are (HM_SITES_FILE). */
  sitesFile: string | undefined;
  dbFile: string;
  mediaRoot: string;
  jellyfinUrl: string;
  jellyfinApiKey: string;
  /** The media root as Jellyfin sees it. */
  jellyfinMediaRoot: string;
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
    parsed.success && (parsed.data.HM_GENERIC_DETECTOR || parsed.data.HM_SITES_FILE !== undefined);
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
    dbFile: e.DB_FILE,
    mediaRoot: e.MEDIA_ROOT,
    jellyfinUrl: e.JELLYFIN_URL.replace(/\/+$/, ""),
    jellyfinApiKey: e.JELLYFIN_API_KEY,
    jellyfinMediaRoot: e.JELLYFIN_MEDIA_ROOT,
    port: e.PORT,
    host: e.HOST,
    webRoot: e.WEB_ROOT,
    deviceId: e.DEVICE_ID,
    contactEmail: e.CONTACT_EMAIL,
    secureCookies: e.SECURE_COOKIES,
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
