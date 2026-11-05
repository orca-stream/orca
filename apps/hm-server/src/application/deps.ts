import type { NotificationService } from "./notifications.ts";
import type {
  Authenticator,
  Clock,
  Downloader,
  EventBus,
  ExtractorRegistry,
  ImageFetcher,
  JobCanceller,
  JobRepository,
  LibraryWriter,
  EpisodeGuide,
  MediaServer,
  NotificationRepository,
  PreviewStore,
  QueueSignal,
  Random,
  SeriesRepository,
  SessionRepository,
  StreamDetector,
  StreamPrefs,
  UrlGuard,
} from "./ports.ts";

/** Everything the use cases need from the outside, as ports. The composition root wires adapters in. */
export interface Deps {
  clock: Clock;
  random: Random;
  series: SeriesRepository;
  jobs: JobRepository;
  sessions: SessionRepository;
  extractors: ExtractorRegistry;
  previews: PreviewStore;
  library: LibraryWriter;
  images: ImageFetcher;
  authenticator: Authenticator;
  /** Null without a Jellyfin: the library is only written, nobody is told about it. */
  mediaServer: MediaServer | null;
  /** Null without a TMDB key (TMDB_API_KEY): the panel then asks for the numbers by hand. */
  episodeGuide: EpisodeGuide | null;
  downloaders: Downloader[];
  /** Absent until the browser-based detector exists. */
  detector: StreamDetector | null;
  /** Checks every address a page or stream hands us before anything connects to it. */
  guard: UrlGuard;
  /** The track choices of a series that has none of its own. */
  streamDefaults: StreamPrefs;
  /**
   * One episode at a time (SEQUENTIAL_DOWNLOADS): its players are tried in the page's order, and once
   * every one has failed the episode fails and the next one starts. The queue enforces the "one".
   */
  sequentialDownloads: boolean;
  /**
   * Hosts whose players are left out of an episode's list before any is tried (SKIP_PLAYERS): those
   * that never give a stream (one that decrypts in the page) would only burn the detector's timeout.
   */
  skipPlayers: readonly string[];
  events: EventBus;
  notifications: NotificationService;
  /** Read side of the notifications: the bell lists and marks them. */
  notificationRepository: NotificationRepository;
  queue: QueueSignal;
  canceller: JobCanceller;
  /** How long a burst of finished episodes is allowed to keep postponing the library refresh. */
  refreshDebounceMs: number;
  sessionTtlMs: number;
  /** How often a session re-confirms its user is still an administrator. */
  adminRecheckMs: number;
}
