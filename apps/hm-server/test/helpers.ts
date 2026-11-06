import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/infrastructure/db/client.ts";
import { DrizzleJobRepository } from "../src/infrastructure/db/job-repository.ts";
import { DrizzleNotificationRepository } from "../src/infrastructure/db/notification-repository.ts";
import { DrizzleSeriesRepository } from "../src/infrastructure/db/series-repository.ts";
import { DrizzleSettingsRepository } from "../src/infrastructure/db/settings-repository.ts";
import { DrizzleSessionRepository } from "../src/infrastructure/db/session-repository.ts";
import type { Episode, Series, SeriesSource } from "../src/domain/series.ts";
import { AddressGuard } from "../src/infrastructure/net/address-guard.ts";
import { HostLimiter, type HostLimits } from "../src/infrastructure/host-limiter.ts";
import { ManualClock } from "./fakes/clock.ts";

export const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** A fresh in-memory SQLite with the real migrations applied, and the real repositories on it. */
export function testDatabase(clock = new ManualClock()) {
  const database = openDatabase({ file: ":memory:", migrationsFolder: MIGRATIONS });
  return {
    database,
    clock,
    jobs: new DrizzleJobRepository(database, clock),
    series: new DrizzleSeriesRepository(database.db),
    sessions: new DrizzleSessionRepository(database.db),
    settings: new DrizzleSettingsRepository(database.db),
    notifications: new DrizzleNotificationRepository(database.db),
  };
}

export function aSeries(overrides: Partial<Series> = {}): Series {
  return {
    id: "series-1",
    title: "The Beverly Hillbillies",
    year: 1962,
    plot: "A family strikes oil.",
    tmdbId: null,
    imdbId: null,
    folderName: "The Beverly Hillbillies (1962)",
    hasPoster: false,
    hasBackdrop: false,
    hasLogo: false,
    artworkVersion: 0,
    artworkFrom: {},
    follow: false,
    paused: false,
    checkIntervalHours: 12,
    lastCheckedAt: null,
    maxHeight: null,
    audioLangs: null,
    subtitleLangs: null,
    preferredSources: {},
    createdAt: 1,
    ...overrides,
  };
}

/** The one source of {@link aSeries}, under the series' own id as migrated series have it. */
export function aSource(overrides: Partial<SeriesSource> = {}): SeriesSource {
  return {
    id: overrides.seriesId ?? "series-1",
    seriesId: "series-1",
    extractorId: "internet-archive",
    externalId: "bevhill",
    sourceUrl: "https://archive.org/details/bevhill",
    season: null,
    episodeOffset: 0,
    adjustments: [],
    remoteMarker: null,
    knownRefs: [],
    closed: false,
    createdAt: 1,
    ...overrides,
  };
}

export function anEpisode(overrides: Partial<Episode> = {}): Episode {
  const episode = overrides.episode ?? 1;
  const season = overrides.season ?? 1;
  return {
    id: `episode-${season}-${episode}`,
    seriesId: "series-1",
    sourceId: overrides.seriesId ?? "series-1",
    season,
    episode,
    title: `Episode ${episode}`,
    plot: null,
    airDate: null,
    inferred: false,
    sourceRef: `bevhill/s${season}e${episode}.mp4`,
    source: {
      kind: "direct",
      url: `https://archive.org/download/bevhill/s${season}e${episode}.mp4`,
      fileName: `s${season}e${episode}.mp4`,
      sizeBytes: 1000,
    },
    durationSec: 1500,
    sizeBytes: 1000,
    format: "MPEG4",
    status: "missing",
    filePath: null,
    fileSourceId: null,
    createdAt: 1,
    ...overrides,
  };
}

/** A limiter on a manual clock whose waits are instant; no spacing unless the test asks for it. */
export function testLimiter(
  limits: Partial<{ [L in keyof HostLimits]: Partial<HostLimits[L]> }> = {},
  clock = new ManualClock(),
) {
  const slept: number[] = [];
  const resolved: HostLimits = {
    metadata: { concurrency: 1, minIntervalMs: 0, ...limits.metadata },
    download: { concurrency: 1, minIntervalMs: 0, ...limits.download },
  };
  const limiter = new HostLimiter({
    limitsFor: () => resolved,
    clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock.advance(ms);
    },
  });
  return { limiter, clock, slept };
}

/** A guard whose DNS knows a few public names and one that points inside, and nothing else. */
export function testGuard() {
  const table: Record<string, string[]> = {
    "videos.example.com": ["93.184.216.34"],
    "cdn.example": ["93.184.216.35"],
    "cdn.example.com": ["93.184.216.35"],
    "other.example": ["93.184.216.36"],
    "inside.example.com": ["10.0.0.9"],
    localhost: ["127.0.0.1", "::1"],
  };
  return new AddressGuard({
    resolve: async (host) => {
      const found = table[host];
      if (!found) throw new Error(`ENOTFOUND ${host}`);
      return found;
    },
  });
}
