import { LANGUAGE_CODE_PATTERN, MAX_MAX_HEIGHT, MIN_MAX_HEIGHT } from "@orca/hm-contract/rules";
import type { SettingsUpdate, SettingsView } from "@/api/types";

/** Which subtitles a series without its own choice keeps. */
export type SubtitleMode = "all" | "none" | "some";

/**
 * The settings as the form holds them: text for what is typed (numbers included, so a half-typed one
 * is not lost), seconds where the server counts milliseconds.
 */
export interface Draft {
  jellyfinUrl: string;
  /** The key `POST /settings/jellyfin` made; empty keeps the one the server has. */
  apiKey: string;
  /** The library folder as Jellyfin sees it. */
  jellyfinMediaRoot: string;
  /** Jellyfin runs on this same machine, so H&M writes to the folder it reads. */
  sameMachine: boolean;
  /** The folder as this server sees it, when Jellyfin is elsewhere (a mount of it). */
  mediaRoot: string;
  /** A new TMDB key; empty keeps the stored one, unless `removeTmdb`. */
  tmdbApiKey: string;
  hasTmdbApiKey: boolean;
  removeTmdb: boolean;
  contactEmail: string;
  concurrency: string;
  ffmpegConcurrency: string;
  browserConcurrency: string;
  sequential: boolean;
  /** Hosts, comma separated. */
  skipPlayers: string;
  connections: string;
  downloadsPerHost: string;
  metadataPerSec: string;
  probeTimeoutSec: string;
  maxHeight: string;
  /** ISO 639-2 codes, comma separated; empty keeps every audio track. */
  audioLangs: string;
  subtitleMode: SubtitleMode;
  subtitleLangs: string;
  externalSubtitles: boolean;
  browserOn: boolean;
  genericDetector: boolean;
  maxConcurrent: string;
  timeoutSec: string;
  settleSec: string;
  userAgent: string;
  chromiumPath: string;
  noSandbox: boolean;
}

export type DraftField = keyof Draft;
export type DraftProblem = "required" | "number" | "url" | "email" | "languages" | "hosts";
export type DraftErrors = Partial<Record<DraftField, DraftProblem>>;

/** What a fresh server starts the form with: only tuning, never a path, host or key. */
export function suggestedDraft(): Draft {
  return {
    jellyfinUrl: "",
    apiKey: "",
    jellyfinMediaRoot: "",
    sameMachine: true,
    mediaRoot: "",
    tmdbApiKey: "",
    hasTmdbApiKey: false,
    removeTmdb: false,
    contactEmail: "",
    concurrency: "1",
    ffmpegConcurrency: "1",
    browserConcurrency: "1",
    sequential: true,
    skipPlayers: "",
    connections: "4",
    downloadsPerHost: "",
    metadataPerSec: "",
    probeTimeoutSec: "180",
    maxHeight: "",
    audioLangs: "",
    subtitleMode: "all",
    subtitleLangs: "",
    externalSubtitles: false,
    browserOn: true,
    genericDetector: false,
    maxConcurrent: "1",
    timeoutSec: "45",
    settleSec: "3",
    userAgent: "",
    chromiumPath: "",
    noSandbox: false,
  };
}

const text = (value: number | undefined, scale = 1) =>
  value === undefined ? "" : String(value / scale);

/** The form, filled with what the server has. */
export function draftFromView(view: SettingsView): Draft {
  const { jellyfin, downloads, tracks, browser } = view;
  const suggested = suggestedDraft();
  return {
    ...suggested,
    jellyfinUrl: jellyfin.url,
    jellyfinMediaRoot: jellyfin.jellyfinMediaRoot,
    sameMachine: jellyfin.mediaRoot === jellyfin.jellyfinMediaRoot,
    mediaRoot: jellyfin.mediaRoot,
    hasTmdbApiKey: view.hasTmdbApiKey,
    contactEmail: view.contactEmail ?? "",
    // One at a time is how the careful way (players in order) shows: "1".
    concurrency: downloads.sequential ? "1" : text(downloads.concurrency),
    ffmpegConcurrency: text(downloads.ffmpegConcurrency),
    browserConcurrency: text(downloads.browserConcurrency),
    sequential: downloads.sequential,
    skipPlayers: downloads.skipPlayers.join(", "),
    connections: text(downloads.connections),
    downloadsPerHost: text(downloads.downloadsPerHost),
    metadataPerSec: text(downloads.metadataPerSec),
    probeTimeoutSec: text(downloads.probeTimeoutMs, 1000),
    maxHeight: text(tracks.maxHeight),
    audioLangs: (tracks.audioLangs ?? []).join(", "),
    subtitleMode:
      tracks.subtitleLangs === undefined
        ? "all"
        : tracks.subtitleLangs.length === 0
          ? "none"
          : "some",
    subtitleLangs: (tracks.subtitleLangs ?? []).join(", "),
    externalSubtitles: tracks.externalSubtitles,
    browserOn: browser !== undefined,
    ...(browser
      ? {
          genericDetector: browser.genericDetector,
          maxConcurrent: text(browser.maxConcurrent),
          timeoutSec: text(browser.timeoutMs, 1000),
          settleSec: text(browser.settleMs, 1000),
          userAgent: browser.userAgent ?? "",
          chromiumPath: browser.chromiumPath ?? "",
          noSandbox: browser.noSandbox,
        }
      : {}),
  };
}

const list = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");

/**
 * Reads the form into what the server takes, or says what is wrong with each field. Numbers are only
 * checked as numbers here; their limits are the server's to enforce, and it names the field.
 */
export function settingsFromDraft(
  draft: Draft,
): { ok: true; update: SettingsUpdate } | { ok: false; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const required = (field: DraftField, value: string): string => {
    const trimmed = value.trim();
    if (trimmed === "") errors[field] = "required";
    return trimmed;
  };
  const number = (field: DraftField, scale = 1, optional = false): number | undefined => {
    const value = (draft[field] as string).trim();
    if (value === "") {
      if (!optional) errors[field] = "required";
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors[field] = "number";
      return undefined;
    }
    return Math.round(parsed * scale * 1000) / 1000;
  };
  const languages = (field: DraftField): string[] => {
    const codes = list(draft[field] as string);
    if (!codes.every((code) => LANGUAGE_CODE_PATTERN.test(code))) errors[field] = "languages";
    return codes;
  };

  const url = required("jellyfinUrl", draft.jellyfinUrl);
  if (url !== "" && !/^https?:\/\/[^\s/]+/.test(url)) errors.jellyfinUrl = "url";
  const jellyfinMediaRoot = required("jellyfinMediaRoot", draft.jellyfinMediaRoot);
  const mediaRoot = draft.sameMachine ? jellyfinMediaRoot : required("mediaRoot", draft.mediaRoot);
  const contactEmail = draft.contactEmail.trim();
  if (contactEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    errors.contactEmail = "email";
  }
  const skipPlayers = list(draft.skipPlayers);
  if (!skipPlayers.every((host) => /^[a-z0-9.-]+$/.test(host))) errors.skipPlayers = "hosts";
  const maxHeight = number("maxHeight", 1, true);
  if (maxHeight !== undefined && (maxHeight < MIN_MAX_HEIGHT || maxHeight > MAX_MAX_HEIGHT)) {
    errors.maxHeight = "number";
  }
  const audioLangs = languages("audioLangs");
  const subtitleLangs = draft.subtitleMode === "some" ? languages("subtitleLangs") : [];
  if (draft.subtitleMode === "some" && subtitleLangs.length === 0)
    errors.subtitleLangs = "required";

  const concurrency = number("concurrency") ?? 0;
  const update: SettingsUpdate = {
    jellyfin: {
      url,
      mediaRoot,
      jellyfinMediaRoot,
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
    },
    ...(draft.removeTmdb
      ? { tmdbApiKey: null }
      : draft.tmdbApiKey.trim()
        ? { tmdbApiKey: draft.tmdbApiKey.trim() }
        : {}),
    ...(contactEmail ? { contactEmail } : {}),
    downloads: {
      concurrency,
      ffmpegConcurrency: number("ffmpegConcurrency") ?? 0,
      browserConcurrency: number("browserConcurrency") ?? 0,
      // One episode at a time tries its players in order; more run each on the least busy server.
      sequential: concurrency === 1,
      skipPlayers,
      connections: number("connections") ?? 0,
      ...optional("downloadsPerHost", number("downloadsPerHost", 1, true)),
      ...optional("metadataPerSec", number("metadataPerSec", 1, true)),
      probeTimeoutMs: number("probeTimeoutSec", 1000) ?? 0,
    },
    tracks: {
      ...optional("maxHeight", maxHeight),
      ...(audioLangs.length > 0 ? { audioLangs } : {}),
      ...(draft.subtitleMode === "all" ? {} : { subtitleLangs }),
      externalSubtitles: draft.externalSubtitles,
    },
    ...(draft.browserOn
      ? {
          browser: {
            genericDetector: draft.genericDetector,
            maxConcurrent: number("maxConcurrent") ?? 0,
            timeoutMs: number("timeoutSec", 1000) ?? 0,
            settleMs: number("settleSec", 1000) ?? 0,
            ...(draft.userAgent.trim() ? { userAgent: draft.userAgent.trim() } : {}),
            ...(draft.chromiumPath.trim() ? { chromiumPath: draft.chromiumPath.trim() } : {}),
            noSandbox: draft.noSandbox,
          },
        }
      : {}),
  };
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, update };
}

function optional<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>);
}

/** The names of the sites an extractors file describes, or null when it is not one. */
export function extractorNames(textValue: string): string[] | null {
  if (textValue.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(textValue);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return Object.entries(parsed as Record<string, { name?: unknown }>).map(([id, entry]) =>
      typeof entry?.name === "string" ? entry.name : id,
    );
  } catch {
    return null;
  }
}
