import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  EpisodeFile,
  LibraryShow,
  Authenticated,
  Authenticator,
  DownloadContext,
  DownloadResult,
  Downloader,
  FetchedImage,
  ImageFetcher,
  EpisodeGuide,
  GuideEpisode,
  GuideSeason,
  GuideShow,
  MediaServer,
  Notifier,
  ShowMatch,
  StreamDetector,
  DetectedStream,
} from "../../src/application/ports.ts";
import type { Notification } from "../../src/domain/notification.ts";
import { AbortedError, AppError } from "../../src/domain/errors.ts";
import type { Source } from "../../src/domain/series.ts";

export type DownloadBehavior = (
  source: Source,
  destPath: string,
  context: DownloadContext,
) => Promise<void | Partial<DownloadResult>>;

/**
 * A Downloader that never touches the network. By default it writes a small file at the destination
 * and reports progress; a test can script a behavior per call (fail, hang until aborted…).
 */
export class FakeDownloader implements Downloader {
  readonly calls: {
    source: Source;
    destPath: string;
    prefs: DownloadContext["prefs"];
  }[] = [];
  private readonly scripted: DownloadBehavior[] = [];
  concurrent = 0;
  peak = 0;

  /** The next call (and only that one) behaves like this. */
  once(behavior: DownloadBehavior): this {
    this.scripted.push(behavior);
    return this;
  }

  canHandle(source: Source): boolean {
    return source.kind === "direct" || source.kind === "hls";
  }

  async download(
    source: Source,
    destPath: string,
    context: DownloadContext,
  ): Promise<DownloadResult> {
    this.calls.push({ source, destPath, prefs: context.prefs });
    this.concurrent++;
    this.peak = Math.max(this.peak, this.concurrent);
    try {
      const behavior = this.scripted.shift() ?? FakeDownloader.writeFile;
      const result = await behavior(source, destPath, context);
      return { bytes: 5, ...(result ?? {}) };
    } finally {
      this.concurrent--;
    }
  }

  static writeFile: DownloadBehavior = async (source, destPath, context) => {
    context.onProgress({ bytes: 2, total: 5 });
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, `video:${source.kind === "direct" ? source.fileName : source.url}`);
    context.onProgress({ bytes: 5, total: 5 });
  };

  static hangUntilAborted: DownloadBehavior = (_source, _dest, context) =>
    new Promise<void>((_, reject) => {
      context.signal.addEventListener("abort", () => reject(new AbortedError()), { once: true });
    });
}

export class FakeMediaServer implements MediaServer {
  readonly updated: string[] = [];
  fail: Error | null = null;

  /** What TMDB knows, by TMDB id. */
  readonly shows = new Map<string, ShowMatch>();
  /** The shows in Jellyfin's libraries. */
  library: LibraryShow[] = [];
  /** Their episode files, by show id. */
  readonly episodeFiles = new Map<string, EpisodeFile[]>();

  async libraryUpdated(path: string): Promise<void> {
    if (this.fail) throw this.fail;
    this.updated.push(path);
  }

  async findShowByTmdbId(tmdbId: string): Promise<ShowMatch | null> {
    if (this.fail) throw this.fail;
    return this.shows.get(tmdbId) ?? null;
  }

  async listShows(): Promise<LibraryShow[]> {
    if (this.fail) throw this.fail;
    return this.library;
  }

  async listEpisodeFiles(showId: string): Promise<EpisodeFile[]> {
    if (this.fail) throw this.fail;
    return this.episodeFiles.get(showId) ?? [];
  }
}

export class FakeEpisodeGuide implements EpisodeGuide {
  fail: Error | null = null;
  /** What TMDB lists, by TMDB id. */
  readonly shows = new Map<string, GuideSeason[]>();
  /** By `<tmdbId>/<season>`. */
  readonly seasonEpisodes = new Map<string, GuideEpisode[]>();
  readonly languages: (string | undefined)[] = [];
  /** The show beyond its seasons, by TMDB id. */
  readonly showFacts = new Map<string, GuideShow>();

  async seasons(tmdbId: string, language: string | undefined): Promise<GuideSeason[] | null> {
    if (this.fail) throw this.fail;
    this.languages.push(language);
    return this.shows.get(tmdbId) ?? null;
  }

  async episodes(
    tmdbId: string,
    season: number,
    language: string | undefined,
  ): Promise<GuideEpisode[] | null> {
    if (this.fail) throw this.fail;
    this.languages.push(language);
    return this.seasonEpisodes.get(`${tmdbId}/${season}`) ?? null;
  }

  async show(tmdbId: string): Promise<GuideShow | null> {
    if (this.fail) throw this.fail;
    return this.showFacts.get(tmdbId) ?? null;
  }
}

export class FakeAuthenticator implements Authenticator {
  admins = new Map<string, string>([["sam", "secret"]]);
  readonly demoted = new Set<string>();
  down = false;
  checks = 0;

  async authenticate(username: string, password: string): Promise<Authenticated> {
    if (this.admins.get(username) !== password)
      throw new AppError("unauthorized", "Wrong username or password");
    return { userId: `id-${username}`, userName: username };
  }

  async isStillAdmin(userId: string): Promise<boolean> {
    this.checks++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (this.down) throw new Error("jellyfin is down");
    return !this.demoted.has(userId);
  }
}

export class FakeImageFetcher implements ImageFetcher {
  fail = false;
  readonly requested: string[] = [];
  readonly hosts: (readonly string[])[] = [];

  async fetch(url: string, options: { hosts: readonly string[] }): Promise<FetchedImage> {
    this.requested.push(url);
    this.hosts.push(options.hosts);
    if (this.fail) throw new Error("no image");
    return { bytes: new Uint8Array([1, 2, 3]), extension: ".jpg" };
  }
}

export class FakeStreamDetector implements StreamDetector {
  streams: DetectedStream[] = [];
  readonly calls: string[] = [];
  readonly referers: (string | undefined)[] = [];
  /** Answers for some pages: their streams, or the error detecting them throws. */
  readonly byPage = new Map<string, DetectedStream[] | Error>();

  async detect(pageUrl: string, options?: { referer?: string }): Promise<DetectedStream[]> {
    this.calls.push(pageUrl);
    this.referers.push(options?.referer);
    const answer = this.byPage.get(pageUrl);
    if (answer instanceof Error) throw answer;
    return answer ?? this.streams;
  }
}

/** A second channel next to the panel's: remembers what it was sent, and can be told to fail. */
export class RecordingNotifier implements Notifier {
  readonly sent: Notification[] = [];
  fail = false;

  async notify(notification: Notification): Promise<void> {
    if (this.fail) throw new Error("channel down");
    this.sent.push(notification);
  }
}
