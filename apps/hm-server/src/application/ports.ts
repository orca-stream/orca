import type { Extraction, SiteExtractor } from "@orca/extractor-core";
import type { EpisodeStatus, HmEvent, JobStatus, ProgressDetail } from "@orca/hm-contract";
import type { Job, NewJob } from "../domain/job.ts";
import type { Notification, NotificationKind } from "../domain/notification.ts";
import type { Episode, Series, Source } from "../domain/series.ts";

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
  /** Persists a series and its episodes together, or neither. */
  create(series: Series, episodes: Episode[]): Promise<void>;
  get(id: string): Promise<Series | null>;
  findByExternal(extractorId: string, externalId: string): Promise<Series | null>;
  findByFolder(folderName: string): Promise<Series | null>;
  list(): Promise<SeriesWithCounts[]>;
  update(
    id: string,
    patch: Partial<
      Pick<
        Series,
        | "title"
        | "year"
        | "follow"
        | "checkIntervalHours"
        | "hasPoster"
        | "lastCheckedAt"
        | "remoteMarker"
        | "knownRefs"
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
  /** Atomically takes the best ready job of a resource and marks it running with a lease. */
  claim(resource: Job["resource"], leaseOwner: string, leaseMs: number): Promise<Job | null>;
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
  /** Queued plus running episode downloads per series id; series with none are absent. */
  countActiveDownloads(): Promise<Map<string, number>>;
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
}

export interface MediaServer {
  /** Tells Jellyfin that something under `path` (an absolute path under MEDIA_ROOT) changed. */
  libraryUpdated(path: string): Promise<void>;
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

/** Finds the media stream a web page plays. Implemented with a headless browser in a later phase. */
export interface StreamDetector {
  detect(pageUrl: string, options: { signal: AbortSignal }): Promise<DetectedStream[]>;
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
}

export type { EpisodeStatus };
