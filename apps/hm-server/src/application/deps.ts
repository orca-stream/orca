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
  MediaServer,
  PreviewStore,
  QueueSignal,
  Random,
  SeriesRepository,
  SessionRepository,
  StreamDetector,
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
  mediaServer: MediaServer;
  downloaders: Downloader[];
  /** Absent until the browser-based detector exists. */
  detector: StreamDetector | null;
  events: EventBus;
  queue: QueueSignal;
  canceller: JobCanceller;
  /** How long a burst of finished episodes is allowed to keep postponing the library refresh. */
  refreshDebounceMs: number;
  sessionTtlMs: number;
  /** How often a session re-confirms its user is still an administrator. */
  adminRecheckMs: number;
}
