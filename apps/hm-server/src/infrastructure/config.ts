import type { ExtractorLimits } from "@orca/extractor-core";
import type { Settings } from "@orca/hm-contract";
import type { StreamPrefs } from "../application/ports.ts";
import * as z from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

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
