import type { Extraction, SiteExtractor } from "@orca/extractor-core";
import type { EpisodeStatus, HmEvent, JobStatus, ProgressDetail } from "@orca/hm-contract";
import type { Job, NewJob } from "../domain/job.ts";
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
    patch: Partial<Pick<Series, "title" | "year" | "follow" | "checkIntervalHours" | "hasPoster">>,
  ): Promise<Series | null>;
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

export interface DownloadContext {
  signal: AbortSignal;
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
  download(source: Source, destPath: string, context: DownloadContext): Promise<{ bytes: number }>;
}

export interface LibraryWriter {
  /** Absolute path where an episode is staged while downloading. */
  stagingPath(episode: Episode): string;
  /** Absolute path of a series' folder. */
  seriesPath(series: Series): string;
  /** Creates the series folder and writes tvshow.nfo. */
  writeSeries(series: Series): Promise<void>;
  writePoster(series: Series, image: Uint8Array): Promise<void>;
  /** The poster.jpg on disk, if the series has one. */
  posterPath(series: Series): Promise<string | null>;
  /** Moves the staged file to its Jellyfin name and writes the episode .nfo. Returns the path under MEDIA_ROOT. */
  commitEpisode(
    series: Series,
    episode: Episode,
    stagedPath: string,
  ): Promise<{ relativePath: string }>;
  /** Deletes a staged file and its `.part`, if any. */
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

export interface DetectedStream {
  url: string;
  kind: "hls" | "dash" | "direct";
  headers: Record<string, string>;
}

/** Finds the media stream a web page plays. Implemented with a headless browser in a later phase. */
export interface StreamDetector {
  detect(pageUrl: string, options: { signal: AbortSignal }): Promise<DetectedStream[]>;
}

export interface ImageFetcher {
  fetch(url: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
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
