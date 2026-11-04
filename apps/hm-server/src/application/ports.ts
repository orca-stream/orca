import type { Extraction, SiteExtractor } from "@orca/extractor-core";
import type { EpisodeStatus, HmEvent, JobStatus, ProgressDetail } from "@orca/hm-contract";
import type { HostLane, Job, NewJob } from "../domain/job.ts";
import type { Notification, NotificationKind } from "../domain/notification.ts";
import type { Episode, Series, SeriesSource, Source } from "../domain/series.ts";

// Every port below is implemented by an adapter in src/infrastructure and by a fake in test/fakes.

export interface Clock {
  now(): number;
}

export interface Random {
  /** In [0, 1). */
  next(): number;
}

export interface SeriesWithCounts extends Series {
  episodeCount: number;
  availableCount: number;
}

export interface SeriesRepository {
  /** Persists a series, its first source and its episodes together, or none of them. */
  create(series: Series, source: SeriesSource, episodes: Episode[]): Promise<void>;
  /** Persists another source of an existing series and its episodes together, or neither. */
  addSource(source: SeriesSource, episodes: Episode[]): Promise<void>;
  get(id: string): Promise<Series | null>;
  findByFolder(folderName: string): Promise<Series | null>;
  /** The series with that TMDB id, else the one with that IMDb id; null ids match nothing. */
  findByProviderIds(ids: { tmdbId: string | null; imdbId: string | null }): Promise<Series | null>;
  /** The source an address of a site was already added as, in whichever series. */
  findSourceByExternal(extractorId: string, externalId: string): Promise<SeriesSource | null>;
  /** Oldest first. Without ids: the sources of every series. */
  listSources(seriesIds?: string[]): Promise<SeriesSource[]>;
  updateSource(
    id: string,
    patch: Partial<Pick<SeriesSource, "remoteMarker" | "knownRefs" | "closed">>,
  ): Promise<void>;
  list(): Promise<SeriesWithCounts[]>;
  update(
    id: string,
    patch: Partial<
      Pick<
        Series,
        | "title"
        | "year"
        | "folderName"
        | "tmdbId"
        | "imdbId"
        | "follow"
        | "paused"
        | "checkIntervalHours"
        | "hasPoster"
        | "lastCheckedAt"
        | "maxHeight"
        | "audioLangs"
        | "subtitleLangs"
      >
    >,
  ): Promise<Series | null>;
  /** Followed series never checked, or last checked more than their interval ago. */
  findDueSeries(now: number): Promise<Series[]>;
  /**
   * Stores what a re-check found, together: existing episodes (matched by `sourceRef` upstream) get
   * their site metadata refreshed, but never their status, file or number; new ones are inserted.
   */
  upsertEpisodes(seriesId: string, changes: { update: Episode[]; add: Episode[] }): Promise<void>;
  listEpisodes(seriesId: string): Promise<Episode[]>;
  getEpisode(id: string): Promise<Episode | null>;
  getEpisodes(ids: string[]): Promise<Episode[]>;
  setEpisodeStatus(id: string, status: EpisodeStatus, filePath?: string | null): Promise<void>;
  /** Titles by series id, to label jobs. */
  seriesTitles(ids: string[]): Promise<Map<string, string>>;
}

export interface EnqueueResult {
  job: Job;
  /** False when an active job with the same dedupe key already existed and was returned instead. */
  created: boolean;
}

export interface ListJobsFilter {
  status?: JobStatus[];
  limit: number;
  cursor?: string | undefined;
}

export interface JobRepository {
  enqueue(job: NewJob): Promise<EnqueueResult>;
  /**
   * Atomically takes the best ready job of a resource and marks it running with a lease. With
   * `oneEpisodeAtATime`, a download is taken only if it belongs to the episode already under way, or,
   * when none is, if it is the first download due of all.
   */
  claim(
    resource: Job["resource"],
    leaseOwner: string,
    leaseMs: number,
    options?: { oneEpisodeAtATime?: boolean },
  ): Promise<Job | null>;
  /** The host lanes that have a queued job due now. */
  readyHostLanes(): Promise<HostLane[]>;
  /** Queued plus running jobs per host lane; lanes with none are absent. */
  countActiveByHostLane(): Promise<Map<HostLane, number>>;
  heartbeat(id: string, leaseOwner: string, leaseMs: number): Promise<void>;
  updateProgress(id: string, progress: number | null, detail: ProgressDetail | null): Promise<void>;
  /**
   * The four settling calls below only apply to a job the given worker still holds as `running`;
   * they return null when it moved on meanwhile (cancelled, recovered), and then change nothing.
   */
  complete(id: string, leaseOwner: string): Promise<Job | null>;
  fail(
    id: string,
    leaseOwner: string,
    error: string,
    kind: "retryable" | "permanent",
  ): Promise<Job | null>;
  /** Back to queued, to try again at `runAfter`. */
  requeue(id: string, leaseOwner: string, runAfter: number, error: string): Promise<Job | null>;
  /**
   * Back to queued under another resource and payload. `refund`: the try that just ended does not
   * count against the attempts.
   */
  reroute(
    id: string,
    leaseOwner: string,
    move: {
      resource: Job["resource"];
      payload: unknown;
      runAfter: number;
      refund: boolean;
      /** Why it moved, shown as the job's last error; null for a plain move. */
      note: string | null;
    },
  ): Promise<Job | null>;
  /** Cancels a job only if it is still queued (a pump may have claimed it a moment ago). */
  cancelQueued(id: string): Promise<Job | null>;
  cancelRunning(id: string, leaseOwner: string): Promise<Job | null>;
  /** failed or cancelled -> queued with attempts reset. */
  retry(id: string): Promise<Job | null>;
  /** Moves a queued job's run_after later (debounce). */
  postpone(id: string, runAfter: number): Promise<void>;
  /** Boot: jobs a crash left `running` go back to queued, and the crashed try doesn't count. */
  recoverRunning(): Promise<number>;
  /** Running jobs whose lease ran out (a hung worker), except the ids still running in this process. */
  recoverExpired(exceptIds: string[]): Promise<number>;
  get(id: string): Promise<Job | null>;
  list(filter: ListJobsFilter): Promise<{ items: Job[]; nextCursor: string | null }>;
  /** The queued or running download job of each of these episodes, whatever its dedupe key. */
  activeDownloadJobs(episodeIds: string[]): Promise<Job[]>;
  /** Queued plus running episode downloads per series id; series with none are absent. */
  countActiveDownloads(): Promise<Map<string, number>>;
  /** The episode downloads running right now, of every series. */
  runningDownloads(): Promise<Job[]>;
  /**
   * Deletes the failed downloads whose episode is available after all (another attempt got it):
   * nothing is left to retry, and retrying them is refused. Returns how many went.
   */
  dropSettledFailures(): Promise<number>;
}

export interface SessionRecord {
  id: string;
  userId: string;
  userName: string;
  createdAt: number;
  expiresAt: number;
  checkedAt: number;
}

export interface SessionRepository {
  create(session: SessionRecord): Promise<void>;
  find(id: string): Promise<SessionRecord | null>;
  touch(id: string, checkedAt: number): Promise<void>;
  delete(id: string): Promise<void>;
  deleteExpired(now: number): Promise<void>;
}

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

/**
 * Which tracks of a stream to keep. Languages are ISO 639-2 codes as ffprobe reports them
 * (`eng`, `spa`, `jpn`). Absent: the best quality, every audio track, every text subtitle.
 */
export interface StreamPrefs {
  maxHeight?: number | undefined;
  audioLangs?: readonly string[] | undefined;
  /** Empty: no subtitles. */
  subtitleLangs?: readonly string[] | undefined;
}

/** A subtitle file written next to the video, waiting to be named for Jellyfin. */
export interface Sidecar {
  path: string;
  /** ISO 639-2 code, when the stream said one. */
  language?: string | undefined;
  forced?: boolean | undefined;
  /** File extension without the dot. */
  format: string;
}

export interface DownloadResult {
  bytes: number;
  /** Where the video ended up when it is not the `destPath` asked for (the container changed). */
  path?: string | undefined;
  sidecars?: Sidecar[] | undefined;
}

export interface DownloadContext {
  signal: AbortSignal;
  prefs?: StreamPrefs | undefined;
  /** `fraction` (0..1) is for downloads measured in media time, not bytes (ffmpeg). */
  onProgress(progress: {
    bytes: number;
    total?: number;
    fraction?: number;
    speed?: number;
    eta?: number;
  }): void;
}

export interface Downloader {
  canHandle(source: Source): boolean;
  /**
   * Writes the source to `destPath`: through a `.part` file that is checked and then renamed, so
   * `destPath` only ever exists complete. Resumes a `.part` left by an interrupted try when it can.
   * Throws RetryableError / PermanentError. On abort it throws AbortedError and keeps the `.part`, so a
   * stop can resume; the caller discards it when the job was cancelled.
   */
  download(source: Source, destPath: string, context: DownloadContext): Promise<DownloadResult>;
}

export interface LibraryWriter {
  /** Absolute path where an episode is staged while downloading. */
  stagingPath(episode: Episode): string;
  /** Absolute path of a series' folder. */
  seriesPath(series: Series): string;
  /**
   * Creates the series folder and writes tvshow.nfo. `createdFolder` is false when the folder was
   * already there, so a caller undoing its work knows the folder is not its own to remove.
   */
  writeSeries(series: Series): Promise<{ createdFolder: boolean }>;
  writePoster(series: Series, image: FetchedImage): Promise<void>;
  /** Deletes the files of a series folder this server just made (`createdFolder`), and the folder if it ends up empty. */
  removeSeries(series: Series): Promise<void>;
  /** The poster image on disk, if the series has one. */
  posterPath(series: Series): Promise<string | null>;
  /** Moves the staged file to its Jellyfin name and writes the episode .nfo. Returns the path under MEDIA_ROOT. */
  commitEpisode(
    series: Series,
    episode: Episode,
    stagedPath: string,
    sidecars?: Sidecar[],
  ): Promise<{ relativePath: string }>;
  /** Deletes everything staged for an episode: the file, its `.part` and any subtitle files. */
  discardStaged(episode: Episode): Promise<void>;
  /**
   * Gives the episode files of a series this server took over from Jellyfin its own names
   * (`Season 01/Show S01E01.ext`), together with the files named after each (subtitles, nfo,
   * thumbnails, trickplay). A file outside the series' folder, or whose new name is taken, keeps its
   * name. Returns where each file inside the folder is now, under MEDIA_ROOT.
   */
  renameEpisodes(
    series: Series,
    files: readonly EpisodeFile[],
  ): Promise<{ season: number; episode: number; relativePath: string }[]>;
  /**
   * Where an episode's video is now, under MEDIA_ROOT: its `filePath` when that is there, otherwise
   * the one video of its number (`… S01E02.ext`) in its season folder; null when there is none.
   */
  locateEpisode(series: Series, episode: Episode): Promise<string | null>;
  /**
   * Renames the series' folder to `folderName`, with everything in it. "absent" when the series has
   * no folder yet, "taken" when something already has that name (nothing moves then).
   */
  moveSeries(series: Series, folderName: string): Promise<"moved" | "absent" | "taken">;
  /**
   * Deletes an episode's video and what is named after it (subtitles, nfo, thumbnail, trickplay).
   * "absent" when there is no video to delete; "outside" when its file is not in the series' own
   * folder (nothing is deleted then). A companion this server is not allowed to delete stays.
   */
  deleteEpisode(series: Series, episode: Episode): Promise<"deleted" | "absent" | "outside">;
}

/** An episode file Jellyfin already has. */
export interface EpisodeFile {
  season: number;
  episode: number;
  /** Absolute, as this server sees it. */
  path: string;
}

/** A show as TMDB names it. */
export interface ShowMatch {
  title: string;
  year: number | null;
  imdbId: string | null;
  overview: string | null;
  /** An absolute http(s) address of its poster. */
  posterUrl: string | null;
}

/** A show in Jellyfin's libraries. */
export interface LibraryShow {
  /** Jellyfin's item id. */
  id: string;
  title: string;
  year: number | null;
  tmdbId: string | null;
  imdbId: string | null;
  /** Its folder relative to MEDIA_ROOT; null when it is outside it, where this server can't write. */
  folderName: string | null;
}

export interface MediaServer {
  /**
   * Tells Jellyfin that something under `path` (an absolute path under MEDIA_ROOT) changed. With
   * `replaceMetadata` it rereads the series from scratch (its nfo first), not only what is new.
   */
  libraryUpdated(path: string, options?: { replaceMetadata?: boolean | undefined }): Promise<void>;
  /**
   * The show with that TMDB id, looked up through Jellyfin's own TMDB provider (and its key); null
   * when TMDB has none. Throws AppError upstream when Jellyfin can't be asked.
   */
  findShowByTmdbId(tmdbId: string, signal?: AbortSignal): Promise<ShowMatch | null>;
  /** Every show in Jellyfin's libraries. Throws AppError upstream when Jellyfin can't be asked. */
  listShows(signal?: AbortSignal): Promise<LibraryShow[]>;
  /**
   * The files of a show's episodes that are under MEDIA_ROOT, one per file: a file holding several
   * episodes (`S01E01-E02`) is left out, as are episodes Jellyfin only knows of (no file).
   */
  listEpisodeFiles(showId: string, signal?: AbortSignal): Promise<EpisodeFile[]>;
}

/** A season of a show as TMDB numbers it (0 = specials). */
export interface GuideSeason {
  number: number;
  name: string;
  episodeCount: number;
  year: number | null;
}

export interface GuideEpisode {
  number: number;
  name: string;
  /** `YYYY-MM-DD`, as TMDB gives it. */
  airDate: string | null;
  /** TMDB's synopsis of the episode, in the language asked for. */
  overview: string | null;
  /** How long it runs, in minutes. */
  runtimeMin: number | null;
  /** A frame of the episode (TMDB's "still"), an absolute https address the panel loads as is. */
  stillUrl: string | null;
}

/**
 * Whether a show still airs: `airing` while it has a next episode on the calendar, `returning` when
 * TMDB expects more of it but has no date (between seasons), `ended` or `canceled` once it won't;
 * null for a status TMDB doesn't explain.
 */
export type AiringStatus = "airing" | "returning" | "ended" | "canceled";

export interface GuideShow {
  /** A wide still of the show (TMDB's "backdrop"), an absolute https address; null when it has none. */
  backdropUrl: string | null;
  status: AiringStatus | null;
  /** The next episode on TMDB's calendar; `airDate` is `YYYY-MM-DD`. */
  nextEpisode: { season: number; number: number; airDate: string | null } | null;
}

/**
 * A show's seasons and episodes as TMDB lists them, which Jellyfin can't give for a show it doesn't
 * have. `language` is TMDB's (`es`, `en-US`). Null when TMDB has no such show or season; throws
 * AppError upstream when TMDB can't be asked.
 */
export interface EpisodeGuide {
  seasons(
    tmdbId: string,
    language: string | undefined,
    signal?: AbortSignal,
  ): Promise<GuideSeason[] | null>;
  episodes(
    tmdbId: string,
    season: number,
    language: string | undefined,
    signal?: AbortSignal,
  ): Promise<GuideEpisode[] | null>;
  /** The show itself, beyond its seasons; null when TMDB has no such show. */
  show(tmdbId: string, signal?: AbortSignal): Promise<GuideShow | null>;
}

export interface Authenticated {
  userId: string;
  userName: string;
}

export interface Authenticator {
  /** Signs in against Jellyfin and requires an administrator. Throws AppError unauthorized / forbidden. */
  authenticate(username: string, password: string): Promise<Authenticated>;
  isStillAdmin(userId: string): Promise<boolean>;
}

/** Refuses addresses a server-side fetch must not reach (this machine, the LAN, metadata services). */
export interface UrlGuard {
  /** The parsed address, or a PermanentError / RetryableError saying why not. */
  assertUrl(url: string): Promise<URL>;
}

export interface DetectedStream {
  url: string;
  kind: "hls" | "dash" | "direct";
  headers: Record<string, string>;
}

/** Finds the media stream a web page plays, with a headless browser. */
export interface StreamDetector {
  /**
   * `referer`: the page the player is embedded in, for players that refuse to play elsewhere.
   * `framed`: the player only plays inside an iframe, so it is opened in one.
   */
  detect(
    pageUrl: string,
    options: { signal: AbortSignal; referer?: string; framed?: boolean },
  ): Promise<DetectedStream[]>;
}

export interface FetchedImage {
  bytes: Uint8Array;
  /** Lower-case, with the dot: `.jpg`, `.png`, `.webp`. */
  extension: string;
}

export interface ImageFetcher {
  /**
   * Fetches an image. `hosts` are the hosts the address, and every redirect on the way to the image,
   * must stay on (a host or any of its subdomains), over https.
   */
  fetch(
    url: string,
    options: { hosts: readonly string[]; signal?: AbortSignal },
  ): Promise<FetchedImage>;
}

export interface NotificationRepository {
  insert(notification: Notification): Promise<void>;
  /** Newest first. */
  list(limit: number): Promise<Notification[]>;
  unreadCount(): Promise<number>;
  /** `ids` absent: every unread one. Returns how many changed. */
  markRead(at: number, ids?: string[]): Promise<number>;
  /** Removes every notification created before `cutoff`. */
  deleteOlderThan(cutoff: number): Promise<void>;
  /** The newest notification of a kind for a series. */
  latest(kind: NotificationKind, seriesId: string): Promise<Notification | null>;
}

/** A channel a notification goes out on. The panel's is always on; others (ntfy) can be added. */
export interface Notifier {
  notify(notification: Notification): Promise<void>;
}

export interface EventBus {
  publish(event: DistributiveOmit<HmEvent, "seq">): void;
  subscribe(listener: (event: HmEvent) => void): () => void;
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export interface PreviewStore {
  put(extraction: Extraction, extractorId: string): string;
  get(id: string): { extraction: Extraction; extractorId: string } | null;
}

export interface ExtractorRegistry {
  list(): SiteExtractor[];
  find(url: string): SiteExtractor | null;
  get(id: string): SiteExtractor | null;
}

/** Wakes the job queue after something was enqueued. */
export interface QueueSignal {
  notify(): void;
}

/** Stops a running job from outside the queue. */
export interface JobCanceller {
  cancel(id: string): Promise<Job>;
  /** Stops a running job and puts it back in the queue as it was, without counting an attempt. */
  interrupt(id: string): Promise<void>;
}

export type { EpisodeStatus };
