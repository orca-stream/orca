import * as z from "zod";
import { LANGUAGE_CODE_PATTERN, MAX_MAX_HEIGHT, MIN_MAX_HEIGHT } from "./rules.ts";

/*
 * What the server does, kept in its database and changed from the panel. Only what it needs to start
 * at all (where it listens, where its database is) stays in its environment.
 */

const Host = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+$/, "Host names without scheme or path, such as player.example");
const Language = z.string().regex(LANGUAGE_CODE_PATTERN, "ISO 639-2 codes such as eng, spa, jpn");
const count = (max: number) => z.number().int().min(1).max(max);

export const JellyfinSettings = z.object({
  /** Without a trailing slash. */
  url: z.url().transform((url) => url.replace(/\/+$/, "")),
  apiKey: z.string().min(1),
  /** The series library folder as this server sees it. */
  mediaRoot: z.string().min(1),
  /** The same folder as Jellyfin sees it (the same path when both run on one machine). */
  jellyfinMediaRoot: z.string().min(1),
});
export type JellyfinSettings = z.infer<typeof JellyfinSettings>;

export const DownloadSettings = z.object({
  /** Downloads running at once. */
  concurrency: count(32),
  ffmpegConcurrency: count(32),
  browserConcurrency: count(32),
  /** One episode at a time, its players in order; failing them all fails the episode. */
  sequential: z.boolean(),
  /** Players never tried, by host (a host covers its subdomains). */
  skipPlayers: z.array(Host).max(50),
  /** Connections one direct file, or an HLS stream's segments, are fetched over. */
  connections: count(16),
  /** Overrides of what each extractor declares for its hosts; absent keeps the declaration. */
  downloadsPerHost: count(32).optional(),
  metadataPerSec: z.number().positive().max(100).optional(),
  /** How long ffprobe may read a stream over the network. */
  probeTimeoutMs: z.number().int().min(1000),
});
export type DownloadSettings = z.infer<typeof DownloadSettings>;

export const TrackSettings = z.object({
  /** Absent: the best quality. */
  maxHeight: z.number().int().min(MIN_MAX_HEIGHT).max(MAX_MAX_HEIGHT).optional(),
  /** Absent: every audio track. */
  audioLangs: z.array(Language).max(10).optional(),
  /** Absent: every text subtitle; empty: none. */
  subtitleLangs: z.array(Language).max(10).optional(),
  /** Subtitles as files beside the video instead of inside it. */
  externalSubtitles: z.boolean(),
});
export type TrackSettings = z.infer<typeof TrackSettings>;

/** The headless browser the sites' players and the generic detector run in. */
export const BrowserSettings = z.object({
  /** Offer "Generic page" when adding a series. */
  genericDetector: z.boolean(),
  maxConcurrent: count(8),
  timeoutMs: z.number().int().min(1),
  settleMs: z.number().int().min(0),
  userAgent: z.string().min(1).optional(),
  /** Absent: the Chromium Playwright installed. */
  chromiumPath: z.string().min(1).optional(),
  /** For Chromium in a container that cannot make its own sandbox. */
  noSandbox: z.boolean(),
});
export type BrowserSettings = z.infer<typeof BrowserSettings>;

export const Settings = z.object({
  jellyfin: JellyfinSettings,
  /** A TMDB v3 key or v4 read token: lists a show's seasons and episodes. */
  tmdbApiKey: z.string().trim().min(1).optional(),
  /** Who sites can write to about this server's requests (goes in the User-Agent). */
  contactEmail: z.email().optional(),
  downloads: DownloadSettings,
  tracks: TrackSettings,
  /**
   * Absent: no browser, so neither the generic detector nor the extractors' sites, whose players
   * need it.
   */
  browser: BrowserSettings.optional(),
});
export type Settings = z.infer<typeof Settings>;

/** The settings as the panel reads them: the keys are never sent back, only whether there is one. */
export const SettingsView = Settings.omit({ tmdbApiKey: true }).extend({
  jellyfin: JellyfinSettings.omit({ apiKey: true }),
  hasTmdbApiKey: z.boolean(),
});
export type SettingsView = z.infer<typeof SettingsView>;

/**
 * What the panel sends to change them. A key left out keeps the stored one; `tmdbApiKey: null`
 * removes it. A new Jellyfin server comes with the key `POST /api/settings/jellyfin` made for it.
 */
export const SettingsUpdate = Settings.omit({ tmdbApiKey: true }).extend({
  jellyfin: JellyfinSettings.extend({ apiKey: z.string().min(1).optional() }),
  tmdbApiKey: z.string().trim().min(1).nullable().optional(),
});
export type SettingsUpdate = z.infer<typeof SettingsUpdate>;

/** Signs in to a Jellyfin server as an administrator, to make this server its own API key. */
export const JellyfinConnectBody = z.object({
  url: z.url(),
  username: z.string().min(1).max(256),
  password: z.string().max(1024),
  /** Before the server is set up, the code when one is needed (see SetupStatus). */
  code: z.string().max(64).optional(),
});
export type JellyfinConnectBody = z.infer<typeof JellyfinConnectBody>;

export const JellyfinConnection = z.object({
  url: z.string(),
  serverName: z.string(),
  /** The key made for this server; sent back in `jellyfin.apiKey` when saving. */
  apiKey: z.string(),
  /** The server's show libraries and their folders, as Jellyfin sees them. */
  libraries: z.array(z.object({ name: z.string(), locations: z.array(z.string()) })),
});
export type JellyfinConnection = z.infer<typeof JellyfinConnection>;

/** `GET /api/setup`: whether the server still has to be set up, and how. */
export const SetupStatus = z.object({
  configured: z.boolean(),
  /** Asked for when the panel is not opened from this same machine: printed in the server's console. */
  needsCode: z.boolean(),
});
export type SetupStatus = z.infer<typeof SetupStatus>;

/** `POST /api/setup`: the first settings, with the code when one is needed. */
export const SetupBody = z.object({
  code: z.string().max(64).optional(),
  settings: Settings,
  /** The extractors file's text, when there is one. */
  extractors: z
    .string()
    .max(512 * 1024)
    .optional(),
});
export type SetupBody = z.infer<typeof SetupBody>;

/** `PUT /api/settings/extractors`: the extractors file's text; empty removes every site. */
export const ExtractorsBody = z.object({ text: z.string().max(512 * 1024) });
export type ExtractorsBody = z.infer<typeof ExtractorsBody>;
